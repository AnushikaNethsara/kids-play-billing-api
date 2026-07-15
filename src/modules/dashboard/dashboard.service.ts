import { BillModel } from '../bills/bill.model';
import { BillStatus } from '../../common/constants/billStatus';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { settingsService } from '../settings/settings.service';
import { resolveDateRange } from '../../common/utils/dateRange';
import type {
  DashboardQuery,
  RevenueQuery,
  RecentBillsQuery,
  DashboardSummary,
  DailyRevenuePoint,
  MonthlyRevenuePoint,
  YearlyRevenuePoint,
  BillsBreakdown,
  PackagePerformance,
  PaymentMethodBreakdown,
  CashierPerformance,
} from './dashboard.types';
import { billService } from '../bills/bill.service';
import type { BillPublic } from '../bills/bill.types';

/**
 * Revenue-recognized bills are those that were actually paid for at some point - PAID
 * and REFUNDED both count, since a refund is a reversal of a real transaction, not the
 * absence of one. CANCELLED bills never entered revenue and are tracked separately.
 */
function revenueRecognizedMatch(start: Date, end: Date) {
  return {
    status: { $in: [BillStatus.PAID, BillStatus.REFUNDED] },
    paidAt: { $gte: start, $lte: end },
  };
}

async function resolveRange(query: DashboardQuery) {
  const settings = await settingsService.getRaw();
  const { start, end } = resolveDateRange(settings.timezone, query);
  return { start, end, timezone: settings.timezone };
}

