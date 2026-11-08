import type { ExpenseCategoryRow } from '../../common/reporting/expenseFilters';
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
  CUSTOMERS: 'customers',
  PROFIT_LOSS: 'profit-loss',
  EXPENSES: 'expenses',
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
  BILL_CORRECTION: 'BILL_CORRECTION',
  EXPENSE_VOID: 'EXPENSE_VOID',
  EXPENSE_EDIT: 'EXPENSE_EDIT',
  CASH_ADJUSTMENT_VOID: 'CASH_ADJUSTMENT_VOID',
  CASH_ADJUSTMENT_EDIT: 'CASH_ADJUSTMENT_EDIT',
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
  /** Written off by admin corrections after payment. */
  writeOff: number;
  grandTotal: number;
  /** How many times an admin corrected the bill after payment. */
  revision: number;
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
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
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
  /** MANUAL_ENTRY: a bill dated to this day but entered by an admin after the day ended. */
  action: 'CANCELLED' | 'REFUNDED' | 'CORRECTED' | 'MANUAL_ENTRY';
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
   * Bills paid on this day that were cancelled, refunded or corrected after it ended. A
   * correction's `amount` is the change to the bill's grand total (negative for a
   * write-off, 0 for a payment-method or detail change). The totals
   * above are recalculated live and already reflect these, so a reprint can differ from
   * the copy printed at closing time; this list is what explains the difference.
   */
  adjustments: DailyCloseAdjustment[];
  /** Active expenses dated this day, and what they did to the drawer. */
  expenses: DailyCloseExpenses;
  /** Cash surpluses and shortages recorded for this day at reconciliation. */
  cashAdjustments: DailyCloseCashAdjustments;
}

export interface DailyCloseCashAdjustment {
  id: string;
  /** Signed minor units: + surplus, - shortage. */
  amount: number;
  reason: string;
  notes: string;
  status: string;
  createdByName: string;
  createdAt: Date;
  /** True when the adjustment was entered, edited or voided after the day ended. */
  changedAfterClose: boolean;
}

export interface DailyCloseCashAdjustments {
  /** Active adjustments dated this day, plus any dated this day and voided after it ended. */
  items: DailyCloseCashAdjustment[];
  /** Active only. Equals `summary.cashOverShort`. */
  net: number;
  /** Cash the drawer should hold at close: `expenses.expectedCashInDrawer`. */
  expectedCashInDrawer: number;
  /**
   * What was actually counted: expected plus the recorded over/short. Equals expected when
   * nothing has been recorded for the day.
   */
  countedCashInDrawer: number;
}

export interface DailyCloseExpense {
  id: string;
  categoryName: string;
  description: string;
  vendor: string;
  paymentMethod: string;
  amount: number;
  status: string;
  /** True when the expense was entered, edited or voided after the day ended. */
  changedAfterClose: boolean;
}

export interface DailyCloseExpenses {
  /** Active expenses dated this day, plus any dated this day and voided after it ended. */
  items: DailyCloseExpense[];
  /** Active expenses only. Equals `summary.expenses`. */
  total: number;
  cashTotal: number;
  /**
   * Cash the drawer should hold at close: cash taken on PAID bills less cash expenses.
   * There is no float or counted amount yet, so this is the expected figure only.
   */
  expectedCashInDrawer: number;
}

// ---- Exceptions -----------------------------------------------------------------

export interface ExceptionRow {
  type: ExceptionType;
  occurredAt: Date;
  entityType: 'BILL' | 'PLAY_SESSION' | 'EXPENSE' | 'CASH_ADJUSTMENT';
  entityId: string;
  /** Bill number, ticket code, ticket codes for a force-close, or an expense's category and day. */
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
export type SummaryBreakdown = 'period' | 'cashier' | 'package' | 'product' | 'paymentMethod' | 'expenseCategory';

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
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
  refunds: number;
  netRevenue: number;
  /** Active expenses dated in the bucket (cash basis). */
  expenses: number;
  /** Net cash surplus (+) / shortage (-) recorded at reconciliation in the bucket. */
  cashOverShort: number;
  /** `netRevenue - expenses + cashOverShort`. */
  netProfit: number;
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
  /** Active expenses in range by category, largest first. */
  expensesByCategory: ExpenseCategoryRow[];
}

