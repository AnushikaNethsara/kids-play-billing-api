import { DiscountType } from '../../common/constants/billStatus';
import {
  OvertimeMode,
  RoundingMode,
  SessionPricingMode,
  TIER_MINUTES,
  type TieredPricing,
} from '../../common/constants/pricingModes';
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

/**
 * Everything needed to price a session, and nothing else.
 *
 * `PlaySessionDocument` and `BillItemSubdocument` both satisfy this structurally once they
 * carry the two new fields, so a session or a bill item can be passed straight to
 * `priceSession` with no adapter - which is the point. The rate is always read off the
 * snapshot, never off the live `PlayPackage`.
 */
export interface SessionRateSnapshot {
  pricingMode: SessionPricingMode;
  /** Block price under BLOCK_WITH_GRACE; the rate numerator under PRORATA. */
  unitPrice: number;
  /** Block length under BLOCK_WITH_GRACE; the rate denominator under PRORATA. */
  rateDurationMinutes: number;
  /** Ignored under PRORATA, where it is always snapshotted as 0. */
  graceMinutes: number;
  /** The hourly rates, overtime and rounding. Required under TIERED_HOURLY, ignored otherwise. */
  tieredPricing?: TieredPricing | null;
}

/** One whole hour charged under TIERED_HOURLY. */
export interface TierHourLine {
  /** 1-based: 1 is the first hour. */
  hour: number;
  rate: number;
  amount: number;
}

/** The extra time past grace under TIERED_HOURLY, charged at the next hour's rate. */
export interface TierOvertime {
  /** The hour whose rate the extra time is charged at, 1-based. */
  hour: number;
  rate: number;
  /** Minutes actually played past the last whole hour. */
  minutes: number;
  /** Minutes charged: equal to `minutes` per minute, or rounded up to whole blocks. */
  chargedMinutes: number;
  amount: number;
}

/**
 * A priced session, broken into its parts.
 *
 * The parts are returned rather than just the total because four different callers need
 * different pieces of the same calculation: the live quote needs the grace state to run a
 * countdown, the receipt needs the split to print it, the bill item stores it so a reprint
 * never has to recompute, and the admin bill detail shows it so the line total visibly
 * reconciles.
 *
 * On a PRORATA session there is nothing to split, so the block fields are zero and
 * `graceApplied` is false - the whole amount is in `lineTotal`.
 */
export interface SessionPriceBreakdown {
  lineTotal: number;
  /** Blocks charged at the full block price. At least 1 under BLOCK_WITH_GRACE, 0 under PRORATA. */
  blocksCharged: number;
  blockSubtotal: number;
  /**
   * Chargeable minutes past the blocks already paid for. Reported as 0 while the visit is
   * still inside its first block: those minutes are covered by the block fee, and calling
   * them overage would print a receipt line that does not add up to the total.
   */
  overageMinutes: number;
  overageAmount: number;
  /** True when there were overage minutes but the grace period absorbed them. */
  graceApplied: boolean;
  /** True once grace is passed, so every further minute now adds to the total. */
  inExtraTime: boolean;
  /**
   * Minutes until the total next rises - what the cashier reads out to a parent. 0 while
   * already in extra time, null under PRORATA, where every minute costs something.
   */
  minutesUntilNextCharge: number | null;
  /** The whole hours charged under TIERED_HOURLY, one per hour. Empty under other modes. */
  hourLines: TierHourLine[];
  /** The extra time charged under TIERED_HOURLY. Null when none, and under other modes. */
  overtime: TierOvertime | null;
  /** The total before rounding. Equal to `lineTotal` except under a rounded TIERED_HOURLY package. */
  rawTotal: number;
  /** `lineTotal - rawTotal`: what rounding added (positive) or removed (negative). */
  roundingAdjustment: number;
}

/**
 * Rounds a total in minor units to a multiple of `step`. A step of 0 leaves it unchanged.
 * NEAREST rounds a tie up, so 1,150 to the nearest 100 is 1,200.
 */
