import { DateTime } from 'luxon';
import { BillModel } from '../bills/bill.model';
import { FAMILY_KEY, VISIT_BILL_MATCH, visitDayExpr } from '../customers/customerVisits';
import { bucketSkeleton, defaultGroupBy, LUXON_FORMAT } from './periodSummary';
import type { AuthenticatedUser } from '../../common/types/express';
import type { ResolvedReportRange } from './reports.service';
import type {
  CustomerCohort,
  CustomerReport,
  CustomerReportBucket,
  CustomerReportQuery,
  SummaryGroupBy,
} from './reports.types';

/**
 * Who comes back, and when. Every figure is built from one pass over visit days - one
 * row per family per business day, from the shared visit definition - read back to the
 * beginning of the data, because whether a family is "new" depends on whether it has
 * ever been here before, not just whether it came earlier in the range.
 *
 * The aggregation does the grouping Mongo is good at; the cohort and heatmap arithmetic
 * is done here in plain code, where it can be read. A play area's whole history is a few
 * thousand visit days, the same reasoning as the dashboard's occupancy.
 */

const COHORT_MONTHS = 12;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;

interface VisitDayRow {
  _id: { family: string | null; day: string };
  bills: number;
  firstPaidAt: Date;
  /** The earliest check-in or group visit start on the day's bills, when there is one. */
  firstArrivalAt: Date | null;
}

function frequencyLabel(visits: number): '1' | '2-3' | '4-9' | '10+' {
  if (visits <= 1) return '1';
  if (visits <= 3) return '2-3';
  if (visits <= 9) return '4-9';
  return '10+';
}

