import type { ReportPeriod } from '../../common/utils/dateRange';
import type { BillStatus } from '../../common/constants/billStatus';
import type { PaymentMethod } from '../../common/constants/paymentMethods';
import type { BillItemKind } from '../../common/constants/billItemKind';
import type { PlaySessionStatus } from '../../common/constants/sessionStatus';
import type { SessionPricingMode } from '../../common/constants/pricingModes';
import type {
  DashboardSummary,
  PaymentMethodBreakdown,
  CashierPerformance,
  PackagePerformance,
  ProductPerformance,
  SessionSummary,
} from '../dashboard/dashboard.types';

export type ReportFormat = 'json' | 'csv';

export const ReportName = {
  DAILY_CLOSE: 'daily-close',
  BILL_REGISTER: 'bill-register',
  EXCEPTIONS: 'exceptions',
  SESSIONS: 'sessions',
  PERIOD_SUMMARY: 'period-summary',
} as const;

export type ReportName = (typeof ReportName)[keyof typeof ReportName];

export interface ReportRangeQuery {
  period?: ReportPeriod;
  from?: string;
  to?: string;
}

interface ExportOptions {
  format: ReportFormat;
  includeContact: boolean;
}

interface PageOptions {
  page: number;
  limit: number;
}

export interface DailyCloseQuery {
  date: string;
}

/** A register lists only bills that were paid at some point; a draft has no `paidAt`. */
export type RegisterBillStatus = typeof BillStatus.PAID | typeof BillStatus.REFUNDED | typeof BillStatus.CANCELLED;

export interface BillRegisterQuery extends ReportRangeQuery, ExportOptions, PageOptions {
  status?: RegisterBillStatus;
  paymentMethod?: PaymentMethod;
  cashierId?: string;
  level: 'bill' | 'line';
}

export const ExceptionType = {
  DISCOUNT: 'DISCOUNT',
  REFUND: 'REFUND',
  CANCELLATION: 'CANCELLATION',
  TEST_FLAG: 'TEST_FLAG',
  VOID: 'VOID',
  FORCE_CLOSE: 'FORCE_CLOSE',
  LATE_PAYMENT: 'LATE_PAYMENT',
} as const;

export type ExceptionType = (typeof ExceptionType)[keyof typeof ExceptionType];

export interface ExceptionsQuery extends ReportRangeQuery, ExportOptions {
  type?: ExceptionType;
}

export interface SessionReportQuery extends ReportRangeQuery, ExportOptions, PageOptions {
  status?: PlaySessionStatus;
}

export interface ReportHeader {
  businessName: string;
  timezone: string;
  /** Business-local dates the report covers, inclusive. */
  from: string;
  to: string;
  generatedAt: Date;
  generatedBy: string;
}

// ---- Bill register --------------------------------------------------------------

export interface BillRegisterRow {
  id: string;
  billNumber: string | null;
  paidAt: Date | null;
  status: BillStatus;
  paymentMethod: PaymentMethod | null;
  cashierName: string;
  paymentRecordedByName: string | null;
  /** Empty unless the export asked for contact details. */
  parentName: string;
  /** Masked unless the export asked for contact details. */
  phoneNumber: string;
  childrenCount: number;
  playAmount: number;
  groupAmount: number;
  productAmount: number;
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  reason: string;
}

/**
 * One bill line. There is deliberately no unit price or quantity-times-price here: on a
 * session line `quantity` means nothing and `lineTotal` is the pro-rata charge, so the
 * only amount that is true for every kind of line is `lineTotal`.
 */
export interface BillLineRow {
  billId: string;
  billNumber: string | null;
  paidAt: Date | null;
  status: BillStatus;
  kind: BillItemKind;
  childName: string;
  itemName: string;
  /** Headcount on a GROUP line, units on a PRODUCT line; 1 on a PLAY line. */
  quantity: number;
  billedMinutes: number | null;
  lineTotal: number;
}

/** Same definitions as the dashboard summary, so the two reconcile. */
export interface BillRegisterTotals {
  billCount: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  tax: number;
  cancelledAfterPaymentCount: number;
  cancelledAfterPaymentAmount: number;
}

// ---- Daily close ----------------------------------------------------------------

export interface DailyCloseAdjustment {
  billId: string;
  billNumber: string | null;
  action: 'CANCELLED' | 'REFUNDED';
  amount: number;
  occurredAt: Date;
  actorName: string;
  reason: string;
}