export function applyRounding(amount: number, step: number, mode: RoundingMode): number {
  if (!Number.isFinite(step) || step <= 0) return amount;
  const units = amount / step;
  switch (mode) {
    case RoundingMode.UP:
      return Math.ceil(units) * step;
    case RoundingMode.DOWN:
      return Math.floor(units) * step;
    default:
      return Math.floor(units + 0.5) * step;
  }
}

function tierRate(rates: number[], hour: number): number {
  return rates[Math.min(hour, rates.length) - 1];
}

/**
 * Prices a TIERED_HOURLY session. With G = graceMinutes and rate(n) = the rate of hour n
 * (the last rate repeats):
 *
 *   hours     = floor(billedMinutes / 60)
 *   remainder = billedMinutes - hours * 60
 *   charged   = hours 1..max(hours, 1), each at rate(n)   // the 1st hour is the minimum
 *   extra     = (hours >= 1 && remainder > G) ? remainder charged at rate(hours + 1) : 0
 *
 * As under BLOCK_WITH_GRACE, past grace the **whole** remainder is charged, not just the
 * minutes after the grace. Per minute it costs `round(rate * remainder / 60)`; in blocks,
 * the remainder is rounded up to whole blocks, capped at 60, first. Each amount is rounded
 * to whole minor units once, then the total is rounded by the package's rounding rule.
 *
 * At 600/500/400/400 with G = 10, per minute: 71 minutes is 600 + 500 x 11/60 = 691.67;
 * 131 minutes is 600 + 500 + 400 x 11/60 = 1,173.33; 240 minutes is 1,900.
 */
export function priceTieredSession(
  rate: SessionRateSnapshot,
  billedMinutes: number,
): SessionPriceBreakdown {
  const config = rate.tieredPricing;
  if (!config) {
    throw new ValidationError('A tiered package needs its hourly rates to price a session');
  }
  const rates = config.hourlyRates;
  if (rates.length === 0 || rates.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new ValidationError('Tiered hourly rates must be non-negative amounts');
  }
  if (!Number.isFinite(billedMinutes) || billedMinutes < 0) {
    throw new ValidationError('Billed minutes cannot be negative');
  }
  const { graceMinutes } = rate;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new ValidationError('Grace minutes cannot be negative');
  }

  const completedHours = Math.floor(billedMinutes / TIER_MINUTES);
  const remainder = billedMinutes - completedHours * TIER_MINUTES;
  const hoursCharged = Math.max(completedHours, 1);

  const hourLines: TierHourLine[] = [];
  for (let hour = 1; hour <= hoursCharged; hour += 1) {
    const hourRate = tierRate(rates, hour);
    hourLines.push({ hour, rate: hourRate, amount: hourRate });
  }
  const hourSubtotal = hourLines.reduce((sum, line) => sum + line.amount, 0);

  const isBlock = config.overtimeMode === OvertimeMode.BLOCK;
  const blockMinutes =
    Number.isFinite(config.overtimeBlockMinutes) && config.overtimeBlockMinutes > 0
      ? Math.min(config.overtimeBlockMinutes, TIER_MINUTES)
      : TIER_MINUTES;

  const chargeable = completedHours >= 1 && remainder > graceMinutes;
  let overtime: TierOvertime | null = null;
  if (chargeable) {
    const overtimeHour = completedHours + 1;
    const overtimeRate = tierRate(rates, overtimeHour);
    const chargedMinutes = isBlock
      ? Math.min(Math.ceil(remainder / blockMinutes) * blockMinutes, TIER_MINUTES)
      : remainder;
    overtime = {
      hour: overtimeHour,
      rate: overtimeRate,
      minutes: remainder,
      chargedMinutes,
      amount: Math.round((overtimeRate * chargedMinutes) / TIER_MINUTES),
    };
  }

  const rawTotal = hourSubtotal + (overtime?.amount ?? 0);
  const lineTotal = applyRounding(rawTotal, config.roundingStep, config.roundingMode);

  // Before grace runs out, the next rise is the first chargeable minute, capped at the
  // next whole hour as under BLOCK_WITH_GRACE. Per minute, every minute in extra time
  // costs something; in blocks, the next rise is the first minute of the next block.
  let minutesUntilNextCharge: number;
  if (!overtime) {
    const nextChargeAtMinute = Math.min(
      hoursCharged * TIER_MINUTES + graceMinutes + 1,
      (hoursCharged + 1) * TIER_MINUTES,
    );
    minutesUntilNextCharge = Math.max(nextChargeAtMinute - billedMinutes, 0);
  } else if (isBlock && overtime.chargedMinutes < TIER_MINUTES) {
    minutesUntilNextCharge =
      completedHours * TIER_MINUTES + overtime.chargedMinutes + 1 - billedMinutes;
  } else if (isBlock) {
    // The extra time already costs a whole hour; the next rise is past the next hour's grace.
    minutesUntilNextCharge =
      (completedHours + 1) * TIER_MINUTES + graceMinutes + 1 - billedMinutes;
  } else {
    minutesUntilNextCharge = 0;
  }

  return {
    lineTotal,
    blocksCharged: hoursCharged,
    blockSubtotal: hourSubtotal,
    overageMinutes: overtime?.minutes ?? 0,
    overageAmount: overtime?.amount ?? 0,
    graceApplied: completedHours >= 1 && remainder > 0 && !chargeable,
    inExtraTime: chargeable,
    minutesUntilNextCharge,
    hourLines,
    overtime,
    rawTotal,
    roundingAdjustment: lineTotal - rawTotal,
  };
}