/** Whole months from `from` to `to`, both `YYYY-MM`. */
function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export async function getCustomerReport(
  query: CustomerReportQuery,
  range: ResolvedReportRange,
  actor: AuthenticatedUser,
): Promise<CustomerReport> {
  const { start, end, timezone, fromDate, toDate } = range;
  const groupBy: SummaryGroupBy = query.groupBy ?? defaultGroupBy(start, end);

  const rows = await BillModel.aggregate<VisitDayRow>([
    { $match: { ...VISIT_BILL_MATCH, paidAt: { $lte: end } } },
    {
      $group: {
        _id: { family: FAMILY_KEY, day: visitDayExpr(timezone) },
        bills: { $sum: 1 },
        firstPaidAt: { $min: '$paidAt' },
        firstArrivalAt: { $min: { $min: { $concatArrays: ['$items.checkInAt', '$items.visitAt'] } } },
      },
    },
  ]);

  // Every family's visit days, oldest first - the whole history up to the range's end.
  const daysByFamily = new Map<string, string[]>();
  for (const row of rows) {
    if (!row._id.family) continue;
    const days = daysByFamily.get(row._id.family) ?? [];
    days.push(row._id.day);
    daysByFamily.set(row._id.family, days);
  }
  const firstDayOf = new Map<string, string>();
  for (const [family, days] of daysByFamily) {
    days.sort();
    firstDayOf.set(family, days[0]);
  }

  const inRange = rows.filter((row) => row._id.day >= fromDate && row._id.day <= toDate);
  const familyVisits = inRange.filter((row) => row._id.family !== null);
  const anonymousVisits = inRange
    .filter((row) => row._id.family === null)
    .reduce((sum, row) => sum + row.bills, 0);

  // --- Summary ---
  const visitsInRange = new Map<string, number>();
  for (const row of familyVisits) {
    const family = row._id.family as string;
    visitsInRange.set(family, (visitsInRange.get(family) ?? 0) + 1);
  }
  const newFamilies = [...visitsInRange.keys()].filter((family) => (firstDayOf.get(family) ?? '') >= fromDate).length;
  const uniqueFamilies = visitsInRange.size;

  // --- New vs returning, per bucket ---
  const bucketOf = (day: string) =>
    DateTime.fromISO(day, { zone: timezone }).toFormat(LUXON_FORMAT[groupBy]);
  const bucketFamilies = new Map<string, { visits: number; families: Set<string>; newFamilies: Set<string> }>();
  for (const row of familyVisits) {
    const family = row._id.family as string;
    const label = bucketOf(row._id.day);
    const entry = bucketFamilies.get(label) ?? { visits: 0, families: new Set(), newFamilies: new Set() };
    entry.visits += 1;
    entry.families.add(family);
    if (firstDayOf.get(family) === row._id.day) entry.newFamilies.add(family);
    bucketFamilies.set(label, entry);
  }
  for (const row of inRange.filter((visit) => visit._id.family === null)) {
    const label = bucketOf(row._id.day);
    const entry = bucketFamilies.get(label) ?? { visits: 0, families: new Set(), newFamilies: new Set() };
    entry.visits += row.bills;
    bucketFamilies.set(label, entry);
  }
  const newVsReturning: CustomerReportBucket[] = bucketSkeleton(start, end, timezone, groupBy).map((bucket) => {
    const entry = bucketFamilies.get(bucket.label);
    const families = entry?.families.size ?? 0;
    const fresh = entry?.newFamilies.size ?? 0;
    return {
      ...bucket,
      visits: entry?.visits ?? 0,
      families,
      newFamilies: fresh,
      returningFamilies: families - fresh,
    };
  });

  // --- Cohorts: the 12 first-visit months ending with the report's end month ---
  const endMonth = toDate.slice(0, 7);
  const cohortMonths = Array.from({ length: COHORT_MONTHS }, (_, index) =>
    DateTime.fromISO(`${endMonth}-01`, { zone: timezone })
      .minus({ months: COHORT_MONTHS - 1 - index })
      .toFormat('yyyy-MM'),
  );
  const cohorts: CustomerCohort[] = cohortMonths.map((month) => {
    const members = [...firstDayOf.entries()]
      .filter(([, firstDay]) => firstDay.startsWith(month))
      .map(([family]) => family);
    const span = monthsBetween(month, endMonth);
    const retention = Array.from({ length: span + 1 }, (_, offset) => {
      if (members.length === 0) return 0;
      const target = DateTime.fromISO(`${month}-01`, { zone: timezone }).plus({ months: offset }).toFormat('yyyy-MM');
      const returned = members.filter((family) =>
        (daysByFamily.get(family) ?? []).some((day) => day.startsWith(target)),
      ).length;
      return returned / members.length;
    });
    return { month, size: members.length, retention };
  });

  // --- How often families came in the range ---
  const histogram = new Map<string, number>([
    ['1', 0],
    ['2-3', 0],
    ['4-9', 0],
    ['10+', 0],
  ]);
  for (const visits of visitsInRange.values()) {
    const label = frequencyLabel(visits);
    histogram.set(label, (histogram.get(label) ?? 0) + 1);
  }

  // --- When visits begin: weekday x hour ---
  const cells = Array.from({ length: DAYS_PER_WEEK * HOURS_PER_DAY }, (_, index) => ({
    weekday: Math.floor(index / HOURS_PER_DAY),
    hour: index % HOURS_PER_DAY,
    newVisits: 0,
    returningVisits: 0,
  }));
  for (const row of familyVisits) {
    const arrival = DateTime.fromJSDate(row.firstArrivalAt ?? row.firstPaidAt, { zone: timezone });
    const cell = cells[(arrival.weekday - 1) * HOURS_PER_DAY + arrival.hour];
    if (firstDayOf.get(row._id.family as string) === row._id.day) cell.newVisits += 1;
    else cell.returningVisits += 1;
  }

  return {
    header: {
      businessName: range.businessName,
      timezone,
      from: fromDate,
      to: toDate,
      generatedAt: new Date(),
      generatedBy: actor.name,
    },
    groupBy,
    summary: {
      uniqueFamilies,
      visits: familyVisits.length + anonymousVisits,
      newFamilies,
      returningFamilies: uniqueFamilies - newFamilies,
      returningShare: uniqueFamilies > 0 ? (uniqueFamilies - newFamilies) / uniqueFamilies : 0,
      anonymousVisits,
    },
    newVsReturning,
    cohorts,
    frequencyHistogram: [...histogram.entries()].map(([label, families]) => ({
      label: label as '1' | '2-3' | '4-9' | '10+',
      families,
    })),
    dayHourHeatmap: cells,
  };
}
