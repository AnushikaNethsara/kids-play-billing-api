import type { ReportPeriod } from '../../common/utils/dateRange';

export interface DashboardQuery {
  period?: ReportPeriod;
  from?: string;
  to?: string;
}

export interface RevenueQuery extends DashboardQuery {
  groupBy?: 'day' | 'month' | 'year';
}

export interface RecentBillsQuery {
  limit: number;
}

export interface MoneyBreakdown {
  amount: number;
  count: number;
}

export interface DashboardSummary {
  grossRevenue: number;
  /** Every discount, the automatic multi-child one included. */
  discounts: number;
  /** The automatic multi-child part of `discounts`. */
  multiChildDiscounts: number;
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
  refunds: number;
  netRevenue: number;
  /** Active expenses dated in the period (cash basis). */
  expenses: number;
  /** The part of `expenses` paid in cash, out of the drawer. */
  cashExpenses: number;
  expenseCount: number;
  /**
   * Net cash over/short found at reconciliation: active cash adjustments dated in the
   * period. Positive is a surplus, negative a shortage. Not revenue - it goes into profit.
   */
  cashOverShort: number;
  /** Sum of surpluses (>= 0). */
  cashSurplus: number;
  /** Sum of shortages (<= 0). */
  cashShortage: number;
  cashAdjustmentCount: number;
  /** `netRevenue - expenses + cashOverShort`. Can be negative. */
  netProfit: number;
  /** `netProfit / netRevenue` in basis points (2550 = 25.50%), or null with no revenue. */
  profitMarginBasisPoints: number | null;
  paidBillsCount: number;
  cancelledBillsCount: number;
  refundedBillsCount: number;
  averageBillValue: number;
  childrenServed: number;
  cashPayments: MoneyBreakdown;
  cardPayments: MoneyBreakdown;
  bankTransferPayments: MoneyBreakdown;
  otherPayments: MoneyBreakdown;
  bestSellingPackage: { playPackageId: string; packageName: string; quantitySold: number; revenue: number } | null;
  topCashier: { cashierId: string; cashierName: string; revenue: number; billCount: number } | null;
  /**
   * Line totals by kind of line, before bill-level discount and tax - what play, group
   * visits and counter sales each brought in. Sums to `grossRevenue`.
   */
  revenueByKind: { play: number; group: number; product: number };
  /** Group lines in the period, and the children they brought between them. */
  groupVisits: { count: number; headcount: number };
  /** Units sold across every product. */
  productUnitsSold: number;
}

export interface ProductPerformance {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

/**
 * Time-based metrics, derived from play sessions rather than bills. Only CLOSED sessions
 * count: an ACTIVE one has no duration yet, and a VOIDED one never represented real play.
 */
export interface SessionSummary {
  /** Tickets closed in the period. A family ticket is one. */
  sessionCount: number;
  /** Children on those tickets - a family ticket counts each child. */
  childCount: number;
  /** Child-minutes of play: a family of three for an hour is 180. */
  totalPlayMinutes: number;
  /** Per child. */
  averagePlayMinutes: number;
  longestPlayMinutes: number;
  /** How often the configured minimum had to be applied - is the minimum set right? */
  minimumAppliedCount: number;
  /** Revenue per hour of play, a truer efficiency measure than revenue per bill. */
  revenuePerPlayHour: number;
  voidedCount: number;
  voidsByCashier: { cashierId: string; cashierName: string; voidedCount: number }[];
}

export interface OccupancyPoint {
  /** Hour of day, 0-23, in the business timezone. */
  hour: number;
  /** Distinct children present at any point during that hour, summed across the period. */
  childCount: number;
}

export interface DailyRevenuePoint {
  date: string;
  grossRevenue: number;
  discounts: number;
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
  refunds: number;
  netRevenue: number;
  /** Active expenses dated in the bucket. */
  expenses: number;
  /** Net cash surplus (+) / shortage (-) recorded at reconciliation in the bucket. */
  cashOverShort: number;
  /** `netRevenue - expenses + cashOverShort`. */
  netProfit: number;
  billCount: number;
  childrenCount: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  grossRevenue: number;
  discounts: number;
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
  refunds: number;
  netRevenue: number;
  /** Active expenses dated in the bucket. */
  expenses: number;
  /** Net cash surplus (+) / shortage (-) recorded at reconciliation in the bucket. */
  cashOverShort: number;
  /** `netRevenue - expenses + cashOverShort`. */
  netProfit: number;
  billCount: number;
  childrenCount: number;
}

export interface YearlyRevenuePoint {
  year: number;
  grossRevenue: number;
  discounts: number;
  /** Written off paid bills by admin corrections - money never collected. */
  writeOffs: number;
  refunds: number;
  netRevenue: number;
  /** Active expenses dated in the bucket. */
  expenses: number;
  /** Net cash surplus (+) / shortage (-) recorded at reconciliation in the bucket. */
  cashOverShort: number;
  /** `netRevenue - expenses + cashOverShort`. */
  netProfit: number;
  billCount: number;
  childrenCount: number;
}

export interface BillsBreakdown {
  DRAFT: number;
  PAID: number;
  CANCELLED: number;
  REFUNDED: number;
}

export interface PackagePerformance {
  playPackageId: string;
  packageName: string;
  quantitySold: number;
  revenue: number;
}

export interface PaymentMethodBreakdown {
  paymentMethod: string;
  amount: number;
  count: number;
}

export interface CashierPerformance {
  cashierId: string;
  cashierName: string;
  billCount: number;
  revenue: number;
  discountsGiven: number;
  cancelledCount: number;
  averageBillValue: number;
}