/**
 * Prices a session under any pricing mode. **The only pricing entry point callers
 * should use** - the live quote, checkout, and both client-side previews all go through
 * it, so no caller anywhere branches on the mode itself.
 *
 * BLOCK_WITH_GRACE, with B = rateDurationMinutes, P = unitPrice, G = graceMinutes:
 *
 *   blocks    = floor(billedMinutes / B)
 *   remainder = billedMinutes - blocks * B
 *   charged   = max(blocks, 1)                          // under one block still pays one
 *   extra     = (blocks >= 1 && remainder > G) ? round(P * remainder / B) : 0
 *
 * Two parts of that are easy to get wrong and are deliberate:
 *
 * - **A visit shorter than one block pays one block.** That is the whole point of the
 *   model - the first hour is bought outright - and it is why `minimumBillableMinutes`
 *   is meaningless here: the block fee already is the minimum.
 * - **Past grace, the whole remainder is charged**, counted from the start of the block
 *   rather than from the end of the grace. So at B=60/P=600/G=10, 70 minutes costs 600 and
 *   71 minutes costs 710. That step is intended; the clients show a countdown to it.
 *
 * The overage is computed as `round(P * remainder / B)` in one step, never as a rounded
 * per-minute rate multiplied out: at P=80000/B=60 the per-minute rate is LKR 13.333..., and
 * multiplying a rounded 13.33 by 11 minutes is four cents short of the right answer. Any
 * per-minute figure shown on a screen or a slip is display-only.
 */