export const dashboardService = {
  async getSummary(query: DashboardQuery): Promise<DashboardSummary> {
    const { start, end } = await resolveRange(query);
    const match = revenueRecognizedMatch(start, end);

    const [totals] = await BillModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          grossRevenue: { $sum: '$subtotal' },
          discounts: { $sum: '$discount' },
          refunds: { $sum: { $cond: [{ $eq: ['$status', BillStatus.REFUNDED] }, '$grandTotal', 0] } },
          paidBillsCount: { $sum: { $cond: [{ $eq: ['$status', BillStatus.PAID] }, 1, 0] } },
          refundedBillsCount: { $sum: { $cond: [{ $eq: ['$status', BillStatus.REFUNDED] }, 1, 0] } },
          paidGrandTotalSum: { $sum: { $cond: [{ $eq: ['$status', BillStatus.PAID] }, '$grandTotal', 0] } },
          childrenServed: { $sum: { $size: '$items' } },
          cashAmount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CASH] }, '$grandTotal', 0] } },
          cashCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CASH] }, 1, 0] } },
          cardAmount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CARD] }, '$grandTotal', 0] } },
          cardCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CARD] }, 1, 0] } },
          bankTransferAmount: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.BANK_TRANSFER] }, '$grandTotal', 0] },
          },
          bankTransferCount: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.BANK_TRANSFER] }, 1, 0] },
          },
          otherAmount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.OTHER] }, '$grandTotal', 0] } },
          otherCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.OTHER] }, 1, 0] } },
        },
      },
    ]);

    const [cancelledCount] = await BillModel.aggregate([
      { $match: { status: BillStatus.CANCELLED, cancelledAt: { $gte: start, $lte: end } } },
      { $count: 'count' },
    ]);

    const [bestSellingPackage] = await BillModel.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.playPackageId',
          packageName: { $last: '$items.packageName' },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { quantitySold: -1 } },
      { $limit: 1 },
    ]);

    const [topCashier] = await BillModel.aggregate([
      { $match: { ...match, status: BillStatus.PAID } },
      {
        $group: {
          _id: '$cashierId',
          cashierName: { $last: '$cashierName' },
          revenue: { $sum: '$grandTotal' },
          billCount: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 1 },
    ]);

    const grossRevenue = totals?.grossRevenue ?? 0;
    const discounts = totals?.discounts ?? 0;
    const refunds = totals?.refunds ?? 0;
    const paidBillsCount = totals?.paidBillsCount ?? 0;
    const paidGrandTotalSum = totals?.paidGrandTotalSum ?? 0;

    return {
      grossRevenue,
      discounts,
      refunds,
      netRevenue: grossRevenue - discounts - refunds,
      paidBillsCount,
      cancelledBillsCount: cancelledCount?.count ?? 0,
      refundedBillsCount: totals?.refundedBillsCount ?? 0,
      averageBillValue: paidBillsCount > 0 ? Math.round(paidGrandTotalSum / paidBillsCount) : 0,
      childrenServed: totals?.childrenServed ?? 0,
      cashPayments: { amount: totals?.cashAmount ?? 0, count: totals?.cashCount ?? 0 },
      cardPayments: { amount: totals?.cardAmount ?? 0, count: totals?.cardCount ?? 0 },
      bankTransferPayments: { amount: totals?.bankTransferAmount ?? 0, count: totals?.bankTransferCount ?? 0 },
      otherPayments: { amount: totals?.otherAmount ?? 0, count: totals?.otherCount ?? 0 },
      bestSellingPackage: bestSellingPackage
        ? {
            playPackageId: bestSellingPackage._id.toString(),
            packageName: bestSellingPackage.packageName,
            quantitySold: bestSellingPackage.quantitySold,
            revenue: bestSellingPackage.revenue,
          }
        : null,
      topCashier: topCashier
        ? {
            cashierId: topCashier._id.toString(),
            cashierName: topCashier.cashierName,
            revenue: topCashier.revenue,
            billCount: topCashier.billCount,
          }
        : null,
    };
  },

  async getRevenue(
    query: RevenueQuery,
  ): Promise<Array<DailyRevenuePoint | MonthlyRevenuePoint | YearlyRevenuePoint>> {
    const { start, end, timezone } = await resolveRange(query);
    const groupBy = query.groupBy ?? 'day';
    const dateFormat = groupBy === 'day' ? '%Y-%m-%d' : groupBy === 'month' ? '%Y-%m' : '%Y';

    const rows = await BillModel.aggregate([
      { $match: revenueRecognizedMatch(start, end) },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$paidAt', timezone } },
          grossRevenue: { $sum: '$subtotal' },
          discounts: { $sum: '$discount' },
          refunds: { $sum: { $cond: [{ $eq: ['$status', BillStatus.REFUNDED] }, '$grandTotal', 0] } },
          billCount: { $sum: 1 },
          childrenCount: { $sum: { $size: '$items' } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return rows.map((row) => {
      const netRevenue = row.grossRevenue - row.discounts - row.refunds;
      const base = {
        grossRevenue: row.grossRevenue,
        discounts: row.discounts,
        refunds: row.refunds,
        netRevenue,
        billCount: row.billCount,
        childrenCount: row.childrenCount,
      };

      if (groupBy === 'day') return { date: row._id, ...base } as DailyRevenuePoint;
      if (groupBy === 'month') return { month: row._id, ...base } as MonthlyRevenuePoint;
      return { year: Number(row._id), ...base } as YearlyRevenuePoint;
    });
  },

  async getBillsBreakdown(query: DashboardQuery): Promise<BillsBreakdown> {
    const { start, end } = await resolveRange(query);

    const rows = await BillModel.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const breakdown: BillsBreakdown = { DRAFT: 0, PAID: 0, CANCELLED: 0, REFUNDED: 0 };
    for (const row of rows) {
      breakdown[row._id as keyof BillsBreakdown] = row.count;
    }
    return breakdown;
  },

  async getPackagePerformance(query: DashboardQuery): Promise<PackagePerformance[]> {
    const { start, end } = await resolveRange(query);

    const rows = await BillModel.aggregate([
      { $match: revenueRecognizedMatch(start, end) },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.playPackageId',
          packageName: { $last: '$items.packageName' },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    return rows.map((row) => ({
      playPackageId: row._id.toString(),
      packageName: row.packageName,
      quantitySold: row.quantitySold,
      revenue: row.revenue,
    }));
  },

  async getPaymentMethodBreakdown(query: DashboardQuery): Promise<PaymentMethodBreakdown[]> {
    const { start, end } = await resolveRange(query);

    const rows = await BillModel.aggregate([
      { $match: { ...revenueRecognizedMatch(start, end), status: BillStatus.PAID } },
      {
        $group: {
          _id: '$paymentMethod',
          amount: { $sum: '$grandTotal' },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]);

    return rows.map((row) => ({
      paymentMethod: row._id,
      amount: row.amount,
      count: row.count,
    }));
  },

  async getCashierPerformance(query: DashboardQuery): Promise<CashierPerformance[]> {
    const { start, end } = await resolveRange(query);

    const [revenueRows, cancelledRows] = await Promise.all([
      BillModel.aggregate([
        { $match: { ...revenueRecognizedMatch(start, end), status: BillStatus.PAID } },
        {
          $group: {
            _id: '$cashierId',
            cashierName: { $last: '$cashierName' },
            billCount: { $sum: 1 },
            revenue: { $sum: '$grandTotal' },
            discountsGiven: { $sum: '$discount' },
          },
        },
      ]),
      BillModel.aggregate([
        { $match: { status: BillStatus.CANCELLED, cancelledAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$cashierId', cancelledCount: { $sum: 1 } } },
      ]),
    ]);

    const cancelledByCashier = new Map(cancelledRows.map((row) => [row._id.toString(), row.cancelledCount]));

    return revenueRows
      .map((row) => ({
        cashierId: row._id.toString(),
        cashierName: row.cashierName,
        billCount: row.billCount,
        revenue: row.revenue,
        discountsGiven: row.discountsGiven,
        cancelledCount: cancelledByCashier.get(row._id.toString()) ?? 0,
        averageBillValue: row.billCount > 0 ? Math.round(row.revenue / row.billCount) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  },

  async getRecentBills(query: RecentBillsQuery): Promise<BillPublic[]> {
    const { bills } = await billService.list({
      page: 1,
      limit: query.limit,
      sort: 'newest',
    });
    return bills;
  },
};
