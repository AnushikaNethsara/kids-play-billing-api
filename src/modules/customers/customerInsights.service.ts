import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import { customerRepository } from './customer.repository';
import { customerBillsMatch, VISIT_BILL_MATCH, visitDayExpr } from './customerVisits';
import { BillModel, type BillItemSubdocument } from '../bills/bill.model';
import { PlaySessionModel } from '../play-sessions/playSession.model';
import { settingsService } from '../settings/settings.service';
import { resolveLoyaltyVisitInterval } from '../settings/settings.model';
import { BillItemKind } from '../../common/constants/billItemKind';
import { BillStatus } from '../../common/constants/billStatus';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import {
  CHILDREN_ON_BILL,
  EXCLUDE_TEST_SESSIONS,
  SESSION_CHILD_NAMES,
} from '../../common/reporting/billFilters';
import { NotFoundError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { CustomerHydrated } from './customer.model';
import type {
  CustomerLookup,
  CustomerFrequency,
  CustomerProfile,
  CustomerProfileChild,
  CustomerVisitRow,
  ListCustomerVisitsQuery,
} from './customer.types';
import { subscriptionService } from '../subscriptions/subscription.service';

/** How many of a family's children the till suggests. */
const USUAL_CHILDREN = 4;

/** How far back the profile's calendar heatmap reaches. */
const HEATMAP_DAYS = 365;
const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * A family's history, read for the admin's customer profile. Everything here is derived
 * from bills and tickets on request - the volumes for one family are tiny - and every
 * notion of a "visit" comes from `customerVisits.ts`, the same definition the counters on
 * the customer record and the customers report use.
 */

async function loadCustomer(customerId: string): Promise<CustomerHydrated> {
  const customer = await customerRepository.findById(customerId);
  if (!customer) throw new NotFoundError('Customer not found');
  return customer;
}

/** The most frequent value, ties going to the one seen first. Null for an empty list. */
function mostFrequent(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (best === null || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

/**
 * The children named on a bill line. A ticket line joins a family's names with ", "
 * (the session keeps them separately, the bill line only has the display form).
 */
function namesOnLine(item: Pick<BillItemSubdocument, 'childName'>): string[] {
  return (item.childName ?? '')
    .split(', ')
    .map((name) => name.trim())
    .filter(Boolean);
}

function isPlayLine(item: Pick<BillItemSubdocument, 'kind'>): boolean {
  return !item.kind || item.kind === BillItemKind.PLAY;
}

async function childrenOf(customer: CustomerHydrated, timezone: string): Promise<CustomerProfileChild[]> {
  const sessionIdentity = customer.phoneNumber
    ? { $or: [{ phoneNumber: customer.phoneNumber }, { customerId: customer._id }] }
    : { customerId: customer._id };
  const dayOf = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone } });

  type Row = {
    _id: string;
    days: string[];
    firstSeenAt: Date;
    lastSeenAt: Date;
    totalPlayMinutes: number;
    packages: string[];
  };

  // Children who came on a ticket. Voided check-ins never played; test ones were not real.
  const fromTickets = await PlaySessionModel.aggregate<Row>([
    {
      $match: {
        $and: [sessionIdentity, EXCLUDE_TEST_SESSIONS, { status: { $ne: PlaySessionStatus.VOIDED } }],
      },
    },
    {
      $project: {
        name: SESSION_CHILD_NAMES,
        checkInAt: 1,
        billedMinutes: 1,
        packageName: 1,
        day: dayOf('$checkInAt'),
      },
    },
    { $unwind: '$name' },
    {
      $group: {
        _id: '$name',
        days: { $addToSet: '$day' },
        firstSeenAt: { $min: '$checkInAt' },
        lastSeenAt: { $max: '$checkInAt' },
        totalPlayMinutes: { $sum: { $ifNull: ['$billedMinutes', 0] } },
        packages: { $push: '$packageName' },
      },
    },
  ]);

  // Children on a fixed-price bill, which never had a ticket.
  const fromFlatBills = await BillModel.aggregate<Row>([
    { $match: { $and: [customerBillsMatch(customer), VISIT_BILL_MATCH] } },
    { $unwind: '$items' },
    {
      $match: {
        'items.playSessionId': null,
        'items.kind': { $in: [BillItemKind.PLAY, null] },
        'items.childName': { $gt: '' },
      },
    },
    {
      $group: {
        _id: '$items.childName',
        days: { $addToSet: visitDayExpr(timezone) },
        firstSeenAt: { $min: '$paidAt' },
        lastSeenAt: { $max: '$paidAt' },
        totalPlayMinutes: { $sum: '$items.durationMinutes' },
        packages: { $push: '$items.packageName' },
      },
    },
  ]);

  const merged = new Map<string, Row>();
  for (const row of [...fromTickets, ...fromFlatBills]) {
    const existing = merged.get(row._id);
    if (!existing) {
      merged.set(row._id, { ...row, days: [...row.days], packages: [...row.packages] });
      continue;
    }
    existing.days.push(...row.days);
    existing.packages.push(...row.packages);
    existing.totalPlayMinutes += row.totalPlayMinutes;
    if (row.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = row.firstSeenAt;
    if (row.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = row.lastSeenAt;
  }

  return [...merged.values()]
    .map((row) => ({
      name: row._id,
      visits: new Set(row.days).size,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      totalPlayMinutes: row.totalPlayMinutes,
      favouritePackage: mostFrequent(row.packages),
    }))
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

function frequencyOf(
  days: { _id: string; firstPaidAt: Date; lastPaidAt: Date }[],
  timezone: string,
): CustomerFrequency {
  const now = DateTime.now().setZone(timezone);
  // ISO dates compare correctly as strings, so the boundaries can stay as text.
  const weekStart = now.startOf('week').toISODate() as string;
  const monthStart = now.startOf('month').toISODate() as string;
  const last90Start = now.minus({ days: 89 }).toISODate() as string;
  const countFrom = (start: string) => days.filter((day) => day._id >= start).length;

  let averageDaysBetweenVisits: number | null = null;
  if (days.length >= 2) {
    const first = DateTime.fromISO(days[0]._id, { zone: timezone });
    const last = DateTime.fromISO(days[days.length - 1]._id, { zone: timezone });
    const span = last.diff(first, 'days').days;
    averageDaysBetweenVisits = Math.round((span / (days.length - 1)) * 10) / 10;
  }

  return {
    totalVisits: days.length,
    visitsThisWeek: countFrom(weekStart),
    visitsThisMonth: countFrom(monthStart),
    visitsLast90Days: countFrom(last90Start),
    averageDaysBetweenVisits,
    firstVisitAt: days[0]?.firstPaidAt ?? null,
    lastVisitAt: days[days.length - 1]?.lastPaidAt ?? null,
  };
}

/** When the children went in and came out across the day's play lines. */
function playWindow(items: BillItemSubdocument[]): { timeIn: Date | null; timeOut: Date | null } {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const item of items) {
    if (item.checkInAt) starts.push(new Date(item.checkInAt).getTime());
    if (item.checkOutAt) ends.push(new Date(item.checkOutAt).getTime());
    if (item.visitAt) {
      const start = new Date(item.visitAt).getTime();
      starts.push(start);
      ends.push(start + (item.visitMinutes ?? 0) * MILLISECONDS_PER_MINUTE);
    }
  }
  return {
    timeIn: starts.length ? new Date(Math.min(...starts)) : null,
    timeOut: ends.length ? new Date(Math.max(...ends)) : null,
  };
}

export const customerInsightsService = {
  /**
   * The till's view of a family, by phone number: null when the number is new. Open to
   * cashiers - it carries no money beyond what the parent would tell them anyway.
   */
  async lookup(phoneNumber: string): Promise<CustomerLookup | null> {
    const customer = await customerRepository.findByPhoneNumber(phoneNumber);
    if (!customer) return null;
    const settings = await settingsService.getRaw();
    const { timezone } = settings;

    const days = await BillModel.aggregate<{ _id: string; lastPaidAt: Date }>([
      { $match: { $and: [customerBillsMatch(customer), VISIT_BILL_MATCH] } },
      { $group: { _id: visitDayExpr(timezone), lastPaidAt: { $max: '$paidAt' } } },
      { $sort: { _id: 1 } },
    ]);
    const today = DateTime.now().setZone(timezone).toISODate() as string;
    const visitedToday = days.some((day) => day._id === today);

    const children = await PlaySessionModel.aggregate<{ _id: string }>([
      {
        $match: {
          $and: [
            { phoneNumber: customer.phoneNumber },
            EXCLUDE_TEST_SESSIONS,
            { status: { $ne: PlaySessionStatus.VOIDED } },
          ],
        },
      },
      { $project: { name: SESSION_CHILD_NAMES, checkInAt: 1 } },
      { $unwind: '$name' },
      { $group: { _id: '$name', tickets: { $sum: 1 }, lastSeenAt: { $max: '$checkInAt' } } },
      { $sort: { tickets: -1, lastSeenAt: -1 } },
      { $limit: USUAL_CHILDREN },
    ]);

    const interval = resolveLoyaltyVisitInterval(settings);
    const nextVisitNumber = visitedToday ? days.length : days.length + 1;
    const subscriptions = await subscriptionService.listForCustomer(customer.id);

    return {
      customerId: customer.id,
      parentName: customer.parentName,
      phoneNumber: customer.phoneNumber,
      visitCount: days.length,
      visitedToday,
      lastVisitAt: days[days.length - 1]?.lastPaidAt ?? null,
      usualChildren: children.map((child) => child._id),
      loyalty: {
        interval,
        nextVisitNumber,
        rewardDue: interval > 0 && nextVisitNumber % interval === 0,
      },
      subscriptions,
    };
  },

  async getProfile(customerId: string): Promise<CustomerProfile> {
    const customer = await loadCustomer(customerId);
    const { timezone } = await settingsService.getRaw();

    const days = await BillModel.aggregate<{
      _id: string;
      firstPaidAt: Date;
      lastPaidAt: Date;
      children: number;
    }>([
      { $match: { $and: [customerBillsMatch(customer), VISIT_BILL_MATCH] } },
      {
        $group: {
          _id: visitDayExpr(timezone),
          firstPaidAt: { $min: '$paidAt' },
          lastPaidAt: { $max: '$paidAt' },
          children: { $sum: CHILDREN_ON_BILL },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const heatmapStart = DateTime.now()
      .setZone(timezone)
      .minus({ days: HEATMAP_DAYS - 1 })
      .toISODate() as string;

    return {
      customerId: customer.id,
      children: await childrenOf(customer, timezone),
      frequency: frequencyOf(days, timezone),
      heatmap: days
        .filter((day) => day._id >= heatmapStart)
        .map((day) => ({ day: day._id, children: day.children })),
    };
  },

  async listVisits(customerId: string, query: ListCustomerVisitsQuery) {
    const customer = await loadCustomer(customerId);
    const { timezone } = await settingsService.getRaw();

    type DayBill = {
      _id: Types.ObjectId;
      billNumber: string | null;
      status: BillStatus;
      grandTotal: number;
      items: BillItemSubdocument[];
    };
    const [page] = await BillModel.aggregate<{
      rows: { _id: string; firstPaidAt: Date; bills: DayBill[] }[];
      total: { count: number }[];
    }>([
      { $match: { $and: [customerBillsMatch(customer), VISIT_BILL_MATCH] } },
      { $sort: { paidAt: 1 } },
      {
        $group: {
          _id: visitDayExpr(timezone),
          firstPaidAt: { $min: '$paidAt' },
          bills: {
            $push: {
              _id: '$_id',
              billNumber: '$billNumber',
              status: '$status',
              grandTotal: '$grandTotal',
              items: '$items',
            },
          },
        },
      },
      { $sort: { _id: -1 } },
      {
        $facet: {
          rows: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    const visits: CustomerVisitRow[] = (page?.rows ?? []).map((day) => {
      const items = day.bills.flatMap((bill) => bill.items);
      const playItems = items.filter(isPlayLine);
      const window = playWindow(items);
      return {
        date: day._id,
        timeIn: window.timeIn ?? day.firstPaidAt,
        timeOut: window.timeOut,
        children: [...new Set(playItems.flatMap(namesOnLine))],
        groups: [
          ...new Set(items.filter((item) => item.kind === BillItemKind.GROUP).map((item) => item.packageName)),
        ],
        packages: [...new Set(playItems.map((item) => item.packageName).filter(Boolean))],
        extrasTotal: items
          .filter((item) => item.kind === BillItemKind.PRODUCT)
          .reduce((sum, item) => sum + item.lineTotal, 0),
        amount: day.bills.reduce((sum, bill) => sum + bill.grandTotal, 0),
        refunded: day.bills.some((bill) => bill.status === BillStatus.REFUNDED),
        bills: day.bills.map((bill) => ({ id: bill._id.toString(), billNumber: bill.billNumber ?? null })),
      };
    });

    return {
      visits,
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, page?.total[0]?.count ?? 0),
    };
  },
};
