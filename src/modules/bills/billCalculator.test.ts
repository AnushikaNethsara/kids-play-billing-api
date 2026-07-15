import { describe, it, expect } from 'vitest';
import {
  calculateSubtotal,
  calculateDiscountAmount,
  calculateTax,
  validateDiscountPermission,
  calculateBillTotals,
} from './billCalculator';
import { DiscountType } from '../../common/constants/billStatus';
import { UserRole } from '../../common/constants/roles';

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
});
