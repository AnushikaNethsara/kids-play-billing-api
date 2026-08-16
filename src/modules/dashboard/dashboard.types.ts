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
  discounts: number;
  refunds: number;
  netRevenue: number;
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
}

/**
 * Time-based metrics, derived from play sessions rather than bills. Only CLOSED sessions
 * count: an ACTIVE one has no duration yet, and a VOIDED one never represented real play.
 */
export interface SessionSummary {
  /** Sessions closed in the period. */
  sessionCount: number;
  totalPlayMinutes: number;
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
  refunds: number;
  netRevenue: number;
  billCount: number;
  childrenCount: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  billCount: number;
  childrenCount: number;
}

export interface YearlyRevenuePoint {
  year: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
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
