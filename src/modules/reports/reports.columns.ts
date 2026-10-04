import { formatBusinessDate } from '../../common/utils/dateRange';
import { formatMinorAsDecimal } from '../../common/utils/money';
import type { CsvColumn } from './reports.csv';
import type { BillLineRow, BillRegisterRow, ExceptionRow, SessionReportRow } from './reports.types';

/**
 * Column layouts for every CSV export. Money is written as plain decimals in major units
 * and dates in the business timezone - an accountant's spreadsheet has no idea what UTC or
 * minor units are.
 */

const DATE_TIME = 'yyyy-MM-dd HH:mm';

function dateCell(timezone: string) {
  return (date: Date | null | undefined) => (date ? formatBusinessDate(date, timezone, DATE_TIME) : '');
}

function money(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '' : formatMinorAsDecimal(amount);
}

export function billRegisterColumns(timezone: string, includeContact: boolean): CsvColumn<BillRegisterRow>[] {
  const date = dateCell(timezone);
  const columns: CsvColumn<BillRegisterRow>[] = [
    { header: 'Bill number', value: (row) => row.billNumber },
    { header: 'Paid at', kind: 'raw', value: (row) => date(row.paidAt) },
    { header: 'Status', value: (row) => row.status },
    { header: 'Payment method', value: (row) => row.paymentMethod },
    { header: 'Cashier', value: (row) => row.cashierName },
    { header: 'Payment recorded by', value: (row) => row.paymentRecordedByName },
    { header: 'Phone', value: (row) => row.phoneNumber },
  ];
  if (includeContact) columns.push({ header: 'Parent name', value: (row) => row.parentName });
  columns.push(
    { header: 'Children', kind: 'raw', value: (row) => row.childrenCount },
    { header: 'Play', kind: 'raw', value: (row) => money(row.playAmount) },
    { header: 'Group', kind: 'raw', value: (row) => money(row.groupAmount) },
    { header: 'Products', kind: 'raw', value: (row) => money(row.productAmount) },
    { header: 'Subtotal', kind: 'raw', value: (row) => money(row.subtotal) },
    { header: 'Discount', kind: 'raw', value: (row) => money(row.discount) },
    { header: 'Tax', kind: 'raw', value: (row) => money(row.tax) },
    { header: 'Grand total', kind: 'raw', value: (row) => money(row.grandTotal) },
    { header: 'Refunded at', kind: 'raw', value: (row) => date(row.refundedAt) },
    { header: 'Cancelled at', kind: 'raw', value: (row) => date(row.cancelledAt) },
    { header: 'Reason', value: (row) => row.reason },
  );
  return columns;
}

export function billLineColumns(timezone: string): CsvColumn<BillLineRow>[] {
  const date = dateCell(timezone);
  return [
    { header: 'Bill number', value: (row) => row.billNumber },
    { header: 'Paid at', kind: 'raw', value: (row) => date(row.paidAt) },
    { header: 'Bill status', value: (row) => row.status },
    { header: 'Line kind', value: (row) => row.kind },
    { header: 'Child', value: (row) => row.childName },
    { header: 'Item', value: (row) => row.itemName },
    { header: 'Quantity', kind: 'raw', value: (row) => row.quantity },
    { header: 'Billed minutes', kind: 'raw', value: (row) => row.billedMinutes },
    { header: 'Line total', kind: 'raw', value: (row) => money(row.lineTotal) },
  ];
}

export function exceptionColumns(timezone: string): CsvColumn<ExceptionRow>[] {
  const date = dateCell(timezone);
  return [
    { header: 'Type', value: (row) => row.type },
    { header: 'When', kind: 'raw', value: (row) => date(row.occurredAt) },
    { header: 'Reference', value: (row) => row.reference },
    { header: 'Amount', kind: 'raw', value: (row) => money(row.amount) },
    { header: 'Done by', value: (row) => row.actorName },
    { header: 'Cashier', value: (row) => row.cashierName },
    { header: 'Reason', value: (row) => row.reason },
    { header: 'Detail', value: (row) => row.detail },
  ];
}

export function sessionColumns(timezone: string, includeContact: boolean): CsvColumn<SessionReportRow>[] {
  const date = dateCell(timezone);
  const columns: CsvColumn<SessionReportRow>[] = [
    { header: 'Ticket', value: (row) => row.ticketCode },
    { header: 'Status', value: (row) => row.status },
    { header: 'Child', value: (row) => row.childName },
    { header: 'Package', value: (row) => row.packageName },
    { header: 'Pricing', value: (row) => row.pricingMode },
    { header: 'Check-in', kind: 'raw', value: (row) => date(row.checkInAt) },
    { header: 'Check-out', kind: 'raw', value: (row) => date(row.checkOutAt) },
    { header: 'Actual minutes', kind: 'raw', value: (row) => row.actualMinutes },
    { header: 'Billed minutes', kind: 'raw', value: (row) => row.billedMinutes },
    { header: 'Minimum applied', kind: 'raw', value: (row) => (row.minimumApplied ? 'Yes' : 'No') },
    { header: 'Charged', kind: 'raw', value: (row) => money(row.chargedAmount) },
    { header: 'Extras', kind: 'raw', value: (row) => money(row.extrasTotal) },
    { header: 'Bill number', value: (row) => row.billNumber },
    { header: 'Check-in cashier', value: (row) => row.checkInCashierName },
    { header: 'Check-out cashier', value: (row) => row.checkOutCashierName },
    { header: 'Void reason', value: (row) => row.voidReason },
    { header: 'Phone', value: (row) => row.phoneNumber },
  ];
  if (includeContact) columns.push({ header: 'Parent name', value: (row) => row.parentName });
  return columns;
}
