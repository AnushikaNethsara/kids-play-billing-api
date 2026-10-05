import { DateTime } from 'luxon';
import { BillModel } from '../bills/bill.model';
import { PlaySessionModel } from '../play-sessions/playSession.model';
import { dashboardService } from '../dashboard/dashboard.service';
import { settingsService } from '../settings/settings.service';
import { resolveMinimumBillableMinutes } from '../settings/settings.model';
import { BillStatus } from '../../common/constants/billStatus';
import { BillItemKind } from '../../common/constants/billItemKind';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import {
  CHILDREN_ON_BILL,
  SESSION_CHILD_COUNT,
  EXCLUDE_TEST_BILLS,
  EXCLUDE_TEST_SESSIONS,
  lineRevenueOfKind,
  minimumAppliedExpr,
  paidAmountWithMethod,
  revenueRecognizedMatch,
} from '../../common/reporting/billFilters';
import type { AuthenticatedUser } from '../../common/types/express';
import type { ResolvedReportRange } from './reports.service';
import type {
  PeriodBucket,
  PeriodSummaryQuery,
  PeriodSummaryReport,
  SummaryGroupBy,
} from './reports.types';

/**
 * Bucket labels, written identically by Mongo (`$dateToString`) and Luxon (the skeleton),
 * so aggregate rows merge onto the skeleton by plain string match. `%G-W%V` is the ISO
 * week-year and week - Monday-start, the same week Luxon's `startOf('week')` uses.
 */
