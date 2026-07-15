import { DateTime } from 'luxon';
import { ValidationError } from '../errors';

export type ReportPeriod =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'custom';

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
    case 'this_month':
      return { start: now.startOf('month').toJSDate(), end: now.endOf('month').toJSDate() };
    case 'this_year':
      return { start: now.startOf('year').toJSDate(), end: now.endOf('year').toJSDate() };
    default:
      throw new ValidationError(
        `Unknown period "${period}". Use one of: today, yesterday, this_week, this_month, this_year, or from/to`,
      );
  }
}

export function formatBusinessDate(date: Date, timezone: string, format = 'yyyy-MM-dd'): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat(format);
}
