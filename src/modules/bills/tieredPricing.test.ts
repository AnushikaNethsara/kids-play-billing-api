import { describe, it, expect } from 'vitest';
import {
  applyRounding,
  priceSession,
  priceSessionForPeriod,
  type SessionRateSnapshot,
} from './billCalculator';
import {
  OvertimeMode,
  RoundingMode,
  SessionPricingMode,
  type TieredPricing,
} from '../../common/constants/pricingModes';
import { ValidationError } from '../../common/errors';

/**
 * The business's worked example: LKR 600 / 500 / 400, then 400 an hour from the 4th hour,
 * with 10 minutes of grace after each hour. The same table is pinned in
 * web-app/src/lib/rate.test.ts and mobile/KidsPlayCashier/src/lib/sessionBilling.test.ts;
 * change all three together or none.
 */
const TIERS: TieredPricing = {
  hourlyRates: [60_000, 50_000, 40_000, 40_000],
  overtimeMode: OvertimeMode.PER_MINUTE,
  overtimeBlockMinutes: 15,
  roundingStep: 0,
  roundingMode: RoundingMode.NEAREST,
};

function tieredRate(overrides: Partial<TieredPricing> = {}, graceMinutes = 10): SessionRateSnapshot {
  return {
    pricingMode: SessionPricingMode.TIERED_HOURLY,
    unitPrice: TIERS.hourlyRates[0],
    rateDurationMinutes: 60,
    graceMinutes,
    tieredPricing: { ...TIERS, ...overrides },
  };
}