const MONGO_FORMAT: Record<SummaryGroupBy, string> = {
  day: '%Y-%m-%d',
  week: '%G-W%V',
  month: '%Y-%m',
};
export const LUXON_FORMAT: Record<SummaryGroupBy, string> = {
  day: 'yyyy-MM-dd',
  week: "kkkk-'W'WW",
  month: 'yyyy-MM',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Daily rows up to a month, weekly up to about a quarter, monthly beyond. */
export function defaultGroupBy(start: Date, end: Date): SummaryGroupBy {
  const days = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

type BucketFigures = Omit<PeriodBucket, 'label' | 'start' | 'end'>;

function emptyFigures(): BucketFigures {
  return {
    billCount: 0,
    childrenCount: 0,
    grossRevenue: 0,
    discounts: 0,
    refunds: 0,
    netRevenue: 0,
    tax: 0,
    cashAmount: 0,
    cardAmount: 0,
    bankTransferAmount: 0,
    otherAmount: 0,
    playRevenue: 0,
    groupRevenue: 0,
    productRevenue: 0,
    subscriptionRevenue: 0,
    cancelledCount: 0,
    sessionCount: 0,
    playMinutes: 0,
    minimumAppliedCount: 0,
    voidedCount: 0,
  };
}

/**
 * Every bucket in the range, including the empty ones - a week with a closed Monday should
 * show a zero row, not a gap the reader has to notice. A bucket straddling either edge of
 * the range keeps its full label but has its dates clipped to the range, which is also all
 * the data inside it can cover.
 */
export function bucketSkeleton(
  start: Date,
  end: Date,
  timezone: string,
  groupBy: SummaryGroupBy,
): Array<Pick<PeriodBucket, 'label' | 'start' | 'end'>> {
  const rangeStart = DateTime.fromJSDate(start, { zone: timezone });
  const rangeEnd = DateTime.fromJSDate(end, { zone: timezone });
  const buckets: Array<Pick<PeriodBucket, 'label' | 'start' | 'end'>> = [];

  let cursor = rangeStart.startOf(groupBy);
  while (cursor <= rangeEnd) {
    const bucketStart = cursor < rangeStart ? rangeStart : cursor;
    const cursorEnd = cursor.endOf(groupBy);
    const bucketEnd = cursorEnd > rangeEnd ? rangeEnd : cursorEnd;
    buckets.push({
      label: cursor.toFormat(LUXON_FORMAT[groupBy]),
      start: bucketStart.toFormat('yyyy-MM-dd'),
      end: bucketEnd.toFormat('yyyy-MM-dd'),
    });
    cursor = cursor.plus({ [groupBy]: 1 });
  }
  return buckets;
}

export async function getPeriodSummary(
  query: PeriodSummaryQuery,
  range: ResolvedReportRange,
  actor: AuthenticatedUser,
): Promise<PeriodSummaryReport> {
  const { start, end, timezone } = range;
  const groupBy = query.groupBy ?? defaultGroupBy(start, end);
  const bucketOf = (field: string) => ({
    $dateToString: { format: MONGO_FORMAT[groupBy], date: field, timezone },
  });
  const inRange = { $gte: start, $lte: end };
  const rangeQuery = { from: range.fromDate, to: range.toDate };

  const settings = await settingsService.getRaw();
  const minimum = resolveMinimumBillableMinutes(settings);

  const [billRows, cancelledRows, sessionRows, voidRows, totals, paymentMethods, cashiers, packages, products, sessions] =
    await Promise.all([
      BillModel.aggregate<{ _id: string } & Omit<BucketFigures, 'netRevenue' | 'cancelledCount' | 'sessionCount' | 'playMinutes' | 'minimumAppliedCount' | 'voidedCount'>>([
        { $match: revenueRecognizedMatch(start, end) },
        {
          $group: {
            _id: bucketOf('$paidAt'),
            billCount: { $sum: 1 },
            childrenCount: { $sum: CHILDREN_ON_BILL },
            grossRevenue: { $sum: '$subtotal' },
            discounts: { $sum: '$discount' },
            refunds: { $sum: { $cond: [{ $eq: ['$status', BillStatus.REFUNDED] }, '$grandTotal', 0] } },
            tax: { $sum: '$tax' },
            cashAmount: { $sum: paidAmountWithMethod(PaymentMethod.CASH) },
            cardAmount: { $sum: paidAmountWithMethod(PaymentMethod.CARD) },
            bankTransferAmount: { $sum: paidAmountWithMethod(PaymentMethod.BANK_TRANSFER) },
            otherAmount: { $sum: paidAmountWithMethod(PaymentMethod.OTHER) },
            playRevenue: { $sum: lineRevenueOfKind(BillItemKind.PLAY) },
            groupRevenue: { $sum: lineRevenueOfKind(BillItemKind.GROUP) },
            productRevenue: { $sum: lineRevenueOfKind(BillItemKind.PRODUCT) },
            subscriptionRevenue: { $sum: lineRevenueOfKind(BillItemKind.SUBSCRIPTION) },
          },
        },
      ]),
      BillModel.aggregate<{ _id: string; cancelledCount: number }>([
        { $match: { ...EXCLUDE_TEST_BILLS, status: BillStatus.CANCELLED, cancelledAt: inRange } },
        { $group: { _id: bucketOf('$cancelledAt'), cancelledCount: { $sum: 1 } } },
      ]),
      PlaySessionModel.aggregate<{ _id: string; sessionCount: number; playMinutes: number; minimumAppliedCount: number }>([
        { $match: { ...EXCLUDE_TEST_SESSIONS, status: PlaySessionStatus.CLOSED, checkOutAt: inRange } },
        {
          $group: {
            _id: bucketOf('$checkOutAt'),
            sessionCount: { $sum: 1 },
            // Child-minutes, as the dashboard counts them, so the buckets add up to its total.
            playMinutes: { $sum: { $multiply: ['$billedMinutes', SESSION_CHILD_COUNT] } },
            minimumAppliedCount: { $sum: minimumAppliedExpr(minimum) },
          },
        },
      ]),
      PlaySessionModel.aggregate<{ _id: string; voidedCount: number }>([
        { $match: { ...EXCLUDE_TEST_SESSIONS, status: PlaySessionStatus.VOIDED, voidedAt: inRange } },
        { $group: { _id: bucketOf('$voidedAt'), voidedCount: { $sum: 1 } } },
      ]),
      dashboardService.getSummary(rangeQuery),
      dashboardService.getPaymentMethodBreakdown(rangeQuery),
      dashboardService.getCashierPerformance(rangeQuery),
      dashboardService.getPackagePerformance(rangeQuery),
      dashboardService.getProductPerformance(rangeQuery),
      dashboardService.getSessionSummary(rangeQuery),
    ]);

  const figures = new Map<string, BucketFigures>();
  const figuresFor = (label: string) => {
    let entry = figures.get(label);
    if (!entry) {
      entry = emptyFigures();
      figures.set(label, entry);
    }
    return entry;
  };
  for (const { _id, ...row } of billRows) Object.assign(figuresFor(_id), row);
  for (const { _id, ...row } of cancelledRows) Object.assign(figuresFor(_id), row);
  for (const { _id, ...row } of sessionRows) Object.assign(figuresFor(_id), row);
  for (const { _id, ...row } of voidRows) Object.assign(figuresFor(_id), row);

  const buckets: PeriodBucket[] = bucketSkeleton(start, end, timezone, groupBy).map((bucket) => {
    const entry = figures.get(bucket.label) ?? emptyFigures();
    return { ...bucket, ...entry, netRevenue: entry.grossRevenue - entry.discounts - entry.refunds };
  });

  const methodAmount = (method: PaymentMethod) =>
    paymentMethods.find((row) => row.paymentMethod === method)?.amount ?? 0;

  // Built from the range-wide figures the dashboard reports, so the TOTAL row of an export
  // is the dashboard's number by construction. Tax is the one figure the summary does not
  // carry; it is a plain sum, so adding the buckets is exact.
  const totalsRow: PeriodBucket = {
    label: 'TOTAL',
    start: range.fromDate,
    end: range.toDate,
    billCount: totals.paidBillsCount + totals.refundedBillsCount,
    childrenCount: totals.childrenServed,
    grossRevenue: totals.grossRevenue,
    discounts: totals.discounts,
    refunds: totals.refunds,
    netRevenue: totals.netRevenue,
    tax: buckets.reduce((sum, bucket) => sum + bucket.tax, 0),
    cashAmount: methodAmount(PaymentMethod.CASH),
    cardAmount: methodAmount(PaymentMethod.CARD),
    bankTransferAmount: methodAmount(PaymentMethod.BANK_TRANSFER),
    otherAmount: methodAmount(PaymentMethod.OTHER),
    playRevenue: totals.revenueByKind.play,
    groupRevenue: totals.revenueByKind.group,
    productRevenue: totals.revenueByKind.product,
    subscriptionRevenue: totals.revenueByKind.subscription,
    cancelledCount: totals.cancelledBillsCount,
    sessionCount: sessions.sessionCount,
    playMinutes: sessions.totalPlayMinutes,
    minimumAppliedCount: sessions.minimumAppliedCount,
    voidedCount: sessions.voidedCount,
  };

  return {
    header: {
      businessName: range.businessName,
      timezone,
      from: range.fromDate,
      to: range.toDate,
      generatedAt: new Date(),
      generatedBy: actor.name,
    },
    groupBy,
    totals,
    totalsRow,
    buckets,
    paymentMethods,
    cashiers,
    packages,
    products,
    sessions,
  };
}
