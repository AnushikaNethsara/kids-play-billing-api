import { describe, it, expect } from 'vitest';
import { priceSession, priceSessionBestOf, type SessionRateSnapshot } from './billCalculator';
import { OvertimeMode, RoundingMode, SessionPricingMode } from '../../common/constants/pricingModes';

/**
 * The business's two comparable packages, as configured in the admin portal:
 * - HOURLY: LKR 600 / 500 / 400 / 400 per hour, 10m grace, extra per minute, nearest 50.
 * - BLOCK: LKR 350 per 30m, 5m grace.
 * The same pair is pinned in mobile/KidsPlayCashier/src/lib/bestPrice.test.ts.
 */
const HOURLY: SessionRateSnapshot = {
  pricingMode: SessionPricingMode.TIERED_HOURLY,
  unitPrice: 60_000,
  rateDurationMinutes: 60,
  graceMinutes: 10,
  tieredPricing: {
    hourlyRates: [60_000, 50_000, 40_000, 40_000],
    overtimeMode: OvertimeMode.PER_MINUTE,
    overtimeBlockMinutes: 15,
    roundingStep: 5_000,
    roundingMode: RoundingMode.NEAREST,
  },
};

const BLOCK: SessionRateSnapshot = {
  pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
  unitPrice: 35_000,
  rateDurationMinutes: 30,
  graceMinutes: 5,
};

const CHECK_IN = new Date('2026-10-18T04:00:00.000Z');

function bestOf(rates: [SessionRateSnapshot, ...SessionRateSnapshot[]], minutes: number, minimum = 0) {
  return priceSessionBestOf({
    checkInAt: CHECK_IN,
    checkOutAt: new Date(CHECK_IN.getTime() + minutes * 60_000),
    rates,
    minimumBillableMinutes: minimum,
  });
}

describe('priceSessionBestOf', () => {
  it('matches the worked examples on both package cards', () => {
    expect(priceSession(BLOCK, 36).lineTotal).toBe(42_000);
    expect(priceSession(BLOCK, 66).lineTotal).toBe(77_000);
    expect(priceSession(HOURLY, 71).lineTotal).toBe(70_000);
    expect(priceSession(HOURLY, 131).lineTotal).toBe(115_000);
  });

  it('case 1: chose the 30m block, stayed 1h 6m - charged the hourly price', () => {
    const result = bestOf([BLOCK, HOURLY], 66);
    expect(result.index).toBe(1);
    expect(result.rate).toBe(HOURLY);
    expect(result.breakdown.lineTotal).toBe(60_000);
    expect(result.chosenLineTotal).toBe(77_000);
  });

  it('case 2: chose hourly, stayed 30m - charged the 30m block', () => {
    const result = bestOf([HOURLY, BLOCK], 30);
    expect(result.index).toBe(1);
    expect(result.breakdown.lineTotal).toBe(35_000);
    expect(result.chosenLineTotal).toBe(60_000);
  });

  it.each([23, 30, 35, 45, 51, 52, 53, 60, 66, 90, 131, 240, 251])(
    'at %i minutes always charges the cheaper of the two, whichever was chosen',
    (minutes) => {
      const cheapest = Math.min(priceSession(HOURLY, minutes).lineTotal, priceSession(BLOCK, minutes).lineTotal);
      expect(bestOf([HOURLY, BLOCK], minutes).breakdown.lineTotal).toBe(cheapest);
      expect(bestOf([BLOCK, HOURLY], minutes).breakdown.lineTotal).toBe(cheapest);
    },
  );

  it('crosses over from the block to hourly just past 51 minutes', () => {
    expect(bestOf([BLOCK, HOURLY], 51).index).toBe(0);
    expect(bestOf([BLOCK, HOURLY], 53).index).toBe(1);
  });

  it('keeps the chosen package on a tie', () => {
    const twin: SessionRateSnapshot = { ...BLOCK };
    expect(bestOf([BLOCK, twin], 40).index).toBe(0);
    expect(bestOf([twin, BLOCK], 40).index).toBe(0);
  });

  it('prices exactly as the chosen package alone when there is nothing to compare', () => {
    const result = bestOf([BLOCK], 66);
    expect(result.index).toBe(0);
    expect(result.breakdown.lineTotal).toBe(77_000);
    expect(result.chosenLineTotal).toBe(77_000);
  });

  it('applies the minimum billable time to a PRORATA rate only', () => {
    const prorata: SessionRateSnapshot = {
      pricingMode: SessionPricingMode.PRORATA,
      unitPrice: 60_000,
      rateDurationMinutes: 60,
      graceMinutes: 0,
    };
    // 5 minutes floored to 30: 300 pro-rata, against the block's 350.
    const result = bestOf([BLOCK, prorata], 5, 30);
    expect(result.index).toBe(1);
    expect(result.billedMinutes).toBe(30);
    expect(result.breakdown.lineTotal).toBe(30_000);
  });

  it("counts down to the charged rate's next rise", () => {
    // 20 minutes on the block: the next charge starts once its 5m grace runs out at 35m.
    const result = bestOf([HOURLY, BLOCK], 20);
    expect(result.index).toBe(1);
    expect(result.minutesUntilNextCharge).toBe(priceSession(BLOCK, 20).minutesUntilNextCharge);
  });
});