export interface DailyCloseReport {
  header: ReportHeader;
  summary: DashboardSummary;
  /** PAID bills only, so CASH here is what the drawer should hold from the day's sales. */
  paymentMethods: PaymentMethodBreakdown[];
  cashiers: CashierPerformance[];
  packages: PackagePerformance[];
  products: ProductPerformance[];
  sessions: SessionSummary;
  billNumberRange: { first: string | null; last: string | null };
  openDrafts: Array<{ id: string; createdAt: Date; cashierName: string; grandTotal: number; parentName: string }>;
  activeSessions: Array<{
    id: string;
    ticketCode: string;
    childName: string;
    /** Children on the ticket - more than one on a family ticket. */
    childCount: number;
    checkInAt: Date;
    cashierName: string;
  }>;
  /**
   * Bills paid on this day that were cancelled or refunded after it ended. The totals
   * above are recalculated live and already reflect these, so a reprint can differ from
   * the copy printed at closing time; this list is what explains the difference.
   */
  adjustments: DailyCloseAdjustment[];
}

// ---- Exceptions -----------------------------------------------------------------

export interface ExceptionRow {
  type: ExceptionType;
  occurredAt: Date;
  entityType: 'BILL' | 'PLAY_SESSION';
  entityId: string;
  /** Bill number, ticket code, or ticket codes for a force-close. */
  reference: string;
  amount: number | null;
  /** Who performed the action. */
  actorName: string;
  /** The cashier on the bill or ticket, which is not always the actor. */
  cashierName: string;
  reason: string;
  detail: string;
}

export interface ExceptionsReport {
  rows: ExceptionRow[];
  countsByType: Record<ExceptionType, number>;
  byActor: Array<{ actorName: string; total: number; counts: Partial<Record<ExceptionType, number>> }>;
  truncated: boolean;
}

// ---- Sessions -------------------------------------------------------------------

export interface SessionReportRow {
  id: string;
  ticketCode: string;
  status: PlaySessionStatus;
  childName: string;
  /** Children on the ticket - more than one on a family ticket. */
  childCount: number;
  packageName: string;
  pricingMode: SessionPricingMode;
  checkInAt: Date;
  checkOutAt: Date | null;
  /** Wall-clock minutes between check-in and check-out; null while still playing. */
  actualMinutes: number | null;
  billedMinutes: number | null;
  minimumApplied: boolean;
  chargedAmount: number | null;
  extrasTotal: number;
  billId: string | null;
  billNumber: string | null;
  checkInCashierName: string;
  checkOutCashierName: string | null;
  voidReason: string;
  parentName: string;
  phoneNumber: string;
}

// ---- Period summary ---------------------------------------------------------------

export type SummaryGroupBy = 'day' | 'week' | 'month';

/** Which table a CSV export carries: the per-period rows, or one range-wide breakdown. */
export type SummaryBreakdown = 'period' | 'cashier' | 'package' | 'product' | 'paymentMethod';

export interface PeriodSummaryQuery extends ReportRangeQuery {
  groupBy?: SummaryGroupBy;
  format: ReportFormat;
  breakdown: SummaryBreakdown;
}

export interface PeriodBucket {
  /** `2026-10-06`, `2026-W41` (ISO week) or `2026-10`. `TOTAL` on the totals row. */
  label: string;
  /** Business-local dates the bucket covers, clipped to the requested range. */
  start: string;
  end: string;
  /** Revenue-recognized bills: PAID and REFUNDED. */
  billCount: number;
  childrenCount: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  /** Tax on PAID and REFUNDED bills: cash + card + bank + other = net + tax. */
  tax: number;
  /** Bills still PAID, by method. */
  cashAmount: number;
  cardAmount: number;
  bankTransferAmount: number;
  otherAmount: number;
  playRevenue: number;
  groupRevenue: number;
  productRevenue: number;
  cancelledCount: number;
  sessionCount: number;
  playMinutes: number;
  minimumAppliedCount: number;
  voidedCount: number;
}

export interface PeriodSummaryReport {
  header: ReportHeader;
  groupBy: SummaryGroupBy;
  /** The dashboard summary for the whole range, unchanged. */
  totals: DashboardSummary;
  /** Range-wide figures in bucket shape - the CSV's TOTAL row, never a sum of buckets. */
  totalsRow: PeriodBucket;
  buckets: PeriodBucket[];
  paymentMethods: PaymentMethodBreakdown[];
  cashiers: CashierPerformance[];
  packages: PackagePerformance[];
  products: ProductPerformance[];
  sessions: SessionSummary;
}
