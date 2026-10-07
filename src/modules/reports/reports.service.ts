import { Types, type FilterQuery } from 'mongoose';
import { BillModel, type BillDocument, type BillItemSubdocument } from '../bills/bill.model';
import {
  PlaySessionModel,
  resolveChildCount,
  sumSessionExtras,
  type PlaySessionDocument,
} from '../play-sessions/playSession.model';
import { AuditLogModel } from '../audit-logs/auditLog.model';
import { UserModel } from '../users/user.model';
import { dashboardService } from '../dashboard/dashboard.service';
import { settingsService } from '../settings/settings.service';
import { resolveMinimumBillableMinutes } from '../settings/settings.model';
import { BillStatus } from '../../common/constants/billStatus';
import { BillItemKind, resolveItemKind } from '../../common/constants/billItemKind';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { AuditAction } from '../../common/constants/auditActions';
import { EXCLUDE_TEST_BILLS, EXCLUDE_TEST_SESSIONS, revenueRecognizedMatch } from '../../common/reporting/billFilters';
import { resolveDateRange, formatBusinessDate } from '../../common/utils/dateRange';
import { buildPaginationMeta, getSkip, type PaginationMeta } from '../../common/utils/pagination';
import { ValidationError } from '../../common/errors';
import type { AuthenticatedUser } from '../../common/types/express';
import { maskPhone } from './reports.csv';
import { toLocalPhone } from '../../common/utils/phone';
import { getPeriodSummary } from './periodSummary';
import { getCustomerReport } from './customerReport';
import {
  ExceptionType,
  type BillLineRow,
  type BillRegisterQuery,
  type BillRegisterRow,
  type BillRegisterTotals,
  type DailyCloseAdjustment,
  type DailyCloseQuery,
  type DailyCloseReport,
  type ExceptionRow,
  type ExceptionsQuery,
  type ExceptionsReport,
  type PeriodSummaryQuery,
  type PeriodSummaryReport,
  type CustomerReport,
  type CustomerReportQuery,
  type ReportRangeQuery,
  type SessionReportQuery,
  type SessionReportRow,
} from './reports.types';

/** Longest range any report accepts. A year of bills is ~100k rows - fine to stream, not to preview. */
const MAX_RANGE_DAYS = 366;
/** Exceptions are assembled in memory from several collections, so they are capped. */
const EXCEPTIONS_ROW_CAP = 5000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ResolvedReportRange {
  start: Date;
  end: Date;
  timezone: string;
  businessName: string;
  /** Business-local dates, for headers and filenames. */
  fromDate: string;
  toDate: string;
}

async function resolveReportRange(query: ReportRangeQuery): Promise<ResolvedReportRange> {
  const settings = await settingsService.getRaw();
  const { start, end } = resolveDateRange(settings.timezone, query);
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    throw new ValidationError(`A report can cover at most ${MAX_RANGE_DAYS} days`);
  }
  return {
    start,
    end,
    timezone: settings.timezone,
    businessName: settings.businessName,
    fromDate: formatBusinessDate(start, settings.timezone),
    toDate: formatBusinessDate(end, settings.timezone),
  };
}

/** Display names for user ids, in one query. Deleted or unknown users read as "Unknown". */
async function resolveUserNames(ids: Array<Types.ObjectId | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is Types.ObjectId => !!id).map((id) => id.toString()))];
  if (unique.length === 0) return new Map();
  const users = await UserModel.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(users.map((user) => [user._id.toString(), user.name]));
}

function nameOf(names: Map<string, string>, id: Types.ObjectId | null | undefined): string {
  if (!id) return '';
  return names.get(id.toString()) ?? 'Unknown';
}

// ---- Bill register ----------------------------------------------------------------

type LeanBill = BillDocument & { _id: Types.ObjectId };

function billRegisterMatch(query: BillRegisterQuery, range: ResolvedReportRange): FilterQuery<BillDocument> {
  const match: FilterQuery<BillDocument> = {
    ...EXCLUDE_TEST_BILLS,
    status: query.status ?? { $in: [BillStatus.PAID, BillStatus.REFUNDED, BillStatus.CANCELLED] },
    paidAt: { $gte: range.start, $lte: range.end },
  };
  if (query.paymentMethod) match.paymentMethod = query.paymentMethod;
  if (query.cashierId) match.cashierId = new Types.ObjectId(query.cashierId);
  return match;
}

