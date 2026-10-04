import { BillStatus } from '../constants/billStatus';
import { BillItemKind } from '../constants/billItemKind';
import { SessionPricingMode } from '../constants/pricingModes';

/**
 * Match fragments and aggregation expressions shared by every pipeline that reports on
 * income - the dashboard and the reports module. They live in one place so a report and
 * the dashboard tile it is checked against cannot quietly disagree.
 */

/**
 * Bills an admin has flagged as tests - training runs, printer checks, demos - are not
 * business activity and are excluded from every income figure, dashboard and reports
 * alike, including the counts, not just the money.
 *
 * `$ne: true` rather than `false` deliberately: bills written before the flag existed
 * carry no such field at all, and matching on `false` would silently drop all of them
 * from history.
 */
export const EXCLUDE_TEST_BILLS = { isTestBill: { $ne: true } } as const;

/** The same exclusion, on the sessions those bills were checked out from. */
export const EXCLUDE_TEST_SESSIONS = { isTestBill: { $ne: true } } as const;

/**
 * Revenue-recognized bills are those that were actually paid for at some point - PAID
 * and REFUNDED both count, since a refund is a reversal of a real transaction, not the
 * absence of one. CANCELLED bills never entered revenue and are tracked separately.
 */
export function revenueRecognizedMatch(start: Date, end: Date) {
  return {
    ...EXCLUDE_TEST_BILLS,
    status: { $in: [BillStatus.PAID, BillStatus.REFUNDED] },
    paidAt: { $gte: start, $lte: end },
  };
}

/**
 * A line's kind as an aggregation expression. Lines written before kinds existed carry no
 * such key in the raw BSON, and every one of them was a PLAY line.
 */
export const ITEM_KIND = { $ifNull: ['$$item.kind', BillItemKind.PLAY] } as const;

/**
 * Children through the door on a bill: one per PLAY line, the headcount of a GROUP line,
 * and nobody for a pair of socks. Counting lines, as this used to, would report a group of
 * twenty as one child and every pair of socks as another.
 *
 * An expression over one bill, not an accumulator: inside `$group` it has to be wrapped in
 * another `$sum`, because a `$group` `$sum` silently ignores an array operand.
 */
export const CHILDREN_ON_BILL = {
  $sum: {
    $map: {
      input: '$items',
      as: 'item',
      in: {
        $switch: {
          branches: [
            { case: { $eq: [ITEM_KIND, BillItemKind.GROUP] }, then: '$$item.quantity' },
            { case: { $eq: [ITEM_KIND, BillItemKind.PRODUCT] }, then: 0 },
          ],
          default: 1,
        },
      },
    },
  },
} as const;

/** After `$unwind: '$items'`: keeps only the lines that are a child on a play package. */
export const PLAY_LINES_ONLY = {
  $match: { 'items.kind': { $nin: [BillItemKind.GROUP, BillItemKind.PRODUCT] } },
} as const;

/**
 * A bill's line revenue of one kind, as an expression over one bill. Lines are summed
 * before bill-level discount and tax, like the summary's `revenueByKind`.
 */
export function lineRevenueOfKind(kind: BillItemKind) {
  return {
    $sum: {
      $map: {
        input: '$items',
        as: 'item',
        in: { $cond: [{ $eq: [ITEM_KIND, kind] }, '$$item.lineTotal', 0] },
      },
    },
  };
}

/**
 * A bill's grand total if it is still PAID with this method, else 0. Refunded bills are
 * left out, as in the dashboard's payment-method breakdown: their money went back.
 */
export function paidAmountWithMethod(method: string) {
  return {
    $cond: [
      { $and: [{ $eq: ['$status', BillStatus.PAID] }, { $eq: ['$paymentMethod', method] }] },
      '$grandTotal',
      0,
    ],
  };
}

/**
 * 1 for a closed session billed at or under the minimum, else 0. The floor applies only to
 * pro-rata pricing, so a short block or tiered visit is not one of these - counting it
 * would report a minimum that was never applied. The `$ifNull` is load-bearing: an
 * aggregation reads raw BSON, where a session written before pricing modes has no such
 * key at all and Mongoose's schema default never runs.
 */
export function minimumAppliedExpr(minimumBillableMinutes: number) {
  return {
    $cond: [
      {
        $and: [
          { $lte: ['$billedMinutes', minimumBillableMinutes] },
          { $eq: [{ $ifNull: ['$pricingMode', SessionPricingMode.PRORATA] }, SessionPricingMode.PRORATA] },
        ],
      },
      1,
      0,
    ],
  };
}
