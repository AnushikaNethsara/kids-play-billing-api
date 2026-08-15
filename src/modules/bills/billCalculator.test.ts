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
} from './billCalculator';
import { DiscountType } from '../../common/constants/billStatus';
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