export function priceSession(
  rate: SessionRateSnapshot,
  billedMinutes: number,
): SessionPriceBreakdown {
  const { pricingMode, unitPrice, rateDurationMinutes } = rate;

  // An explicit switch, so a new mode can never fall through to pro-rata unnoticed.
  switch (pricingMode) {
    case SessionPricingMode.PRORATA: {
      const lineTotal = calculateSessionLineTotal({ unitPrice, rateDurationMinutes, billedMinutes });
      return {
        lineTotal,
        blocksCharged: 0,
        blockSubtotal: 0,
        overageMinutes: 0,
        overageAmount: 0,
        graceApplied: false,
        inExtraTime: false,
        // Every minute already costs something here, so there is no next step to count to.
        minutesUntilNextCharge: null,
        hourLines: [],
        overtime: null,
        rawTotal: lineTotal,
        roundingAdjustment: 0,
      };
    }
    case SessionPricingMode.TIERED_HOURLY:
      return priceTieredSession(rate, billedMinutes);
    case SessionPricingMode.BLOCK_WITH_GRACE:
      break;
    default:
      throw new ValidationError(`Unknown pricing mode: ${String(pricingMode)}`);
  }

  // Same guards as the pro-rata path, applied before any arithmetic.
  if (!Number.isFinite(rateDurationMinutes) || rateDurationMinutes <= 0) {
    throw new ValidationError('Play package duration must be greater than zero to price a session');
  }
  if (!Number.isFinite(billedMinutes) || billedMinutes < 0) {
    throw new ValidationError('Billed minutes cannot be negative');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new ValidationError('Play package price cannot be negative');
  }
  const { graceMinutes } = rate;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new ValidationError('Grace minutes cannot be negative');
  }

  const completedBlocks = Math.floor(billedMinutes / rateDurationMinutes);
  const remainder = billedMinutes - completedBlocks * rateDurationMinutes;
  const blocksCharged = Math.max(completedBlocks, 1);
  const blockSubtotal = blocksCharged * unitPrice;

  // No completed block means the visit is still inside the one block being paid for, so
  // its minutes are already covered - charging them again would bill the first hour twice.
  const chargeable = completedBlocks >= 1 && remainder > graceMinutes;
  const overageAmount = chargeable ? Math.round((unitPrice * remainder) / rateDurationMinutes) : 0;

  // A grace as long as the block can never be exceeded, since the remainder is always
  // shorter than a block. Validation rejects that combination, but a package saved before
  // the rule existed must still price - it simply degrades to whole blocks only, which
  // errs in the customer's favour rather than throwing and stranding the ticket.
  const nextChargeAtMinute = Math.min(
    blocksCharged * rateDurationMinutes + graceMinutes + 1,
    (blocksCharged + 1) * rateDurationMinutes,
  );

  const lineTotal = blockSubtotal + overageAmount;

  return {
    lineTotal,
    blocksCharged,
    blockSubtotal,
    overageMinutes: chargeable ? remainder : 0,
    overageAmount,
    graceApplied: completedBlocks >= 1 && remainder > 0 && !chargeable,
    inExtraTime: chargeable,
    minutesUntilNextCharge: chargeable ? 0 : Math.max(nextChargeAtMinute - billedMinutes, 0),
    hourLines: [],
    overtime: null,
    rawTotal: lineTotal,
    roundingAdjustment: 0,
  };
}

export interface SessionPricing extends BilledDuration {
  breakdown: SessionPriceBreakdown;
}

/**
 * Prices a stretch of play time end to end: elapsed -> billed minutes -> money.
 *
 * Both the live quote and the authoritative checkout go through this, so the two cannot
 * drift. It is also the single place that decides how `minimumBillableMinutes` is applied.
 *
 * **The minimum applies only to PRORATA.** Under BLOCK_WITH_GRACE and TIERED_HOURLY the
 * first block or hour already is the floor -
 * a two-minute visit buys the whole first hour - so applying the minimum on top would
 * change nothing about the money while doing real damage elsewhere: `billedMinutes` is
 * stored on the session and on the bill item, and it is what the dashboard sums into
 * `totalPlayMinutes` and what the receipt prints as `Time:`. Flooring it to 15 would claim
 * a child played fifteen minutes when they played two.
 */
export function priceSessionForPeriod(params: {
  checkInAt: Date;
  checkOutAt: Date;
  rate: SessionRateSnapshot;
  minimumBillableMinutes: number;
}): SessionPricing {
  const appliesMinimum = params.rate.pricingMode === SessionPricingMode.PRORATA;

  const duration = calculateBilledMinutes({
    checkInAt: params.checkInAt,
    checkOutAt: params.checkOutAt,
    minimumBillableMinutes: appliesMinimum ? params.minimumBillableMinutes : 0,
  });

  return { ...duration, breakdown: priceSession(params.rate, duration.billedMinutes) };
}

/**
 * When this bill's checkout happened - the moment a payment recorded after the fact is
 * dated to.
 *
 * For a session bill that is the latest item `checkOutAt`: the "Time out" already on the
 * bill and the receipt, and the instant the parent was quoted at. A flat bill has no
 * checkout time, so it falls back to when the draft was created, which for a till bill is
 * the same moment give or take a sync.
 */
export function checkoutTimeOf(bill: {
  items: { checkOutAt?: Date | null }[];
  createdAt: Date;
}): Date {
  const checkOutTimes = bill.items
    .map((item) => item.checkOutAt?.getTime())
    .filter((time): time is number => typeof time === 'number' && Number.isFinite(time));

  return checkOutTimes.length ? new Date(Math.max(...checkOutTimes)) : bill.createdAt;
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
