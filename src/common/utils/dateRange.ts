import { DateTime } from 'luxon';
import { ValidationError } from '../errors';

/**
 * Named periods every range-taking endpoint accepts. One list, imported by each
 * validation schema, so the dashboard and the reports cannot offer different presets.
 */
export const NAMED_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
] as const;

export type ReportPeriod = (typeof NAMED_PERIODS)[number] | 'custom';

export interface ResolvedDateRange {
  start: Date;
  end: Date;
}

/**
 * Resolves a named period or explicit from/to query params into a concrete UTC instant
 * range, anchored to the business timezone so "today" means the business's local day,
 * not the server's.
 */
export function resolveDateRange(
  timezone: string,
  options: { period?: string; from?: string; to?: string },
): ResolvedDateRange {
  const { period, from, to } = options;

  if (from || to) {
    if (!from || !to) {
      throw new ValidationError('Both "from" and "to" query parameters are required together');
    }

    const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
    const end = DateTime.fromISO(to, { zone: timezone }).endOf('day');

    if (!start.isValid || !end.isValid) {
      throw new ValidationError('Invalid "from" or "to" date format, expected YYYY-MM-DD');
    }

    if (end < start) {
      throw new ValidationError('"to" date must not be before "from" date');
    }

    return { start: start.toJSDate(), end: end.toJSDate() };
  }

  const now = DateTime.now().setZone(timezone);

  switch (period ?? 'today') {
    case 'today':
      return { start: now.startOf('day').toJSDate(), end: now.endOf('day').toJSDate() };
    case 'yesterday': {
      const yesterday = now.minus({ days: 1 });
      return { start: yesterday.startOf('day').toJSDate(), end: yesterday.endOf('day').toJSDate() };
    }
    case 'this_week':
      return { start: now.startOf('week').toJSDate(), end: now.endOf('week').toJSDate() };
    case 'last_week': {
      // Weeks start Monday (Luxon's ISO default), the same week this_week uses.
      const lastWeek = now.minus({ weeks: 1 });
      return { start: lastWeek.startOf('week').toJSDate(), end: lastWeek.endOf('week').toJSDate() };
    }
    case 'this_month':
      return { start: now.startOf('month').toJSDate(), end: now.endOf('month').toJSDate() };
    case 'last_month': {
      const lastMonth = now.minus({ months: 1 });
      return { start: lastMonth.startOf('month').toJSDate(), end: lastMonth.endOf('month').toJSDate() };
    }
    case 'this_year':
      return { start: now.startOf('year').toJSDate(), end: now.endOf('year').toJSDate() };
    default:
      throw new ValidationError(
        `Unknown period "${period}". Use one of: ${NAMED_PERIODS.join(', ')}, or from/to`,
      );
  }
}

export function formatBusinessDate(date: Date, timezone: string, format = 'yyyy-MM-dd'): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat(format);
}

export interface ResolvedDayRange {
  /** First business day in range, `YYYY-MM-DD`. */
  fromDay: string;
  /** Last business day in range, `YYYY-MM-DD`, inclusive. */
  toDay: string;
}

/**
 * The same range as `resolveDateRange`, as inclusive business-day strings. For records
 * dated by day rather than by instant (expenses), which compare as plain text.
 */
export function resolveDayRange(
  timezone: string,
  options: { period?: string; from?: string; to?: string },
): ResolvedDayRange {
  const { start, end } = resolveDateRange(timezone, options);
  return { fromDay: formatBusinessDate(start, timezone), toDay: formatBusinessDate(end, timezone) };
}

/** Today's date in the business timezone, `YYYY-MM-DD`. */
export function businessToday(timezone: string): string {
  return DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
}
