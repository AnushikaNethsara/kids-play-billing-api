import { describe, it, expect } from 'vitest';
import {
  calculateSubtotal,
  calculateDiscountAmount,
  calculateTax,
  validateDiscountPermission,
  calculateBillTotals,
  calculateElapsedMinutes,
  calculateBilledMinutes,
  calculateSessionLineTotal,
  priceSession,
  priceSessionForPeriod,
} from './billCalculator';
import { DiscountType } from '../../common/constants/billStatus';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { UserRole } from '../../common/constants/roles';
import { ValidationError } from '../../common/errors';

describe('billCalculator', () => {
  describe('calculateSubtotal', () => {
    it('sums line totals across items', () => {
      expect(calculateSubtotal([{ lineTotal: 80000 }, { lineTotal: 50000 }])).toBe(130000);
    });

    it('returns 0 for no items', () => {
      expect(calculateSubtotal([])).toBe(0);
    });
  });

  describe('calculateDiscountAmount', () => {
    it('applies a fixed discount', () => {
      expect(calculateDiscountAmount(100000, DiscountType.FIXED, 20000)).toBe(20000);
    });

    it('caps a fixed discount at the subtotal', () => {
      expect(calculateDiscountAmount(10000, DiscountType.FIXED, 50000)).toBe(10000);
    });

    it('applies a percentage discount', () => {
      expect(calculateDiscountAmount(100000, DiscountType.PERCENTAGE, 10)).toBe(10000);
    });

    it('applies no discount for NONE', () => {
      expect(calculateDiscountAmount(100000, DiscountType.NONE, 50)).toBe(0);
    });
  });

  describe('calculateTax', () => {
    it('returns 0 when tax is disabled', () => {
      expect(calculateTax(100000, false, 15)).toBe(0);
    });

    it('calculates tax on the taxable base when enabled', () => {
      expect(calculateTax(100000, true, 15)).toBe(15000);
    });
  });

  describe('validateDiscountPermission', () => {
    it('allows a cashier discount within the configured cap', () => {
      expect(() =>
        validateDiscountPermission({
          role: UserRole.CASHIER,
          subtotal: 100000,
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10,
          maximumCashierDiscountPercentage: 10,
        }),
      ).not.toThrow();
    });

    it('rejects a cashier percentage discount above the configured cap', () => {
      expect(() =>
        validateDiscountPermission({
          role: UserRole.CASHIER,
          subtotal: 100000,
          discountType: DiscountType.PERCENTAGE,
          discountValue: 25,
          maximumCashierDiscountPercentage: 10,
        }),
      ).toThrow();
    });

    it('rejects a cashier fixed discount equivalent to more than the configured cap', () => {
      expect(() =>
        validateDiscountPermission({
          role: UserRole.CASHIER,
          subtotal: 100000,
          discountType: DiscountType.FIXED,
          discountValue: 20000,
          maximumCashierDiscountPercentage: 10,
        }),
      ).toThrow();
    });

    it('allows an admin discount above the cashier cap', () => {
      expect(() =>
        validateDiscountPermission({
          role: UserRole.ADMIN,
          subtotal: 100000,
          discountType: DiscountType.PERCENTAGE,
          discountValue: 50,
          maximumCashierDiscountPercentage: 10,
        }),
      ).not.toThrow();
    });

    it('rejects a fixed discount greater than the subtotal', () => {
      expect(() =>
        validateDiscountPermission({
          role: UserRole.ADMIN,
          subtotal: 10000,
          discountType: DiscountType.FIXED,
          discountValue: 20000,
          maximumCashierDiscountPercentage: 10,
        }),
      ).toThrow();
    });
  });

  describe('calculateBillTotals', () => {
    it('combines subtotal, discount, and tax into a grand total', () => {
      const totals = calculateBillTotals({
        items: [{ lineTotal: 80000 }, { lineTotal: 80000 }],
        discountType: DiscountType.PERCENTAGE,
        discountValue: 10,
        taxEnabled: true,
        taxPercentage: 5,
      });

      // subtotal 160000, discount 10% = 16000, taxable base 144000, tax 5% = 7200
      expect(totals.subtotal).toBe(160000);
      expect(totals.discount).toBe(16000);
      expect(totals.tax).toBe(7200);
      expect(totals.grandTotal).toBe(151200);
    });

    it('never produces a negative grand total', () => {
      const totals = calculateBillTotals({
        items: [{ lineTotal: 10000 }],
        discountType: DiscountType.FIXED,
        discountValue: 50000,
        taxEnabled: false,
        taxPercentage: 0,
      });

      expect(totals.grandTotal).toBe(0);
    });
  });

  describe('calculateElapsedMinutes', () => {
    const checkIn = new Date('2026-08-11T10:00:00.000Z');

    it('counts whole minutes', () => {
      expect(calculateElapsedMinutes(checkIn, new Date('2026-08-11T10:45:00.000Z'))).toBe(45);
    });

    it('rounds a partial minute up, so 14m10s bills as 15 minutes', () => {
      expect(calculateElapsedMinutes(checkIn, new Date('2026-08-11T10:14:10.000Z'))).toBe(15);
    });

    it('counts a single second as a whole minute', () => {
      expect(calculateElapsedMinutes(checkIn, new Date('2026-08-11T10:00:01.000Z'))).toBe(1);
    });

    it('spans midnight without a wrap-around', () => {
      expect(
        calculateElapsedMinutes(
          new Date('2026-08-11T23:30:00.000Z'),
          new Date('2026-08-12T00:15:00.000Z'),
        ),
      ).toBe(45);
    });

    it('is unaffected by a DST boundary because it works in absolute time', () => {
      // Sri Lanka has no DST, but the till may be configured elsewhere; elapsed time is
      // computed from epoch milliseconds so a local-clock jump cannot distort a bill.
      expect(
        calculateElapsedMinutes(
          new Date('2026-03-29T00:30:00.000Z'),
          new Date('2026-03-29T02:00:00.000Z'),
        ),
      ).toBe(90);
    });

    it('rejects a check-out that is not after check-in', () => {
      expect(() => calculateElapsedMinutes(checkIn, checkIn)).toThrow(ValidationError);
      expect(() =>
        calculateElapsedMinutes(checkIn, new Date('2026-08-11T09:00:00.000Z')),
      ).toThrow(ValidationError);
    });
  });

  describe('calculateBilledMinutes', () => {
    const checkInAt = new Date('2026-08-11T10:00:00.000Z');

    it('bills the elapsed time when it exceeds the minimum', () => {
      const result = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:47:00.000Z'),
        minimumBillableMinutes: 15,
      });

      expect(result).toEqual({ elapsedMinutes: 47, billedMinutes: 47, minimumApplied: false });
    });

    it('floors a very short visit at the minimum', () => {
      const result = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:04:00.000Z'),
        minimumBillableMinutes: 15,
      });

      expect(result).toEqual({ elapsedMinutes: 4, billedMinutes: 15, minimumApplied: true });
    });

    it('does not apply the minimum at exactly the boundary', () => {
      const result = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:15:00.000Z'),
        minimumBillableMinutes: 15,
      });

      expect(result.minimumApplied).toBe(false);
      expect(result.billedMinutes).toBe(15);
    });

    it('supports a business that has switched the minimum off', () => {
      const result = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:02:00.000Z'),
        minimumBillableMinutes: 0,
      });

      expect(result).toEqual({ elapsedMinutes: 2, billedMinutes: 2, minimumApplied: false });
    });
  });

  describe('calculateSessionLineTotal (pro-rata)', () => {
    // The business's two worked examples, against a LKR 1000.00 / 60 min package.
    const HOURLY_RATE = { unitPrice: 100_000, rateDurationMinutes: 60 };

    it('charges a quarter of the rate for a 15-minute visit', () => {
      expect(calculateSessionLineTotal({ ...HOURLY_RATE, billedMinutes: 15 })).toBe(25_000);
    });

    it('charges an hour and a quarter for a 75-minute visit', () => {
      expect(calculateSessionLineTotal({ ...HOURLY_RATE, billedMinutes: 75 })).toBe(125_000);
    });

    it('charges exactly the package price at exactly the package duration', () => {
      expect(calculateSessionLineTotal({ ...HOURLY_RATE, billedMinutes: 60 })).toBe(100_000);
    });

    it('rounds to whole minor units on an awkward divisor', () => {
      // 77 min at LKR 1000.00/60min = 128333.33... cents
      expect(calculateSessionLineTotal({ ...HOURLY_RATE, billedMinutes: 77 })).toBe(128_333);
    });

    it('prices against a non-hourly rate denominator', () => {
      // LKR 500.00 buys 30 min; 45 min is one and a half times that.
      expect(
        calculateSessionLineTotal({ unitPrice: 50_000, rateDurationMinutes: 30, billedMinutes: 45 }),
      ).toBe(75_000);
    });

    it('returns zero for a free package rather than dividing oddly', () => {
      expect(
        calculateSessionLineTotal({ unitPrice: 0, rateDurationMinutes: 60, billedMinutes: 90 }),
      ).toBe(0);
    });

    it('rejects a zero-duration rate instead of dividing by zero', () => {
      expect(() =>
        calculateSessionLineTotal({ unitPrice: 100_000, rateDurationMinutes: 0, billedMinutes: 30 }),
      ).toThrow(ValidationError);
    });

    it('rejects negative inputs', () => {
      expect(() =>
        calculateSessionLineTotal({ unitPrice: -1, rateDurationMinutes: 60, billedMinutes: 30 }),
      ).toThrow(ValidationError);
      expect(() =>
        calculateSessionLineTotal({ unitPrice: 100_000, rateDurationMinutes: 60, billedMinutes: -1 }),
      ).toThrow(ValidationError);
    });
  });

  describe('priceSession (BLOCK_WITH_GRACE)', () => {
    // The business's own worked table: LKR 600.00 buys the first hour, 10 minutes of grace
    // follow every completed hour, and past that the whole remainder is charged per minute.
    const HOURLY_BLOCK = {
      pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
      unitPrice: 60_000,
      rateDurationMinutes: 60,
      graceMinutes: 10,
    };

    it.each([
      [20, 60_000, 'a short visit still buys the whole first hour'],
      [45, 60_000, 'still inside the first hour'],
      [60, 60_000, 'exactly one hour'],
      [70, 60_000, 'ten minutes over, inside the grace'],
      [71, 71_000, 'one minute past the grace charges all eleven minutes'],
      [90, 90_000, 'half an hour past the first hour'],
      [120, 120_000, 'exactly two hours'],
      [130, 120_000, 'ten minutes into the third hour, inside the grace'],
      [131, 131_000, 'one minute past the second grace'],
    ])('bills %i minutes as %i (%s)', (billedMinutes, expected) => {
      expect(priceSession(HOURLY_BLOCK, billedMinutes).lineTotal).toBe(expected);
    });

    it('reports the split so the receipt never has to recompute it', () => {
      expect(priceSession(HOURLY_BLOCK, 90)).toEqual({
        lineTotal: 90_000,
        blocksCharged: 1,
        blockSubtotal: 60_000,
        overageMinutes: 30,
        overageAmount: 30_000,
        graceApplied: false,
        inExtraTime: true,
        minutesUntilNextCharge: 0,
      });
    });

    it('flags a session the grace is currently absorbing, and counts down to the step', () => {
      const result = priceSession(HOURLY_BLOCK, 65);
      expect(result.graceApplied).toBe(true);
      expect(result.overageAmount).toBe(0);
      expect(result.inExtraTime).toBe(false);
      // Six more minutes before the total jumps: charging starts at minute 71.
      expect(result.minutesUntilNextCharge).toBe(6);
    });

    it('reports no overage inside the first block, where the minutes are already paid for', () => {
      // A receipt for a 20-minute visit must read "1 x 1h", not "1 x 1h + 20m extra"
      // against a total of 600 - that line would not add up.
      const result = priceSession(HOURLY_BLOCK, 20);
      expect(result.graceApplied).toBe(false);
      expect(result.overageMinutes).toBe(0);
      expect(result.overageAmount).toBe(0);
      expect(result.lineTotal).toBe(60_000);
      expect(result.minutesUntilNextCharge).toBe(51);
    });

    it('charges from the start of the block, not from the end of the grace', () => {
      // 11 minutes over, not 1. This is the step the cashier app counts down to.
      const withinGrace = priceSession(HOURLY_BLOCK, 70);
      const pastGrace = priceSession(HOURLY_BLOCK, 71);
      expect(pastGrace.lineTotal - withinGrace.lineTotal).toBe(11_000);
    });

    it('rounds the overage in one step rather than from a rounded per-minute rate', () => {
      // LKR 800.00/60min is LKR 13.333.../min. 11 minutes is 14666.67 -> 14667 cents,
      // whereas multiplying a rounded 1333 cents by 11 would give 14663.
      const result = priceSession({ ...HOURLY_BLOCK, unitPrice: 80_000 }, 71);
      expect(result.overageAmount).toBe(14_667);
      expect(result.lineTotal).toBe(94_667);
    });

    it('generalises to a non-hourly block', () => {
      // LKR 500.00 buys 30 min, 10 min grace. 45 min = one block + 15 chargeable minutes.
      const halfHour = { ...HOURLY_BLOCK, unitPrice: 50_000, rateDurationMinutes: 30 };
      expect(priceSession(halfHour, 35).lineTotal).toBe(50_000);
      expect(priceSession(halfHour, 45).lineTotal).toBe(75_000);
      expect(priceSession(halfHour, 60).lineTotal).toBe(100_000);
    });

    it('charges from the first minute over when there is no grace', () => {
      const noGrace = { ...HOURLY_BLOCK, graceMinutes: 0 };
      expect(priceSession(noGrace, 60).lineTotal).toBe(60_000);
      expect(priceSession(noGrace, 61).lineTotal).toBe(61_000);
    });

    it('degrades to whole blocks, rather than throwing, when grace is as long as the block', () => {
      // Validation rejects this combination, but a package saved before that rule existed
      // must still be checkoutable. The remainder is always shorter than a block, so grace
      // is never exceeded and the visit is simply charged by whole blocks - which errs in
      // the customer's favour. Throwing here would strand a ticket that cannot be billed.
      const grace60 = { ...HOURLY_BLOCK, graceMinutes: 60 };
      expect(priceSession(grace60, 119).lineTotal).toBe(60_000);
      expect(priceSession(grace60, 120).lineTotal).toBe(120_000);
      // The countdown still points at something real: the next whole block, not minute 121.
      expect(priceSession(grace60, 70).minutesUntilNextCharge).toBe(50);
    });

    it('never goes backwards as a visit gets longer', () => {
      let previous = 0;
      for (let minutes = 1; minutes <= 240; minutes += 1) {
        const { lineTotal } = priceSession(HOURLY_BLOCK, minutes);
        expect(lineTotal).toBeGreaterThanOrEqual(previous);
        previous = lineTotal;
      }
    });

    it('rejects the same bad inputs the pro-rata path rejects', () => {
      expect(() => priceSession({ ...HOURLY_BLOCK, rateDurationMinutes: 0 }, 30)).toThrow(
        ValidationError,
      );
      expect(() => priceSession({ ...HOURLY_BLOCK, unitPrice: -1 }, 30)).toThrow(
        ValidationError,
      );
      expect(() => priceSession(HOURLY_BLOCK, -1)).toThrow(ValidationError);
      expect(() => priceSession({ ...HOURLY_BLOCK, graceMinutes: -1 }, 90)).toThrow(
        ValidationError,
      );
    });
  });

  describe('priceSession (PRORATA)', () => {
    it('is exactly the pro-rata calculation, with nothing to split', () => {
      const rate = { unitPrice: 100_000, rateDurationMinutes: 60 };
      for (const billedMinutes of [15, 60, 75, 77]) {
        expect(
          priceSession(
            { ...rate, pricingMode: SessionPricingMode.PRORATA, graceMinutes: 0 },
            billedMinutes,
          ),
        ).toEqual({
          lineTotal: calculateSessionLineTotal({ ...rate, billedMinutes }),
          blocksCharged: 0,
          blockSubtotal: 0,
          overageMinutes: 0,
          overageAmount: 0,
          graceApplied: false,
          inExtraTime: false,
          minutesUntilNextCharge: null,
        });
      }
    });

    it('ignores a grace value, which means nothing under this mode', () => {
      const rate = {
        pricingMode: SessionPricingMode.PRORATA,
        unitPrice: 100_000,
        rateDurationMinutes: 60,
        graceMinutes: 30,
      };
      expect(priceSession(rate, 75).lineTotal).toBe(125_000);
    });
  });

  describe('priceSessionForPeriod', () => {
    const checkInAt = new Date('2026-08-11T10:00:00.000Z');
    const PRORATA_RATE = {
      pricingMode: SessionPricingMode.PRORATA,
      unitPrice: 60_000,
      rateDurationMinutes: 60,
      graceMinutes: 0,
    };
    const BLOCK_RATE = { ...PRORATA_RATE, pricingMode: SessionPricingMode.BLOCK_WITH_GRACE, graceMinutes: 10 };

    it('still floors a pro-rata visit at the minimum', () => {
      const result = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:02:00.000Z'),
        rate: PRORATA_RATE,
        minimumBillableMinutes: 15,
      });

      expect(result.elapsedMinutes).toBe(2);
      expect(result.billedMinutes).toBe(15);
      expect(result.minimumApplied).toBe(true);
      expect(result.breakdown.lineTotal).toBe(15_000);
    });

    it('does not let the minimum inflate a block visit, which would misreport play time', () => {
      // The block fee is already the floor, so the minimum cannot change the money - but
      // applying it would store billedMinutes: 15 for a two-minute visit, which is what
      // the dashboard sums and what the receipt prints as the time played.
      const result = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:02:00.000Z'),
        rate: BLOCK_RATE,
        minimumBillableMinutes: 15,
      });

      expect(result.elapsedMinutes).toBe(2);
      expect(result.billedMinutes).toBe(2);
      expect(result.minimumApplied).toBe(false);
      expect(result.breakdown.lineTotal).toBe(60_000);
    });

    it('prices the grace boundary from real timestamps', () => {
      const atGrace = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-08-11T11:10:00.000Z'),
        rate: BLOCK_RATE,
        minimumBillableMinutes: 15,
      });
      expect(atGrace.billedMinutes).toBe(70);
      expect(atGrace.breakdown.lineTotal).toBe(60_000);

      // One second past the grace is a whole minute past it, because elapsed time ceils.
      const pastGrace = priceSessionForPeriod({
        checkInAt,
        checkOutAt: new Date('2026-08-11T11:10:01.000Z'),
        rate: BLOCK_RATE,
        minimumBillableMinutes: 15,
      });
      expect(pastGrace.billedMinutes).toBe(71);
      expect(pastGrace.breakdown.lineTotal).toBe(71_000);
    });
  });

  describe('end-to-end session pricing', () => {
    it('reproduces the business examples from check-in to line total', () => {
      const checkInAt = new Date('2026-08-11T10:00:00.000Z');
      const rate = { unitPrice: 100_000, rateDurationMinutes: 60 };

      const shortVisit = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T10:15:00.000Z'),
        minimumBillableMinutes: 15,
      });
      expect(calculateSessionLineTotal({ ...rate, billedMinutes: shortVisit.billedMinutes })).toBe(
        25_000,
      );

      const longVisit = calculateBilledMinutes({
        checkInAt,
        checkOutAt: new Date('2026-08-11T11:15:00.000Z'),
        minimumBillableMinutes: 15,
      });
      expect(calculateSessionLineTotal({ ...rate, billedMinutes: longVisit.billedMinutes })).toBe(
        125_000,
      );
    });
  });
});
