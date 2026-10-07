import { formatBusinessDate } from '../../common/utils/dateRange';
import { formatMinorAsDecimal } from '../../common/utils/money';
import type { CsvColumn } from './reports.csv';
import type {
  BillLineRow,
  BillRegisterRow,
  CustomerReportBucket,
  ExceptionRow,
  PeriodBucket,
  SessionReportRow,
} from './reports.types';
import type {
  CashierPerformance,
  PackagePerformance,
  PaymentMethodBreakdown,
  ProductPerformance,
} from '../dashboard/dashboard.types';

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
    { header: 'Children', kind: 'raw', value: (row) => row.childCount },
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

export function customerReportColumns(): CsvColumn<CustomerReportBucket>[] {
  return [
    { header: 'Period', value: (row) => row.label },
    { header: 'From', kind: 'raw', value: (row) => row.start },
    { header: 'To', kind: 'raw', value: (row) => row.end },
    { header: 'Visits', kind: 'raw', value: (row) => row.visits },
    { header: 'Families', kind: 'raw', value: (row) => row.families },
    { header: 'New families', kind: 'raw', value: (row) => row.newFamilies },
    { header: 'Returning families', kind: 'raw', value: (row) => row.returningFamilies },
  ];
}

export function periodSummaryColumns(): CsvColumn<PeriodBucket>[] {
  return [
    { header: 'Period', value: (row) => row.label },
    { header: 'From', kind: 'raw', value: (row) => row.start },
    { header: 'To', kind: 'raw', value: (row) => row.end },
    { header: 'Bills', kind: 'raw', value: (row) => row.billCount },
    { header: 'Children', kind: 'raw', value: (row) => row.childrenCount },
    { header: 'Gross', kind: 'raw', value: (row) => money(row.grossRevenue) },
    { header: 'Discounts', kind: 'raw', value: (row) => money(row.discounts) },
    { header: 'Refunds', kind: 'raw', value: (row) => money(row.refunds) },
    { header: 'Net', kind: 'raw', value: (row) => money(row.netRevenue) },
    { header: 'Tax', kind: 'raw', value: (row) => money(row.tax) },
    { header: 'Cash', kind: 'raw', value: (row) => money(row.cashAmount) },
    { header: 'Card', kind: 'raw', value: (row) => money(row.cardAmount) },
    { header: 'Bank transfer', kind: 'raw', value: (row) => money(row.bankTransferAmount) },
    { header: 'Other', kind: 'raw', value: (row) => money(row.otherAmount) },
    { header: 'Play', kind: 'raw', value: (row) => money(row.playRevenue) },
    { header: 'Group', kind: 'raw', value: (row) => money(row.groupRevenue) },
    { header: 'Products', kind: 'raw', value: (row) => money(row.productRevenue) },
    { header: 'Cancelled bills', kind: 'raw', value: (row) => row.cancelledCount },
    { header: 'Sessions', kind: 'raw', value: (row) => row.sessionCount },
    { header: 'Play minutes', kind: 'raw', value: (row) => row.playMinutes },
    { header: 'Minimum applied', kind: 'raw', value: (row) => row.minimumAppliedCount },
    { header: 'Tickets voided', kind: 'raw', value: (row) => row.voidedCount },
  ];
}

export function cashierBreakdownColumns(): CsvColumn<CashierPerformance>[] {
  return [
    { header: 'Cashier', value: (row) => row.cashierName },
    { header: 'Bills', kind: 'raw', value: (row) => row.billCount },
    { header: 'Revenue', kind: 'raw', value: (row) => money(row.revenue) },
    { header: 'Average bill', kind: 'raw', value: (row) => money(row.averageBillValue) },
    { header: 'Discounts given', kind: 'raw', value: (row) => money(row.discountsGiven) },
    { header: 'Cancelled', kind: 'raw', value: (row) => row.cancelledCount },
  ];
}

export function packageBreakdownColumns(): CsvColumn<PackagePerformance>[] {
  return [
    { header: 'Package', value: (row) => row.packageName },
    { header: 'Children', kind: 'raw', value: (row) => row.quantitySold },
    { header: 'Revenue', kind: 'raw', value: (row) => money(row.revenue) },
  ];
}

export function productBreakdownColumns(): CsvColumn<ProductPerformance>[] {
  return [
    { header: 'Product', value: (row) => row.productName },
    { header: 'Units', kind: 'raw', value: (row) => row.quantitySold },
    { header: 'Revenue', kind: 'raw', value: (row) => money(row.revenue) },
  ];
}

export function paymentMethodBreakdownColumns(): CsvColumn<PaymentMethodBreakdown>[] {
  return [
    { header: 'Payment method', value: (row) => row.paymentMethod },
    { header: 'Bills', kind: 'raw', value: (row) => row.count },
    { header: 'Amount', kind: 'raw', value: (row) => money(row.amount) },
  ];
}
