import { describe, it, expect } from 'vitest';
import {
  calculateBillTotals,
  multiChildPercentage,
  playBase,
  playChildrenOnItems,
} from './billCalculator';
import { DiscountType } from '../../common/constants/billStatus';

/**
 * The automatic multi-child discount. The same numbers are pinned in
 * mobile/KidsPlayCashier/src/lib/multiChildDiscount.test.ts - change both together.
 */
const TIERS = [
  { minChildren: 2, percentage: 10 },
  { minChildren: 3, percentage: 20 },
];

const ticket = (lineTotal: number, children = 1) => ({
  kind: 'PLAY',
  quantity: children,
  playSessionId: 'session',
  lineTotal,
});
const socks = (lineTotal: number) => ({ kind: 'PRODUCT', quantity: 1, playSessionId: null, lineTotal });
const group = (lineTotal: number, headcount: number) => ({
  kind: 'GROUP',
  quantity: headcount,
  playSessionId: null,
  lineTotal,
});

const noTax = { taxEnabled: false, taxPercentage: 0 };

describe('multiChildPercentage', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 10],
    [3, 20],
    [5, 20], // the top tier covers every larger family
  ])('%i children gets %i%%', (children, expected) => {
    expect(multiChildPercentage(TIERS, children)).toBe(expected);
  });

  it('is off with no tiers, and does not rely on their order', () => {
    expect(multiChildPercentage([], 4)).toBe(0);
    expect(multiChildPercentage([...TIERS].reverse(), 3)).toBe(20);
  });
});

describe('playChildrenOnItems / playBase', () => {
  it('counts every child on a family ticket and each ticket', () => {
    expect(playChildrenOnItems([ticket(70_000, 2), ticket(35_000)])).toBe(3);
  });

  it('counts a flat PLAY line as one child, whatever its quantity', () => {
    expect(playChildrenOnItems([{ quantity: 2, playSessionId: null, lineTotal: 160_000 }])).toBe(1);
  });

  it('counts nobody on group visits or products', () => {
    expect(playChildrenOnItems([group(500_000, 20), socks(30_000)])).toBe(0);
  });

  it('bases the discount on play lines only', () => {
    expect(playBase([ticket(70_000, 2), socks(30_000), group(500_000, 20)])).toBe(70_000);
  });
});

describe('calculateBillTotals with a multi-child discount', () => {
  it('discounts play time only - socks are charged in full', () => {
    const totals = calculateBillTotals({
      items: [ticket(70_000, 2), socks(30_000)],
      discountType: DiscountType.NONE,
      discountValue: 0,
      multiChildPercentage: 10,
      ...noTax,
    });
    expect(totals).toMatchObject({
      subtotal: 100_000,
      multiChildDiscount: 7_000,
      manualDiscount: 0,
      discount: 7_000,
      grandTotal: 93_000,
    });
  });

  it("applies the cashier's percentage to what is left after the automatic discount", () => {
    const totals = calculateBillTotals({
      items: [ticket(105_000, 3)],
      discountType: DiscountType.PERCENTAGE,
      discountValue: 10,
      multiChildPercentage: 20,
      ...noTax,
    });
    // 20% of 1,050 = 210 off; then 10% of the remaining 840 = 84 off.
    expect(totals).toMatchObject({ multiChildDiscount: 21_000, manualDiscount: 8_400, discount: 29_400, grandTotal: 75_600 });
  });

  it('caps a fixed cashier discount at what is left', () => {
    const totals = calculateBillTotals({
      items: [ticket(100_000, 2)],
      discountType: DiscountType.FIXED,
      discountValue: 999_999,
      multiChildPercentage: 10,
      ...noTax,
    });
    expect(totals).toMatchObject({ multiChildDiscount: 10_000, manualDiscount: 90_000, grandTotal: 0 });
  });

  it('taxes what is left after both discounts', () => {
    const totals = calculateBillTotals({
      items: [ticket(100_000, 2)],
      discountType: DiscountType.NONE,
      discountValue: 0,
      multiChildPercentage: 10,
      taxEnabled: true,
      taxPercentage: 10,
    });
    expect(totals).toMatchObject({ discount: 10_000, tax: 9_000, grandTotal: 99_000 });
  });

  it('is exactly the old calculation with no multi-child percentage', () => {
    const items = [ticket(80_000), socks(30_000)];
    const before = calculateBillTotals({ items, discountType: DiscountType.PERCENTAGE, discountValue: 10, ...noTax });
    expect(before).toMatchObject({ subtotal: 110_000, discount: 11_000, multiChildDiscount: 0, grandTotal: 99_000 });
  });
});
