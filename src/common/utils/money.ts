/**
 * All monetary values in this system are stored and calculated as integer minor units
 * (e.g. LKR cents: LKR 800.00 === 80000). This avoids floating-point rounding errors in
 * financial calculations. Only convert to major units (divide by 100) at display time.
 */

const MINOR_UNITS_PER_MAJOR = 100;

export function toMinorUnits(majorAmount: number): number {
  return Math.round(majorAmount * MINOR_UNITS_PER_MAJOR);
}

export function toMajorUnits(minorAmount: number): number {
  return minorAmount / MINOR_UNITS_PER_MAJOR;
}

export function formatMoney(minorAmount: number): string {
  const major = toMajorUnits(minorAmount);
  return major.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function calculatePercentage(baseAmount: number, percentage: number): number {
  return Math.round((baseAmount * percentage) / 100);
}

export function sumMinorUnits(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}
