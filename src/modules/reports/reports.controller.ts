import { once } from 'node:events';
import type { Request, Response } from 'express';
import { reportsService, type ResolvedReportRange } from './reports.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import { logger } from '../../common/logger/logger';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { CSV_BOM, csvHeaderLine, csvRowLine, type CsvColumn } from './reports.csv';
import {
  billLineColumns,
  billRegisterColumns,
  cashierBreakdownColumns,
  customerReportColumns,
  exceptionColumns,
  packageBreakdownColumns,
  paymentMethodBreakdownColumns,
  periodSummaryColumns,
  productBreakdownColumns,
  sessionColumns,
} from './reports.columns';
import {
  ReportName,
  type BillLineRow,
  type BillRegisterQuery,
  type BillRegisterRow,
  type CustomerReportQuery,
  type DailyCloseQuery,
  type ExceptionsQuery,
  type PeriodSummaryQuery,
  type SessionReportQuery,
} from './reports.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

async function* fromArray<T>(rows: T[]): AsyncIterable<T> {
  yield* rows;
}

interface CsvExport<T> {
  report: ReportName;
  range: ResolvedReportRange;
  columns: CsvColumn<T>[];
  rows: AsyncIterable<T>;
  /** Distinguishes several files from one report, e.g. `cashier` -> `kpa-period-summary-cashier_...`. */
  fileTag?: string;
  /** Filters and options, recorded verbatim in the audit entry. */
  options: Record<string, unknown>;
}

/**
 * Streams a CSV and records the export. Everything that can fail with a clean error
 * (validation, the range check) has already happened by the time this runs, so the
 * standard JSON error envelope is still available up to here. Once the first byte is
 * written, a failure can only abort the connection - the client sees a broken download
 * rather than a half-file it might mistake for a complete one.
 *
 * The audit entry is written whether or not the stream finished: rows that left the
 * building before a failure still left the building.
 */
async function sendCsv<T>(req: Request, res: Response, file: CsvExport<T>): Promise<void> {
  const actor = requireActor(req);
  const name = file.fileTag ? `${file.report}-${file.fileTag}` : file.report;
  const filename = `kpa-${name}_${file.range.fromDate}_${file.range.toDate}.csv`;

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  let rowCount = 0;
  let completed = false;
  try {
    res.write(CSV_BOM + csvHeaderLine(file.columns));
    for await (const row of file.rows) {
      rowCount += 1;
      if (!res.write(csvRowLine(file.columns, row))) {
        await once(res, 'drain');
      }
    }
    res.end();
    completed = true;
  } catch (err) {
    logger.error({ err, report: file.report, rowCount }, 'Report export failed mid-stream');
    res.destroy(err as Error);
  } finally {
    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.REPORT_EXPORTED,
      entityType: AuditEntityType.REPORT,
      entityId: file.report,
      metadata: {
        from: file.range.fromDate,
        to: file.range.toDate,
        ...file.options,
        rowCount,
        completed,
      },
      ipAddress: req.ip ?? null,
    });
  }
}

export const reportsController = {
  async customers(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as CustomerReportQuery;
    const { range, report } = await reportsService.getCustomerReport(query, requireActor(req));

    if (query.format !== 'csv') {
      sendSuccess(res, report);
      return;
    }
    // The bucket table only: aggregate figures, never a phone number.
    await sendCsv(req, res, {
      report: ReportName.CUSTOMERS,
      range,
      columns: customerReportColumns(),
      rows: fromArray(report.newVsReturning),
      options: { groupBy: report.groupBy },
    });
  },

  async periodSummary(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as PeriodSummaryQuery;
    const { range, report } = await reportsService.getPeriodSummary(query, requireActor(req));

    if (query.format !== 'csv') {
      sendSuccess(res, report);
      return;
    }

    const base = {
      report: ReportName.PERIOD_SUMMARY,
      range,
      fileTag: query.breakdown,
      options: { groupBy: report.groupBy, breakdown: query.breakdown },
    };
    switch (query.breakdown) {
      case 'cashier':
        await sendCsv(req, res, { ...base, columns: cashierBreakdownColumns(), rows: fromArray(report.cashiers) });
        return;
      case 'package':
        await sendCsv(req, res, { ...base, columns: packageBreakdownColumns(), rows: fromArray(report.packages) });
        return;
      case 'product':
        await sendCsv(req, res, { ...base, columns: productBreakdownColumns(), rows: fromArray(report.products) });
        return;
      case 'paymentMethod':
        await sendCsv(req, res, {
          ...base,
          columns: paymentMethodBreakdownColumns(),
          rows: fromArray(report.paymentMethods),
        });
        return;
      default:
        // One row per bucket, then the range-wide TOTAL row.
        await sendCsv(req, res, {
          ...base,
          columns: periodSummaryColumns(),
          rows: fromArray([...report.buckets, report.totalsRow]),
        });
    }
  },

  async dailyClose(req: Request, res: Response): Promise<void> {
    const report = await reportsService.getDailyClose(req.query as unknown as DailyCloseQuery, requireActor(req));
    sendSuccess(res, report);
  },

  async billRegister(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as BillRegisterQuery;
    const options = {
      level: query.level,
      status: query.status ?? null,
      paymentMethod: query.paymentMethod ?? null,
      cashierId: query.cashierId ?? null,
      includeContact: query.includeContact,
    };

    if (query.format === 'csv') {
      const { range, rows } = await reportsService.streamBillRegister(query);
      if (query.level === 'line') {
        await sendCsv(req, res, {
          report: ReportName.BILL_REGISTER,
          range,
          columns: billLineColumns(range.timezone),
          rows: rows as AsyncIterable<BillLineRow>,
          options,
        });
      } else {
        await sendCsv(req, res, {
          report: ReportName.BILL_REGISTER,
          range,
          columns: billRegisterColumns(range.timezone, query.includeContact),
          rows: rows as AsyncIterable<BillRegisterRow>,
          options,
        });
      }
      return;
    }

    const { rows, totals, pagination } = await reportsService.getBillRegister(query);
    sendSuccess(res, rows, { meta: { ...pagination, totals } });
  },

  async exceptions(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ExceptionsQuery;
    const { range, report } = await reportsService.getExceptions(query);

    if (query.format === 'csv') {
      await sendCsv(req, res, {
        report: ReportName.EXCEPTIONS,
        range,
        columns: exceptionColumns(range.timezone),
        rows: fromArray(report.rows),
        options: { type: query.type ?? null, truncated: report.truncated },
      });
      return;
    }

    sendSuccess(res, report);
  },

  async sessions(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as SessionReportQuery;

    if (query.format === 'csv') {
      const { range, rows } = await reportsService.streamSessionReport(query);
      await sendCsv(req, res, {
        report: ReportName.SESSIONS,
        range,
        columns: sessionColumns(range.timezone, query.includeContact),
        rows,
        options: { status: query.status ?? null, includeContact: query.includeContact },
      });
      return;
    }

    const { rows, pagination } = await reportsService.getSessionReport(query);
    sendSuccess(res, rows, { meta: pagination });
  },
};
