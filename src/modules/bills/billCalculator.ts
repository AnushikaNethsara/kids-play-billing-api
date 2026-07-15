import { DiscountType } from '../../common/constants/billStatus';
import { UserRole } from '../../common/constants/roles';
import { PaymentError, ValidationError } from '../../common/errors';
import { calculatePercentage, sumMinorUnits } from '../../common/utils/money';
import type { BillItemPublic } from './bill.types';

export function calculateSubtotal(items: Pick<BillItemPublic, 'lineTotal'>[]): number {
  return sumMinorUnits(items.map((item) => item.lineTotal));
}

export function calculateDiscountAmount(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
): number {
  switch (discountType) {
    case DiscountType.NONE:
      return 0;
    case DiscountType.FIXED:
      return Math.min(discountValue, subtotal);
    case DiscountType.PERCENTAGE:
      return calculatePercentage(subtotal, discountValue);
    default:
      return 0;
  }
}

export function calculateTax(baseAmount: number, taxEnabled: boolean, taxPercentage: number): number {
  if (!taxEnabled) return 0;
  return calculatePercentage(baseAmount, taxPercentage);
}

/**
 * A discount's "equivalent percentage" is what a FIXED discount would be worth as a
 * share of the subtotal - this lets both discount types be checked against a single
 * cap (BusinessSettings.maximumCashierDiscountPercentage) and reused for the
 * above-threshold audit-log check.
 */
export function discountEquivalentPercentage(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
): number {
  if (discountType === DiscountType.NONE || subtotal <= 0) return 0;
  if (discountType === DiscountType.PERCENTAGE) return discountValue;
  return (discountValue / subtotal) * 100;
}

export function validateDiscountPermission(params: {
  role: UserRole;
  subtotal: number;
  discountType: DiscountType;
  discountValue: number;
  maximumCashierDiscountPercentage: number;
}): void {
  const { role, subtotal, discountType, discountValue, maximumCashierDiscountPercentage } = params;

  if (discountType === DiscountType.NONE) return;

  if (discountValue < 0) {
    throw new ValidationError('Discount value cannot be negative');
  }

  if (discountType === DiscountType.PERCENTAGE && discountValue > 100) {
    throw new ValidationError('Percentage discount cannot exceed 100%');
  }

  if (discountType === DiscountType.FIXED && discountValue > subtotal) {
    throw new PaymentError('Fixed discount cannot exceed the bill subtotal');
  }

  // Admins may apply any discount permitted by the type-level checks above; only
  // cashiers are capped by the configured maximum.
  if (role !== UserRole.CASHIER) return;

  const equivalentPercentage = discountEquivalentPercentage(subtotal, discountType, discountValue);
  if (equivalentPercentage > maximumCashierDiscountPercentage + 1e-9) {
    throw new ValidationError(
      `Cashiers may not apply a discount greater than ${maximumCashierDiscountPercentage}%`,
    );
  }
}

export function isDiscountAboveThreshold(
  subtotal: number,
  discountType: DiscountType,
  discountValue: number,
  thresholdPercentage: number,
): boolean {
  return discountEquivalentPercentage(subtotal, discountType, discountValue) > thresholdPercentage + 1e-9;
}

export interface BillTotals {
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
}

export function calculateBillTotals(params: {
  items: Pick<BillItemPublic, 'lineTotal'>[];
  discountType: DiscountType;
  discountValue: number;
  taxEnabled: boolean;
  taxPercentage: number;
}): BillTotals {
  const subtotal = calculateSubtotal(params.items);
  const discount = calculateDiscountAmount(subtotal, params.discountType, params.discountValue);
  const taxableBase = Math.max(subtotal - discount, 0);
  const tax = calculateTax(taxableBase, params.taxEnabled, params.taxPercentage);
  const grandTotal = Math.max(taxableBase + tax, 0);

  return { subtotal, discount, tax, grandTotal };
}