function childrenOnLine(item: BillItemSubdocument): number {
  const kind = resolveItemKind(item);
  if (kind === BillItemKind.GROUP) return item.quantity;
  if (kind === BillItemKind.PRODUCT) return 0;
  // A checked-out ticket: a family ticket covers several children. Mirrors CHILDREN_ON_BILL.
  if (item.playSessionId) return item.quantity ?? 1;
  return 1;
}

function toBillRegisterRow(bill: LeanBill, includeContact: boolean): BillRegisterRow {
  const amountOf = (kind: BillItemKind) =>
    bill.items.filter((item) => resolveItemKind(item) === kind).reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    id: bill._id.toString(),
    billNumber: bill.billNumber ?? null,
    paidAt: bill.paidAt ?? null,
    status: bill.status,
    paymentMethod: bill.paymentMethod ?? null,
    cashierName: bill.cashierName,
    paymentRecordedByName: bill.paymentRecordedByName ?? null,
    parentName: includeContact ? bill.parentName ?? '' : '',
    phoneNumber: includeContact ? toLocalPhone(bill.phoneNumber) : maskPhone(bill.phoneNumber),
    childrenCount: bill.items.reduce((sum, item) => sum + childrenOnLine(item), 0),
    playAmount: amountOf(BillItemKind.PLAY),
    groupAmount: amountOf(BillItemKind.GROUP),
    productAmount: amountOf(BillItemKind.PRODUCT),
    subtotal: bill.subtotal,
    discount: bill.discount,
    tax: bill.tax,
    grandTotal: bill.grandTotal,
    refundedAt: bill.refundedAt ?? null,
    cancelledAt: bill.cancelledAt ?? null,
    reason: bill.cancellationReason ?? bill.refundReason ?? '',
  };
}

function toBillLineRows(bill: LeanBill): BillLineRow[] {
  return bill.items.map((item) => {
    const kind = resolveItemKind(item);
    return {
      billId: bill._id.toString(),
      billNumber: bill.billNumber ?? null,
      paidAt: bill.paidAt ?? null,
      status: bill.status,
      kind,
      childName: item.childName ?? '',
      itemName: item.packageName,
      quantity: kind === BillItemKind.PLAY ? 1 : item.quantity,
      billedMinutes: item.billedMinutes ?? null,
      lineTotal: item.lineTotal,
    };
  });
}

async function billRegisterTotals(match: FilterQuery<BillDocument>): Promise<BillRegisterTotals> {
  const [row] = await BillModel.aggregate<Omit<BillRegisterTotals, 'netRevenue'>>([
    { $match: match },
    {
      $group: {
        _id: null,
        billCount: { $sum: { $cond: [{ $in: ['$status', [BillStatus.PAID, BillStatus.REFUNDED]] }, 1, 0] } },
        grossRevenue: {
          $sum: { $cond: [{ $in: ['$status', [BillStatus.PAID, BillStatus.REFUNDED]] }, '$subtotal', 0] },
        },
        discounts: {
          $sum: { $cond: [{ $in: ['$status', [BillStatus.PAID, BillStatus.REFUNDED]] }, '$discount', 0] },
        },
        refunds: { $sum: { $cond: [{ $eq: ['$status', BillStatus.REFUNDED] }, '$grandTotal', 0] } },
        tax: { $sum: { $cond: [{ $in: ['$status', [BillStatus.PAID, BillStatus.REFUNDED]] }, '$tax', 0] } },
        cancelledAfterPaymentCount: { $sum: { $cond: [{ $eq: ['$status', BillStatus.CANCELLED] }, 1, 0] } },
        cancelledAfterPaymentAmount: {
          $sum: { $cond: [{ $eq: ['$status', BillStatus.CANCELLED] }, '$grandTotal', 0] },
        },
      },
    },
  ]);

  const totals = row ?? {
    billCount: 0,
    grossRevenue: 0,
    discounts: 0,
    refunds: 0,
    tax: 0,
    cancelledAfterPaymentCount: 0,
    cancelledAfterPaymentAmount: 0,
  };
  return {
    billCount: totals.billCount,
    grossRevenue: totals.grossRevenue,
    discounts: totals.discounts,
    refunds: totals.refunds,
    netRevenue: totals.grossRevenue - totals.discounts - totals.refunds,
    tax: totals.tax,
    cancelledAfterPaymentCount: totals.cancelledAfterPaymentCount,
    cancelledAfterPaymentAmount: totals.cancelledAfterPaymentAmount,
  };
}

