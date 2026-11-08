import {
  CashAdjustmentModel,
  CashAdjustmentStatus,
} from '../../modules/cash-adjustments/cashAdjustment.model';

/**
 * The one definition of "cash over/short" every figure uses: active (not voided) cash
 * adjustments dated inside an inclusive business-day range. A surplus is positive and a
 * shortage negative, so the net is a plain sum. It is never revenue - it is added to
 * profit beside expenses: `netProfit = netRevenue - expenses + cashOverShort`.
 */
export function activeCashAdjustmentsMatch(fromDay: string, toDay: string) {
  return { status: CashAdjustmentStatus.ACTIVE, businessDate: { $gte: fromDay, $lte: toDay } };
}

export interface CashAdjustmentTotals {
  /** surplus + shortage. Signed integer minor units. */
  net: number;
  /** Sum of surpluses, positive or 0. */
  surplus: number;
  /** Sum of shortages, negative or 0. */
  shortage: number;
  count: number;
}

export async function cashAdjustmentTotals(fromDay: string, toDay: string): Promise<CashAdjustmentTotals> {
  const [row] = await CashAdjustmentModel.aggregate<{ surplus: number; shortage: number; count: number }>([
    { $match: activeCashAdjustmentsMatch(fromDay, toDay) },
    {
      $group: {
        _id: null,
        surplus: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
        shortage: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
        count: { $sum: 1 },
      },
    },
  ]);
  const surplus = row?.surplus ?? 0;
  const shortage = row?.shortage ?? 0;
  return { net: surplus + shortage, surplus, shortage, count: row?.count ?? 0 };
}

/** Net cash over/short per business day (`YYYY-MM-DD`), for bucketing by day, week, month or year. */
export async function cashAdjustmentsByDay(
  fromDay: string,
  toDay: string,
): Promise<Array<{ day: string; amount: number }>> {
  const rows = await CashAdjustmentModel.aggregate<{ _id: string; amount: number }>([
    { $match: activeCashAdjustmentsMatch(fromDay, toDay) },
    { $group: { _id: '$businessDate', amount: { $sum: '$amount' } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row) => ({ day: row._id, amount: row.amount }));
}