// ---- Customers --------------------------------------------------------------------

export interface CustomerReportQuery extends ReportRangeQuery {
  groupBy?: SummaryGroupBy;
  format: ReportFormat;
}

/**
 * Families are phone numbers (or a customer record with none). A visit is one business
 * day with a paid play bill - see `customers/customerVisits.ts`. A family is **new** on
 * the day of its first-ever visit and **returning** on every visit after it.
 */
export interface CustomerReportSummary {
  /** Families with at least one visit in the range. */
  uniqueFamilies: number;
  /** Family visits in the range, plus anonymous ones. */
  visits: number;
  /** Families whose first-ever visit falls in the range. */
  newFamilies: number;
  /** Families in the range who had visited before it. */
  returningFamilies: number;
  /** returningFamilies / uniqueFamilies, 0-1. 0 when there were no families. */
  returningShare: number;
  /** Play bills with no phone number and no customer - visits nobody can be followed up. */
  anonymousVisits: number;
}

export interface CustomerReportBucket {
  /** `2026-10-06`, `2026-W41` or `2026-10`, as the period summary labels its rows. */
  label: string;
  start: string;
  end: string;
  visits: number;
  families: number;
  newFamilies: number;
  returningFamilies: number;
}

export interface CustomerCohort {
  /** The month of these families' first visit, `YYYY-MM`. */
  month: string;
  size: number;
  /**
   * `retention[k]` is the share (0-1) of the cohort that visited in month `+k`. Index 0
   * is always 1. Only months up to the report's end month are present.
   */
  retention: number[];
}

export interface CustomerReport {
  header: ReportHeader;
  groupBy: SummaryGroupBy;
  summary: CustomerReportSummary;
  newVsReturning: CustomerReportBucket[];
  /** The 12 first-visit months ending with the report's end month, oldest first. */
  cohorts: CustomerCohort[];
  /** Families in the range by how many times they came in it. */
  frequencyHistogram: { label: '1' | '2-3' | '4-9' | '10+'; families: number }[];
  /**
   * When visits begin, by weekday (0 = Monday) and hour in the business timezone. A visit
   * is counted once, at its first check-in.
   */
  dayHourHeatmap: { weekday: number; hour: number; newVisits: number; returningVisits: number }[];
}

// ---- Profit & loss and expenses ---------------------------------------------------

export interface ProfitLossQuery extends ReportRangeQuery {
  format: ReportFormat;
}

/**
 * Income less expenses for a range, on a cash basis. Every income figure is the
 * dashboard summary's for the same range and `expenses.total` is `summary.expenses`, so
 * the bottom line is the dashboard's net profit by construction.
 */
export interface ProfitLossReport {
  header: ReportHeader;
  income: {
    play: number;
    group: number;
    product: number;
    /** play + group + product, before any deduction. */
    gross: number;
    discounts: number;
    /** The automatic multi-child part of `discounts`. */
    multiChildDiscounts: number;
    writeOffs: number;
    refunds: number;
    netRevenue: number;
  };
  /** Net cash surplus (+) / shortage (-) from reconciliation. Equals `summary.cashOverShort`. */
  cashOverShort: { net: number; surplus: number; shortage: number; count: number };
  expenses: { byCategory: ExpenseCategoryRow[]; total: number; count: number };
  netProfit: number;
  /** Basis points (2550 = 25.50%), or null with no revenue. */
  profitMarginBasisPoints: number | null;
}

/** One line of the P&L as a CSV row. */
export interface ProfitLossLine {
  section: 'Income' | 'Deductions' | 'Cash over/short' | 'Expenses' | 'Result';
  line: string;
  amount: number;
}

export interface ExpenseRegisterQuery extends ReportRangeQuery {
  format: ReportFormat;
  status: 'ACTIVE' | 'VOIDED' | 'ALL';
  categoryId?: string;
  paymentMethod?: PaymentMethod;
}

export interface ExpenseRegisterRow {
  spentOn: string;
  categoryName: string;
  description: string;
  vendor: string;
  reference: string;
  paymentMethod: PaymentMethod;
  amount: number;
  status: string;
  enteredBy: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string;
}
