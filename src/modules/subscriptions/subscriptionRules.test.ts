import { describe, it, expect } from 'vitest';
import {
  computeExpiresAt,
  creditsForStay,
  creditsPerChildForStay,
  nextCreditAtMinute,
  normaliseChildName,
  resolveSubscriptionStatus,
} from './subscriptionRules';

describe('creditsPerChildForStay', () => {
  const rule = { visitMinutes: 60, graceMinutes: 10 };

  it.each([
    [1, 1],
    [20, 1],
    [60, 1],
    // Inside the grace after the first block.
    [70, 1],
    [71, 2],
    [120, 2],
    [130, 2],
    [131, 3],
  ])('a %i-minute stay uses %i credit(s)', (elapsedMinutes, expected) => {
    expect(creditsPerChildForStay({ elapsedMinutes, ...rule })).toBe(expected);
  });

  it('never charges less than one credit, even for a minute', () => {
    expect(creditsPerChildForStay({ elapsedMinutes: 0, visitMinutes: 120, graceMinutes: 0 })).toBe(1);
  });

  it('without grace, every started block past the first costs a credit', () => {
    expect(creditsPerChildForStay({ elapsedMinutes: 61, visitMinutes: 60, graceMinutes: 0 })).toBe(2);
  });
});

describe('creditsForStay', () => {
  it('multiplies by the children on the ticket', () => {
    expect(creditsForStay({ elapsedMinutes: 75, visitMinutes: 60, graceMinutes: 10, childCount: 3 })).toBe(6);
  });
});

describe('nextCreditAtMinute', () => {
  it('is just past the grace of the block being played', () => {
    expect(nextCreditAtMinute({ creditsPerChild: 1, visitMinutes: 60, graceMinutes: 10 })).toBe(71);
    expect(nextCreditAtMinute({ creditsPerChild: 2, visitMinutes: 60, graceMinutes: 10 })).toBe(131);
  });

  it('agrees with creditsPerChildForStay at the boundary', () => {
    const rule = { visitMinutes: 45, graceMinutes: 5 };
    for (let credits = 1; credits <= 4; credits += 1) {
      const at = nextCreditAtMinute({ creditsPerChild: credits, ...rule });
      expect(creditsPerChildForStay({ elapsedMinutes: at - 1, ...rule })).toBe(credits);
      expect(creditsPerChildForStay({ elapsedMinutes: at, ...rule })).toBe(credits + 1);
    }
  });
});

describe('computeExpiresAt', () => {
  const tz = 'Asia/Colombo';

  it('runs to the end of the same day next month in the business timezone', () => {
    // 5 Oct 2026, 10:00 in Colombo.
    const expires = computeExpiresAt(new Date('2026-10-05T04:30:00Z'), tz);
    // 5 Nov 2026 23:59:59.999 in Colombo is 18:29:59.999 UTC.
    expect(expires.toISOString()).toBe('2026-11-05T18:29:59.999Z');
  });

  it('uses the business date, not the UTC date', () => {
    // 25 Oct 2026, 01:00 in Colombo - still 24 Oct in UTC.
    const expires = computeExpiresAt(new Date('2026-10-24T19:30:00Z'), tz);
    expect(expires.toISOString()).toBe('2026-11-25T18:29:59.999Z');
  });

  it('clamps to the last day of a shorter month', () => {
    expect(computeExpiresAt(new Date('2027-01-31T06:00:00Z'), tz).toISOString()).toBe('2027-02-28T18:29:59.999Z');
    expect(computeExpiresAt(new Date('2028-01-31T06:00:00Z'), tz).toISOString()).toBe('2028-02-29T18:29:59.999Z');
  });
});

describe('resolveSubscriptionStatus', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const base = { status: 'ACTIVE', expiresAt: new Date('2026-11-01T00:00:00Z'), creditsUsed: 2, creditsTotal: 8 };

  it('derives EXPIRED and EXHAUSTED rather than storing them', () => {
    expect(resolveSubscriptionStatus(base, now)).toBe('ACTIVE');
    expect(resolveSubscriptionStatus({ ...base, creditsUsed: 8 }, now)).toBe('EXHAUSTED');
    expect(resolveSubscriptionStatus({ ...base, expiresAt: now }, now)).toBe('EXPIRED');
    expect(resolveSubscriptionStatus({ ...base, status: 'CANCELLED' }, now)).toBe('CANCELLED');
  });
});

describe('normaliseChildName', () => {
  it('ignores case and stray spaces', () => {
    expect(normaliseChildName('  Amal   Perera ')).toBe(normaliseChildName('amal perera'));
  });
});
