import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { BillModel } from '../bills/bill.model';
import { CustomerModel } from './customer.model';
import { VISIT_BILL_MATCH, visitDayExpr } from './customerVisits';

/**
 * Segments of the admin's customer list - who is new, who never came back, who is
 * drifting away. Every one is read from the shared visit definition in
 * `customerVisits.ts`, through the derived figures on the customer record (`visitCount`,
 * `firstVisitAt`, `lastVisitAt`) or, for `regular`, from the bills themselves.
 *
 * Nothing is stored per segment: the time-based ones (`one_time`, `lost`) move every day
 * without any bill changing, so they are computed from "now" on every request.
 *
 * Segments overlap on purpose: a regular family is also returning, and a family that
 * came once a year ago is both one-time and lost.
 */
export const CUSTOMER_SEGMENTS = [
  'new',
  'one_time',
  'returning',
  'regular',
  'at_risk',
  'lost',
  'never',
] as const;

export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CUSTOMER_SORT_FIELDS = [
  'createdAt',
  'lastVisitAt',
  'firstVisitAt',
  'visitCount',
  'totalSpent',
  'parentName',
] as const;

export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

/**
 * Segment thresholds, in business days. Fixed for now; if the admin needs to tune them
 * they belong in `BusinessSettings`.
 */
export const SEGMENT_THRESHOLDS = {
  /** A first visit this recent is `new`; a single visit older than this is `one_time`. */
  newDays: 30,
  /** `regular`: at least `regularVisits` visits in the last `regularDays`. */
  regularDays: 90,
  regularVisits: 4,
  /** `at_risk`: a returning family last seen between `atRiskDays` and `lostDays` ago. */
  atRiskDays: 45,
  /** `lost`: last seen longer ago than this. */
  lostDays: 180,
} as const;

/** Start of the business day `days` days before today, as a UTC instant. */
export function daysAgo(days: number, timezone: string, now: Date = new Date()): Date {
  return DateTime.fromJSDate(now).setZone(timezone).startOf('day').minus({ days }).toJSDate();
}

/**
 * A `YYYY-MM-DD` business-date range as a Mongo instant condition: `from` at the start
 * of its day, `to` inclusive (exclusive bound at the start of the next day). Either end
 * may be missing. Null when both are.
 */
export function businessDateRange(
  timezone: string,
  from?: string,
  to?: string,
): { $gte?: Date; $lt?: Date } | null {
  if (!from && !to) return null;
  const range: { $gte?: Date; $lt?: Date } = {};
  if (from) range.$gte = DateTime.fromISO(from, { zone: timezone }).startOf('day').toJSDate();
  if (to) {
    range.$lt = DateTime.fromISO(to, { zone: timezone }).startOf('day').plus({ days: 1 }).toJSDate();
  }
  return range;
}

/**
 * Customers with at least `minVisits` visits (business days) paid within the range.
 *
 * A bill belongs to a customer the same way `customerBillsMatch` says: by the customer's
 * phone number or by a `customerId` link. So the bills are reduced to distinct
 * (day, phone, customerId) triples and each triple credited to every customer it matches -
 * siblings on two bills the same day stay one visit.
 */
export async function customerIdsWithVisits(options: {
  timezone: string;
  paidAt?: { $gte?: Date; $lt?: Date } | null;
  minVisits?: number;
}): Promise<Types.ObjectId[]> {
  const { timezone, paidAt, minVisits = 1 } = options;

  const triples = await BillModel.aggregate<{
    _id: { day: string; phoneNumber: string | null; customerId: Types.ObjectId | null };
  }>([
    { $match: { ...VISIT_BILL_MATCH, ...(paidAt ? { paidAt } : {}) } },
    {
      $group: {
        _id: {
          day: visitDayExpr(timezone),
          phoneNumber: { $ifNull: ['$phoneNumber', null] },
          customerId: { $ifNull: ['$customerId', null] },
        },
      },
    },
  ]);

  const phones = new Set<string>();
  const ids = new Set<string>();
  for (const { _id } of triples) {
    if (_id.phoneNumber) phones.add(_id.phoneNumber);
    if (_id.customerId) ids.add(_id.customerId.toString());
  }
  if (phones.size === 0 && ids.size === 0) return [];

  const customers = await CustomerModel.find(
    {
      $or: [
        { phoneNumber: { $in: [...phones] } },
        { _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) } },
      ],
    },
    { _id: 1, phoneNumber: 1 },
  ).lean();

  const byPhone = new Map<string, string>();
  const known = new Set<string>();
  for (const customer of customers) {
    known.add(customer._id.toString());
    if (customer.phoneNumber) byPhone.set(customer.phoneNumber, customer._id.toString());
  }

  const days = new Map<string, Set<string>>();
  for (const { _id } of triples) {
    const owners = new Set<string>();
    const phoneOwner = _id.phoneNumber ? byPhone.get(_id.phoneNumber) : undefined;
    if (phoneOwner) owners.add(phoneOwner);
    const linked = _id.customerId?.toString();
    if (linked && known.has(linked)) owners.add(linked);
    for (const owner of owners) {
      if (!days.has(owner)) days.set(owner, new Set());
      days.get(owner)?.add(_id.day);
    }
  }

  return [...days.entries()]
    .filter(([, visitDays]) => visitDays.size >= minVisits)
    .map(([id]) => new Types.ObjectId(id));
}

/** The Mongo filter for one segment, relative to `now` in the business timezone. */
export async function segmentFilter(
  segment: CustomerSegment,
  timezone: string,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const t = SEGMENT_THRESHOLDS;
  switch (segment) {
    case 'new':
      return { firstVisitAt: { $gte: daysAgo(t.newDays, timezone, now) } };
    case 'one_time':
      return { visitCount: 1, lastVisitAt: { $lt: daysAgo(t.newDays, timezone, now) } };
    case 'returning':
      return { visitCount: { $gte: 2 } };
    case 'regular': {
      const ids = await customerIdsWithVisits({
        timezone,
        paidAt: { $gte: daysAgo(t.regularDays, timezone, now) },
        minVisits: t.regularVisits,
      });
      return { _id: { $in: ids } };
    }
    case 'at_risk':
      return {
        visitCount: { $gte: 2 },
        lastVisitAt: {
          $lt: daysAgo(t.atRiskDays, timezone, now),
          $gte: daysAgo(t.lostDays, timezone, now),
        },
      };
    case 'lost':
      return { lastVisitAt: { $lt: daysAgo(t.lostDays, timezone, now) } };
    case 'never':
      return { visitCount: 0 };
  }
}