describe('TIERED_HOURLY pricing', () => {
  describe('per minute, no rounding', () => {
    it.each([
      [1, 60_000], // the 1st hour is the minimum
      [30, 60_000],
      [60, 60_000],
      [70, 60_000], // inside grace
      [71, 69_167], // 1h11m: 600 + 500 x 11/60 = 691.67
      [120, 110_000],
      [130, 110_000], // inside grace after 2h
      [131, 117_333], // 2h11m: 600 + 500 + 400 x 11/60 = 1,173.33
      [180, 150_000],
      [191, 157_333], // extra time at the 4th-hour rate
      [240, 190_000], // 4h: 600 + 500 + 400 + 400
      [251, 197_333], // extra time at the repeating rate
      [300, 230_000], // the 5th hour is 400 again
    ])('%i minutes costs %i', (minutes, expected) => {
      expect(priceSession(tieredRate(), minutes).lineTotal).toBe(expected);
    });

    it('splits 2h11m into hours and extra time that add up to the total', () => {
      const breakdown = priceSession(tieredRate(), 131);

      expect(breakdown.hourLines).toEqual([
        { hour: 1, rate: 60_000, amount: 60_000 },
        { hour: 2, rate: 50_000, amount: 50_000 },
      ]);
      expect(breakdown.overtime).toEqual({
        hour: 3,
        rate: 40_000,
        minutes: 11,
        chargedMinutes: 11,
        amount: 7_333,
      });
      expect(breakdown.rawTotal).toBe(117_333);
      expect(breakdown.roundingAdjustment).toBe(0);
      expect(breakdown.inExtraTime).toBe(true);
      expect(breakdown.graceApplied).toBe(false);
    });

    it('reports grace as applied, with no extra time, inside the grace', () => {
      const breakdown = priceSession(tieredRate(), 65);

      expect(breakdown.overtime).toBeNull();
      expect(breakdown.graceApplied).toBe(true);
      expect(breakdown.inExtraTime).toBe(false);
    });

    it('counts down to the next charge', () => {
      expect(priceSession(tieredRate(), 30).minutesUntilNextCharge).toBe(41);
      expect(priceSession(tieredRate(), 60).minutesUntilNextCharge).toBe(11);
      expect(priceSession(tieredRate(), 70).minutesUntilNextCharge).toBe(1);
      expect(priceSession(tieredRate(), 71).minutesUntilNextCharge).toBe(0);
    });

    it('never lowers the total as time passes', () => {
      let previous = 0;
      for (let minutes = 1; minutes <= 400; minutes += 1) {
        const { lineTotal } = priceSession(tieredRate(), minutes);
        expect(lineTotal).toBeGreaterThanOrEqual(previous);
        previous = lineTotal;
      }
    });

    it('charges from the first minute past the hour with no grace', () => {
      expect(priceSession(tieredRate({}, 0), 61).lineTotal).toBe(60_000 + 833);
    });
  });

  describe('overtime in 15-minute blocks', () => {
    const blocks = { overtimeMode: OvertimeMode.BLOCK, overtimeBlockMinutes: 15 };

    it.each([
      [70, 60_000], // inside grace
      [71, 72_500], // 1 block of 15m at 500
      [75, 72_500],
      [76, 85_000], // 2 blocks
      [85, 85_000],
      [119, 110_000], // 4 blocks, capped at the hour, equals 2h
      [120, 110_000],
    ])('%i minutes costs %i', (minutes, expected) => {
      expect(priceSession(tieredRate(blocks), minutes).lineTotal).toBe(expected);
    });

    it('reports played and charged minutes separately', () => {
      const breakdown = priceSession(tieredRate(blocks), 71);
      expect(breakdown.overtime).toMatchObject({ minutes: 11, chargedMinutes: 15, amount: 12_500 });
    });

    it('counts down to the start of the next block', () => {
      expect(priceSession(tieredRate(blocks), 71).minutesUntilNextCharge).toBe(5);
      expect(priceSession(tieredRate(blocks), 75).minutesUntilNextCharge).toBe(1);
    });

    it('caps a block that does not divide the hour at the hour', () => {
      const breakdown = priceSession(tieredRate({ ...blocks, overtimeBlockMinutes: 45 }), 110);
      expect(breakdown.overtime).toMatchObject({ minutes: 50, chargedMinutes: 60, amount: 50_000 });
    });
  });

  describe('rounding the total', () => {
    it.each([
      [69_167, 1_000, RoundingMode.UP, 70_000],
      [69_167, 1_000, RoundingMode.DOWN, 69_000],
      [69_167, 1_000, RoundingMode.NEAREST, 69_000],
      [69_167, 100, RoundingMode.NEAREST, 69_200],
      [117_333, 5_000, RoundingMode.NEAREST, 115_000],
      [117_333, 5_000, RoundingMode.UP, 120_000],
      [190_000, 10_000, RoundingMode.UP, 190_000],
      [190_000, 10_000, RoundingMode.DOWN, 190_000],
      [115_000, 10_000, RoundingMode.NEAREST, 120_000], // a tie rounds up
      [69_167, 0, RoundingMode.UP, 69_167], // no rounding
    ])('rounds %i by %i %s to %i', (amount, step, mode, expected) => {
      expect(applyRounding(amount, step, mode)).toBe(expected);
    });

    it('rounds the session total and reports the adjustment', () => {
      const breakdown = priceSession(
        tieredRate({ roundingStep: 1_000, roundingMode: RoundingMode.UP }),
        71,
      );

      expect(breakdown.rawTotal).toBe(69_167);
      expect(breakdown.lineTotal).toBe(70_000);
      expect(breakdown.roundingAdjustment).toBe(833);
    });

    it('reports a negative adjustment when rounding down', () => {
      const breakdown = priceSession(
        tieredRate({ roundingStep: 1_000, roundingMode: RoundingMode.DOWN }),
        71,
      );

      expect(breakdown.lineTotal).toBe(69_000);
      expect(breakdown.roundingAdjustment).toBe(-167);
    });

    it('always reconciles: hours + extra + rounding = total', () => {
      const rate = tieredRate({ roundingStep: 5_000, roundingMode: RoundingMode.NEAREST });
      for (let minutes = 1; minutes <= 400; minutes += 7) {
        const breakdown = priceSession(rate, minutes);
        const hours = breakdown.hourLines.reduce((sum, line) => sum + line.amount, 0);
        expect(hours + (breakdown.overtime?.amount ?? 0)).toBe(breakdown.rawTotal);
        expect(breakdown.rawTotal + breakdown.roundingAdjustment).toBe(breakdown.lineTotal);
      }
    });
  });

  describe('priceSessionForPeriod', () => {
    const checkInAt = new Date('2026-10-03T10:00:00.000Z');

    it('does not apply the minimum billable minutes; the 1st hour is the floor', () => {
      const result = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-10-03T10:02:00.000Z'),
        rate: tieredRate(),
        minimumBillableMinutes: 15,
      });

      expect(result.billedMinutes).toBe(2);
      expect(result.minimumApplied).toBe(false);
      expect(result.breakdown.lineTotal).toBe(60_000);
    });

    it('prices the grace boundary from real timestamps', () => {
      const atGrace = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-10-03T11:10:00.000Z'),
        rate: tieredRate(),
        minimumBillableMinutes: 15,
      });
      expect(atGrace.breakdown.lineTotal).toBe(60_000);

      const pastGrace = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-10-03T11:10:01.000Z'),
        rate: tieredRate(),
        minimumBillableMinutes: 15,
      });
      expect(pastGrace.billedMinutes).toBe(71);
      expect(pastGrace.breakdown.lineTotal).toBe(69_167);
    });
  });

  describe('bad input', () => {
    it('throws when a tiered rate has no tiers', () => {
      expect(() => priceSession({ ...tieredRate(), tieredPricing: null }, 60)).toThrow(
        ValidationError,
      );
    });

    it('throws on an unknown mode rather than pricing it pro-rata', () => {
      const rate = { ...tieredRate(), pricingMode: 'MYSTERY' as SessionPricingMode };
      expect(() => priceSession(rate, 60)).toThrow(ValidationError);
    });

    it('throws on negative minutes', () => {
      expect(() => priceSession(tieredRate(), -1)).toThrow(ValidationError);
    });
  });

  describe('other modes are unchanged', () => {
    it('fills the tier fields with neutral values for PRORATA and BLOCK_WITH_GRACE', () => {
      const prorata = priceSession(
        { pricingMode: SessionPricingMode.PRORATA, unitPrice: 60_000, rateDurationMinutes: 60, graceMinutes: 0 },
        71,
      );
      expect(prorata).toMatchObject({ lineTotal: 71_000, hourLines: [], overtime: null, rawTotal: 71_000, roundingAdjustment: 0 });

      const block = priceSession(
        { pricingMode: SessionPricingMode.BLOCK_WITH_GRACE, unitPrice: 60_000, rateDurationMinutes: 60, graceMinutes: 10 },
        71,
      );
      expect(block).toMatchObject({ lineTotal: 71_000, hourLines: [], overtime: null, rawTotal: 71_000, roundingAdjustment: 0 });
    });
  });
});
