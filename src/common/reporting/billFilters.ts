import { BillStatus } from '../constants/billStatus';
import { BillItemKind } from '../constants/billItemKind';

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
