import { describe, it, expect, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { bucketSkeleton, defaultGroupBy } from './periodSummary';
import { resolveDateRange } from '../../common/utils/dateRange';

const TZ = 'Asia/Colombo';

function at(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

function local(date: Date): string {
  return DateTime.fromJSDate(date, { zone: TZ }).toFormat('yyyy-MM-dd HH:mm');
}

describe('last_week / last_month presets', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to the previous Monday-Sunday and the previous calendar month', () => {
    vi.useFakeTimers();
    // Wednesday 2026-10-07, mid-morning in Colombo.
    vi.setSystemTime(at('2026-10-07T10:00'));

    const week = resolveDateRange(TZ, { period: 'last_week' });
    expect(local(week.start)).toBe('2026-09-28 00:00');
    expect(local(week.end)).toBe('2026-10-04 23:59');

    const month = resolveDateRange(TZ, { period: 'last_month' });
    expect(local(month.start)).toBe('2026-09-01 00:00');
    expect(local(month.end)).toBe('2026-09-30 23:59');
  });

  it('crosses a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2027-01-03T10:00'));

    const month = resolveDateRange(TZ, { period: 'last_month' });
    expect(local(month.start)).toBe('2026-12-01 00:00');
    expect(local(month.end)).toBe('2026-12-31 23:59');
  });
});

describe('bucketSkeleton', () => {
  it('labels ISO weeks and clips the edge buckets to the range', () => {
    const { start, end } = resolveDateRange(TZ, { from: '2026-10-07', to: '2026-10-20' });
    expect(bucketSkeleton(start, end, TZ, 'week')).toEqual([
      { label: '2026-W41', start: '2026-10-07', end: '2026-10-11' },
      { label: '2026-W42', start: '2026-10-12', end: '2026-10-18' },
      { label: '2026-W43', start: '2026-10-19', end: '2026-10-20' },
    ]);
  });

  it('includes every day, empty or not', () => {
    const { start, end } = resolveDateRange(TZ, { from: '2026-02-27', to: '2026-03-02' });
    expect(bucketSkeleton(start, end, TZ, 'day').map((bucket) => bucket.label)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('builds month buckets', () => {
    const { start, end } = resolveDateRange(TZ, { from: '2026-01-15', to: '2026-03-10' });
    expect(bucketSkeleton(start, end, TZ, 'month')).toEqual([
      { label: '2026-01', start: '2026-01-15', end: '2026-01-31' },
      { label: '2026-02', start: '2026-02-01', end: '2026-02-28' },
      { label: '2026-03', start: '2026-03-01', end: '2026-03-10' },
    ]);
  });
});

describe('defaultGroupBy', () => {
  it('uses days up to a month, weeks up to a quarter, then months', () => {
    const range = (from: string, to: string) => {
      const { start, end } = resolveDateRange(TZ, { from, to });
      return defaultGroupBy(start, end);
    };
    expect(range('2026-10-01', '2026-10-31')).toBe('day');
    expect(range('2026-08-01', '2026-10-31')).toBe('week');
    expect(range('2026-01-01', '2026-10-31')).toBe('month');
  });
});
