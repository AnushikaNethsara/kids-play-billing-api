import { BillStatus } from '../../common/constants/billStatus';
import { BillItemKind } from '../../common/constants/billItemKind';
import { EXCLUDE_TEST_BILLS } from '../../common/reporting/billFilters';

/**
 * What a "visit" is, defined once. Every customer figure - the counters on the customer
 * record, the profile, the customers report, the loyalty count at the till - reads it
 * from here, so no two screens can disagree about how often a family has been.
 *
 * A visit is **one business day on which the family had at least one paid bill with play
 * time on it** (a PLAY or GROUP line). Deliberately not "one bill":
 *
 * - Siblings on separate tickets checked out on separate bills are one visit, not two.
 * - A pair of socks bought on its own is a sale, not a visit.
 * - A refunded bill still counts: the family came and played, the money went back.
 * - A cancelled bill never counts, and a test bill is not a real transaction.
 */
export const VISIT_BILL_MATCH = {
  ...EXCLUDE_TEST_BILLS,
  status: { $in: [BillStatus.PAID, BillStatus.REFUNDED] },
  // `null` matches lines written before kinds existed, all of which were PLAY lines.
  items: { $elemMatch: { kind: { $in: [BillItemKind.PLAY, BillItemKind.GROUP, null] } } },
} as const;

/** Bills whose money the business kept: what a family has actually spent. */
export const SPEND_BILL_MATCH = {
  ...EXCLUDE_TEST_BILLS,
  status: BillStatus.PAID,
} as const;

/**
 * The business day a bill belongs to, as `YYYY-MM-DD` in the business timezone - the
 * server runs in UTC, and a 7am visit in Colombo is still "yesterday" there.
 */
export function visitDayExpr(timezone: string) {
  return { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone } } as const;
}

/**
 * Which family a bill belongs to. The phone number is the identity - it is on every bill
 * that has one, whereas `customerId` was only ever set when a cashier picked a matched
 * customer. A bill with neither is an anonymous walk-in and resolves to `null`.
 */
export const FAMILY_KEY = {
  $cond: [
    { $gt: [{ $ifNull: ['$phoneNumber', ''] }, ''] },
    '$phoneNumber',
    { $cond: [{ $ifNull: ['$customerId', false] }, { $toString: '$customerId' }, null] },
  ],
} as const;

/** The bills of one customer record: by its phone number and by any bill linked to it. */
export function customerBillsMatch(customer: { _id: unknown; phoneNumber: string }) {
  return customer.phoneNumber
    ? { $or: [{ phoneNumber: customer.phoneNumber }, { customerId: customer._id }] }
    : { customerId: customer._id };
}