// ---- Sessions ---------------------------------------------------------------------

type LeanSessionWithBill = PlaySessionDocument & { _id: Types.ObjectId; billNumber: string | null };

function sessionReportPipeline(query: SessionReportQuery, range: ResolvedReportRange) {
  const match: FilterQuery<PlaySessionDocument> = {
    ...EXCLUDE_TEST_SESSIONS,
    checkInAt: { $gte: range.start, $lte: range.end },
  };
  if (query.status) match.status = query.status;

  return {
    match,
    stages: [
      { $match: match },
      { $sort: { checkInAt: 1 as const, _id: 1 as const } },
    ],
    lookup: [
      { $lookup: { from: BillModel.collection.name, localField: 'billId', foreignField: '_id', as: 'bill' } },
      { $addFields: { billNumber: { $ifNull: [{ $arrayElemAt: ['$bill.billNumber', 0] }, null] } } },
      { $project: { bill: 0 } },
    ],
  };
}

function toSessionReportRow(
  session: LeanSessionWithBill,
  minimumBillableMinutes: number,
  includeContact: boolean,
): SessionReportRow {
  // Raw BSON from an aggregation: sessions written before pricing modes have no such key.
  const pricingMode = session.pricingMode ?? SessionPricingMode.PRORATA;
  const actualMinutes = session.checkOutAt
    ? Math.round((session.checkOutAt.getTime() - session.checkInAt.getTime()) / 60000)
    : null;

  return {
    id: session._id.toString(),
    ticketCode: session.ticketCode,
    status: session.status,
    childName: session.childName,
    childCount: resolveChildCount(session),
    packageName: session.packageName,
    pricingMode,
    checkInAt: session.checkInAt,
    checkOutAt: session.checkOutAt ?? null,
    actualMinutes,
    billedMinutes: session.billedMinutes ?? null,
    // Same rule as the dashboard's minimum-applied count: only pro-rata has a floor.
    minimumApplied:
      session.status === PlaySessionStatus.CLOSED &&
      pricingMode === SessionPricingMode.PRORATA &&
      session.billedMinutes !== null &&
      session.billedMinutes !== undefined &&
      session.billedMinutes <= minimumBillableMinutes,
    chargedAmount: session.chargedAmount ?? null,
    extrasTotal: sumSessionExtras(session),
    billId: session.billId ? session.billId.toString() : null,
    billNumber: session.billNumber ?? null,
    checkInCashierName: session.checkInCashierName,
    checkOutCashierName: session.checkOutCashierName ?? null,
    voidReason: session.voidReason ?? '',
    parentName: includeContact ? session.parentName ?? '' : '',
    phoneNumber: includeContact ? toLocalPhone(session.phoneNumber) : maskPhone(session.phoneNumber),
  };
}

// ---- Exceptions -------------------------------------------------------------------

