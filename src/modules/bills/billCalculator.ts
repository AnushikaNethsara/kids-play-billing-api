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

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Whole minutes between check-in and check-out, rounding a partial minute up - a child
 * who played 14m 10s is billed 15 minutes, never 14.
 */
export function calculateElapsedMinutes(checkInAt: Date, checkOutAt: Date): number {
  const elapsedMs = checkOutAt.getTime() - checkInAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    throw new ValidationError('Check-out time must be after check-in time');
  }
  return Math.ceil(elapsedMs / MILLISECONDS_PER_MINUTE);
}

export interface BilledDuration {
  elapsedMinutes: number;
  billedMinutes: number;
  /** True when the visit was shorter than the configured minimum and was floored up to it. */
  minimumApplied: boolean;
}

/**
 * Elapsed time floored at BusinessSettings.minimumBillableMinutes, so a child who cries
 * and leaves after two minutes still produces a sane bill rather than a near-zero one.
 */
export function calculateBilledMinutes(params: {
  checkInAt: Date;
  checkOutAt: Date;
  minimumBillableMinutes: number;
}): BilledDuration {
  const elapsedMinutes = calculateElapsedMinutes(params.checkInAt, params.checkOutAt);
  const minimum = Math.max(params.minimumBillableMinutes, 0);
  const billedMinutes = Math.max(elapsedMinutes, minimum);

  return { elapsedMinutes, billedMinutes, minimumApplied: billedMinutes > elapsedMinutes };
}

/**
 * A play package is a RATE, not a flat-price product: `unitPrice` buys
 * `rateDurationMinutes` of play, and any other duration is priced pro-rata from it.
 * LKR 1000.00 per 60 min, billed 75 min -> LKR 1250.00; billed 15 min -> LKR 250.00.
 *
 * Rounds exactly once, to whole minor units, in the same spirit as calculatePercentage.
 */
export function calculateSessionLineTotal(params: {
  unitPrice: number;
  rateDurationMinutes: number;
  billedMinutes: number;
}): number {
  const { unitPrice, rateDurationMinutes, billedMinutes } = params;

  if (!Number.isFinite(rateDurationMinutes) || rateDurationMinutes <= 0) {
    throw new ValidationError('Play package duration must be greater than zero to price a session');
  }
  if (!Number.isFinite(billedMinutes) || billedMinutes < 0) {
    throw new ValidationError('Billed minutes cannot be negative');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new ValidationError('Play package price cannot be negative');
  }

  return Math.round((unitPrice * billedMinutes) / rateDurationMinutes);
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