function formatGap(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function percentOf(part: number, whole: number): string {
  if (whole <= 0) return '';
  return `${(Math.round((part * 1000) / whole) / 10).toFixed(1)}% of subtotal`;
}

export const reportsService = {
  resolveReportRange,

  async getPeriodSummary(
    query: PeriodSummaryQuery,
    actor: AuthenticatedUser,
  ): Promise<{ range: ResolvedReportRange; report: PeriodSummaryReport }> {
    const range = await resolveReportRange(query);
    return { range, report: await getPeriodSummary(query, range, actor) };
  },

  async getCustomerReport(
    query: CustomerReportQuery,
    actor: AuthenticatedUser,
  ): Promise<{ range: ResolvedReportRange; report: CustomerReport }> {
    const range = await resolveReportRange(query);
    return { range, report: await getCustomerReport(query, range, actor) };
  },

  async getDailyClose(query: DailyCloseQuery, actor: AuthenticatedUser): Promise<DailyCloseReport> {
    const dayQuery = { from: query.date, to: query.date };
    const range = await resolveReportRange(dayQuery);
    const { start, end } = range;

    const [summary, paymentMethods, cashiers, packages, products, sessions] = await Promise.all([
      dashboardService.getSummary(dayQuery),
      dashboardService.getPaymentMethodBreakdown(dayQuery),
      dashboardService.getCashierPerformance(dayQuery),
      dashboardService.getPackagePerformance(dayQuery),
      dashboardService.getProductPerformance(dayQuery),
      dashboardService.getSessionSummary(dayQuery),
    ]);

    const revenueMatch = revenueRecognizedMatch(start, end);
    const [firstBill, lastBill, openDrafts, activeSessions, adjustedBills] = await Promise.all([
      BillModel.findOne(revenueMatch, { billNumber: 1 }).sort({ paidAt: 1 }).lean(),
      BillModel.findOne(revenueMatch, { billNumber: 1 }).sort({ paidAt: -1 }).lean(),
      BillModel.find({ ...EXCLUDE_TEST_BILLS, status: BillStatus.DRAFT, createdAt: { $gte: start, $lte: end } })
        .sort({ createdAt: 1 })
        .lean(),
      PlaySessionModel.find({
        ...EXCLUDE_TEST_SESSIONS,
        status: PlaySessionStatus.ACTIVE,
        checkInAt: { $gte: start, $lte: end },
      })
        .sort({ checkInAt: 1 })
        .lean(),
      // Paid today, reversed after today ended. `cancelBill` keeps `paidAt`, which is what
      // makes a paid-then-cancelled bill findable by the day it was originally taken.
      BillModel.find({
        ...EXCLUDE_TEST_BILLS,
        paidAt: { $gte: start, $lte: end },
        $or: [
          { status: BillStatus.CANCELLED, cancelledAt: { $gt: end } },
          { status: BillStatus.REFUNDED, refundedAt: { $gt: end } },
        ],
      }).lean(),
    ]);

    const names = await resolveUserNames(adjustedBills.flatMap((bill) => [bill.cancelledBy, bill.refundedBy]));
    const adjustments: DailyCloseAdjustment[] = adjustedBills
      .map((bill): DailyCloseAdjustment => {
        const cancelled = bill.status === BillStatus.CANCELLED;
        return {
          billId: bill._id.toString(),
          billNumber: bill.billNumber ?? null,
          action: cancelled ? 'CANCELLED' : 'REFUNDED',
          amount: bill.grandTotal,
          occurredAt: (cancelled ? bill.cancelledAt : bill.refundedAt) as Date,
          actorName: nameOf(names, cancelled ? bill.cancelledBy : bill.refundedBy),
          reason: (cancelled ? bill.cancellationReason : bill.refundReason) ?? '',
        };
      })
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    return {
      header: {
        businessName: range.businessName,
        timezone: range.timezone,
        from: range.fromDate,
        to: range.toDate,
        generatedAt: new Date(),
        generatedBy: actor.name,
      },
      summary,
      paymentMethods,
      cashiers,
      packages,
      products,
      sessions,
      billNumberRange: { first: firstBill?.billNumber ?? null, last: lastBill?.billNumber ?? null },
      openDrafts: openDrafts.map((bill) => ({
        id: bill._id.toString(),
        createdAt: bill.createdAt,
        cashierName: bill.cashierName,
        grandTotal: bill.grandTotal,
        parentName: bill.parentName ?? '',
      })),
      activeSessions: activeSessions.map((session) => ({
        id: session._id.toString(),
        ticketCode: session.ticketCode,
        childName: session.childName,
        childCount: resolveChildCount(session),
        checkInAt: session.checkInAt,
        cashierName: session.checkInCashierName,
      })),
      adjustments,
    };
  },

  async getBillRegister(query: BillRegisterQuery): Promise<{
    rows: BillRegisterRow[] | BillLineRow[];
    totals: BillRegisterTotals;
    pagination: PaginationMeta;
  }> {
    const range = await resolveReportRange(query);
    const match = billRegisterMatch(query, range);
    const skip = getSkip(query);
    const totals = await billRegisterTotals(match);

    if (query.level === 'line') {
      const [page] = await BillModel.aggregate<{ rows: LeanBillLineAggregate[]; total: Array<{ count: number }> }>([
        { $match: match },
        { $sort: { paidAt: 1, _id: 1 } },
        { $unwind: { path: '$items', includeArrayIndex: 'lineIndex' } },
        {
          $facet: {
            rows: [{ $skip: skip }, { $limit: query.limit }],
            total: [{ $count: 'count' }],
          },
        },
      ]);
      const rows = (page?.rows ?? []).map((row) => toBillLineRows({ ...row, items: [row.items] })[0]);
      return { rows, totals, pagination: buildPaginationMeta(query, page?.total[0]?.count ?? 0) };
    }

    const [bills, total] = await Promise.all([
      BillModel.find(match).sort({ paidAt: 1, _id: 1 }).skip(skip).limit(query.limit).lean<LeanBill[]>(),
      BillModel.countDocuments(match),
    ]);
    return {
      rows: bills.map((bill) => toBillRegisterRow(bill, query.includeContact)),
      totals,
      pagination: buildPaginationMeta(query, total),
    };
  },

  /**
   * The register as an async stream of rows, for CSV. Validates and resolves the range
   * before returning, so a bad request still fails before any response header is written.
   */
  async streamBillRegister(query: BillRegisterQuery): Promise<{
    range: ResolvedReportRange;
    rows: AsyncIterable<BillRegisterRow | BillLineRow>;
  }> {
    const range = await resolveReportRange(query);
    const match = billRegisterMatch(query, range);

    async function* rows(): AsyncIterable<BillRegisterRow | BillLineRow> {
      const cursor = BillModel.find(match).sort({ paidAt: 1, _id: 1 }).lean<LeanBill[]>().cursor();
      for await (const bill of cursor) {
        const lean = bill as unknown as LeanBill;
        if (query.level === 'line') {
          yield* toBillLineRows(lean);
        } else {
          yield toBillRegisterRow(lean, query.includeContact);
        }
      }
    }

    return { range, rows: rows() };
  },

  async getExceptions(query: ExceptionsQuery): Promise<{ range: ResolvedReportRange; report: ExceptionsReport }> {
    const range = await resolveReportRange(query);
    const { start, end } = range;
    const wants = (type: ExceptionType) => !query.type || query.type === type;
    const inRange = { $gte: start, $lte: end };
    const none = Promise.resolve([] as never[]);

    const [discounted, refunded, cancelled, testFlagged, voided, forceClosed, latePaid] = await Promise.all([
      wants(ExceptionType.DISCOUNT)
        ? BillModel.find({ ...revenueRecognizedMatch(start, end), discount: { $gt: 0 } })
            .limit(EXCEPTIONS_ROW_CAP)
            .lean()
        : none,
      wants(ExceptionType.REFUND)
        ? BillModel.find({ ...EXCLUDE_TEST_BILLS, status: BillStatus.REFUNDED, refundedAt: inRange })
            .limit(EXCEPTIONS_ROW_CAP)
            .lean()
        : none,
      wants(ExceptionType.CANCELLATION)
        ? BillModel.find({ ...EXCLUDE_TEST_BILLS, status: BillStatus.CANCELLED, cancelledAt: inRange })
            .limit(EXCEPTIONS_ROW_CAP)
            .lean()
        : none,
      // The one place test bills are the point: flagging a real sale as a test removes it
      // from every income figure, so who flags what is worth watching.
      wants(ExceptionType.TEST_FLAG)
        ? BillModel.find({ isTestBill: true, testMarkedAt: inRange }).limit(EXCEPTIONS_ROW_CAP).lean()
        : none,
      wants(ExceptionType.VOID)
        ? PlaySessionModel.find({ ...EXCLUDE_TEST_SESSIONS, status: PlaySessionStatus.VOIDED, voidedAt: inRange })
            .limit(EXCEPTIONS_ROW_CAP)
            .lean()
        : none,
      wants(ExceptionType.FORCE_CLOSE)
        ? AuditLogModel.find({ action: AuditAction.SESSION_FORCE_CLOSED, createdAt: inRange })
            .limit(EXCEPTIONS_ROW_CAP)
            .lean()
        : none,
      wants(ExceptionType.LATE_PAYMENT)
        ? BillModel.find({ ...EXCLUDE_TEST_BILLS, paymentRecordedAt: inRange }).limit(EXCEPTIONS_ROW_CAP).lean()
        : none,
    ]);

    const names = await resolveUserNames([
      ...refunded.map((bill) => bill.refundedBy),
      ...cancelled.map((bill) => bill.cancelledBy),
      ...testFlagged.map((bill) => bill.testMarkedBy),
      ...voided.map((session) => session.voidedBy),
    ]);

    // Force-close audit rows carry the bill id; the bill carries its number and cashier.
    const forceClosedBills = await BillModel.find(
      { _id: { $in: forceClosed.map((log) => log.entityId).filter((id) => Types.ObjectId.isValid(id)) } },
      { billNumber: 1, cashierName: 1, grandTotal: 1 },
    ).lean();
    const forceClosedById = new Map(forceClosedBills.map((bill) => [bill._id.toString(), bill]));

    const rows: ExceptionRow[] = [
      ...discounted.map(
        (bill): ExceptionRow => ({
          type: ExceptionType.DISCOUNT,
          occurredAt: bill.paidAt as Date,
          entityType: 'BILL',
          entityId: bill._id.toString(),
          reference: bill.billNumber ?? '',
          amount: bill.discount,
          actorName: bill.cashierName,
          cashierName: bill.cashierName,
          reason: '',
          detail: percentOf(bill.discount, bill.subtotal),
        }),
      ),
      ...refunded.map(
        (bill): ExceptionRow => ({
          type: ExceptionType.REFUND,
          occurredAt: bill.refundedAt as Date,
          entityType: 'BILL',
          entityId: bill._id.toString(),
          reference: bill.billNumber ?? '',
          amount: bill.grandTotal,
          actorName: nameOf(names, bill.refundedBy),
          cashierName: bill.cashierName,
          reason: bill.refundReason ?? '',
          detail: bill.paidAt ? `Refunded ${formatGap(bill.refundedAt!.getTime() - bill.paidAt.getTime())} after payment` : '',
        }),
      ),
      ...cancelled.map(
        (bill): ExceptionRow => ({
          type: ExceptionType.CANCELLATION,
          occurredAt: bill.cancelledAt as Date,
          entityType: 'BILL',
          entityId: bill._id.toString(),
          reference: bill.billNumber ?? '',
          amount: bill.grandTotal,
          actorName: nameOf(names, bill.cancelledBy),
          cashierName: bill.cashierName,
          reason: bill.cancellationReason ?? '',
          detail: bill.paidAt ? 'Cancelled after payment' : 'Draft cancelled',
        }),
      ),
      ...testFlagged.map(
        (bill): ExceptionRow => ({
          type: ExceptionType.TEST_FLAG,
          occurredAt: bill.testMarkedAt as Date,
          entityType: 'BILL',
          entityId: bill._id.toString(),
          reference: bill.billNumber ?? '',
          amount: bill.grandTotal,
          actorName: nameOf(names, bill.testMarkedBy),
          cashierName: bill.cashierName,
          reason: bill.testReason ?? '',
          detail: `Bill status ${bill.status}`,
        }),
      ),
      ...voided.map(
        (session): ExceptionRow => ({
          type: ExceptionType.VOID,
          occurredAt: session.voidedAt as Date,
          entityType: 'PLAY_SESSION',
          entityId: session._id.toString(),
          reference: session.ticketCode,
          amount: null,
          actorName: nameOf(names, session.voidedBy),
          cashierName: session.checkInCashierName,
          reason: session.voidReason ?? '',
          detail: `${session.childName} - ${session.packageName}`,
        }),
      ),
      ...forceClosed.map((log): ExceptionRow => {
        const bill = forceClosedById.get(log.entityId);
        const metadata = (log.metadata ?? {}) as { ticketCodes?: string[]; grandTotal?: number };
        return {
          type: ExceptionType.FORCE_CLOSE,
          occurredAt: log.createdAt,
          entityType: 'BILL',
          entityId: log.entityId,
          reference: (metadata.ticketCodes ?? []).join(', ') || (bill?.billNumber ?? ''),
          amount: bill?.grandTotal ?? metadata.grandTotal ?? null,
          actorName: log.userName,
          cashierName: bill?.cashierName ?? '',
          reason: '',
          detail: bill?.billNumber ? `Bill ${bill.billNumber}` : 'Closed with a chosen exit time',
        };
      }),
      ...latePaid.map(
        (bill): ExceptionRow => ({
          type: ExceptionType.LATE_PAYMENT,
          occurredAt: bill.paymentRecordedAt as Date,
          entityType: 'BILL',
          entityId: bill._id.toString(),
          reference: bill.billNumber ?? '',
          amount: bill.grandTotal,
          actorName: bill.paymentRecordedByName ?? '',
          cashierName: bill.cashierName,
          reason: '',
          detail: bill.paidAt
            ? `Recorded ${formatGap(bill.paymentRecordedAt!.getTime() - bill.paidAt.getTime())} after checkout`
            : '',
        }),
      ),
    ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const sources = [discounted, refunded, cancelled, testFlagged, voided, forceClosed, latePaid];
    const truncated = rows.length > EXCEPTIONS_ROW_CAP || sources.some((source) => source.length >= EXCEPTIONS_ROW_CAP);

    const countsByType = Object.fromEntries(Object.values(ExceptionType).map((type) => [type, 0])) as Record<
      ExceptionType,
      number
    >;
    const actors = new Map<string, ExceptionsReport['byActor'][number]>();
    for (const row of rows) {
      countsByType[row.type] += 1;
      const actorName = row.actorName || 'Unknown';
      const entry = actors.get(actorName) ?? { actorName, total: 0, counts: {} };
      entry.total += 1;
      entry.counts[row.type] = (entry.counts[row.type] ?? 0) + 1;
      actors.set(actorName, entry);
    }

    return {
      range,
      report: {
        rows: rows.slice(0, EXCEPTIONS_ROW_CAP),
        countsByType,
        byActor: [...actors.values()].sort((a, b) => b.total - a.total),
        truncated,
      },
    };
  },

  async getSessionReport(query: SessionReportQuery): Promise<{ rows: SessionReportRow[]; pagination: PaginationMeta }> {
    const range = await resolveReportRange(query);
    const settings = await settingsService.getRaw();
    const minimum = resolveMinimumBillableMinutes(settings);
    const { match, stages, lookup } = sessionReportPipeline(query, range);

    const [sessions, total] = await Promise.all([
      PlaySessionModel.aggregate<LeanSessionWithBill>([...stages, { $skip: getSkip(query) }, { $limit: query.limit }, ...lookup]),
      PlaySessionModel.countDocuments(match),
    ]);

    return {
      rows: sessions.map((session) => toSessionReportRow(session, minimum, query.includeContact)),
      pagination: buildPaginationMeta(query, total),
    };
  },

  async streamSessionReport(query: SessionReportQuery): Promise<{
    range: ResolvedReportRange;
    rows: AsyncIterable<SessionReportRow>;
  }> {
    const range = await resolveReportRange(query);
    const settings = await settingsService.getRaw();
    const minimum = resolveMinimumBillableMinutes(settings);
    const { stages, lookup } = sessionReportPipeline(query, range);

    async function* rows(): AsyncIterable<SessionReportRow> {
      const cursor = PlaySessionModel.aggregate<LeanSessionWithBill>([...stages, ...lookup]).cursor();
      for await (const session of cursor) {
        yield toSessionReportRow(session, minimum, query.includeContact);
      }
    }

    return { range, rows: rows() };
  },
};

/** One bill after `$unwind: '$items'`: the bill's fields with a single line in `items`. */
type LeanBillLineAggregate = Omit<LeanBill, 'items'> & { items: BillItemSubdocument };
