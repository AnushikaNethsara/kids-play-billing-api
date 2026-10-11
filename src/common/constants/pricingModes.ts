/**
 * How a play package turns time in the play area into money.
 *
 * Both modes coexist permanently and are chosen per package, so a business can run a
 * pro-rata package alongside an hourly one. The mode is snapshotted onto the session at
 * check-in with the rest of the rate, which is what stops a package edited mid-visit from
 * repricing a child who is already playing.
 */
export const SessionPricingMode = {
  /**
   * Every minute is charged at the same rate: `unitPrice` buys `rateDurationMinutes` of
   * play, and any other duration is priced in proportion. A 20-minute visit on an
   * LKR 600/hour package costs LKR 200.
   */
  PRORATA: 'PRORATA',

  /**
   * Each started block is paid for in full, with a grace period after every completed
   * block before the next charge begins. A 20-minute visit on an LKR 600/hour package
   * costs the full LKR 600; at 1h10m (within a 10-minute grace) it still costs LKR 600;
   * at 1h11m the whole 11-minute remainder is charged on top, at the per-minute rate.
   */
  BLOCK_WITH_GRACE: 'BLOCK_WITH_GRACE',

  /**
   * Hour by hour, each hour at its own rate: the 1st, 2nd and 3rd hours each have a rate,
   * and the 4th rate repeats for every hour after that. The 1st hour is the minimum charge.
   * Grace works as under BLOCK_WITH_GRACE, but extra time past grace is charged at the
   * *next* hour's rate, per minute or in blocks. The total can then be rounded. At
   * 600/500/400/400 with 10 minutes of grace, charged per minute: 1h11m costs 691.67,
   * 2h11m costs 1,173.33 and 4h costs 1,900. The rates live in `TieredPricing`.
   */
  TIERED_HOURLY: 'TIERED_HOURLY',
} as const;

export type SessionPricingMode = (typeof SessionPricingMode)[keyof typeof SessionPricingMode];

/**
 * What a document written before pricing modes existed means. Every such package, session
 * and bill item was priced pro-rata, so that is what an absent field has to read as.
 */
export const DEFAULT_SESSION_PRICING_MODE: SessionPricingMode = SessionPricingMode.PRORATA;

/** How TIERED_HOURLY charges the extra time once a grace period is exceeded. */
export const OvertimeMode = {
  /** Every extra minute, at the next hour's rate. */
  PER_MINUTE: 'PER_MINUTE',
  /** Each started block of `overtimeBlockMinutes`, at the next hour's rate, capped at the hour. */
  BLOCK: 'BLOCK',
} as const;

export type OvertimeMode = (typeof OvertimeMode)[keyof typeof OvertimeMode];

/** The direction a TIERED_HOURLY total is rounded in when a rounding step is set. */
export const RoundingMode = {
  UP: 'UP',
  DOWN: 'DOWN',
  /** A tie rounds up. */
  NEAREST: 'NEAREST',
} as const;

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * Every hour of a TIERED_HOURLY package is a full hour. Fixed rather than configurable so
 * the rates read as "per hour" everywhere: on the package, the slip and the receipt.
 */
export const TIER_MINUTES = 60;

/** The 1st, 2nd and 3rd hour rates, then the rate repeated from the 4th hour on. */
export const TIER_COUNT = 4;

/** Allowed rounding steps in minor units: none, or LKR 1, 10, 50 and 100. */
export const ROUNDING_STEPS_MINOR = [0, 100, 1000, 5000, 10000] as const;

/**
 * The configuration of a TIERED_HOURLY package. Snapshotted whole onto the session at
 * check-in and onto the bill item at checkout, beside `graceMinutes`, which it shares with
 * BLOCK_WITH_GRACE. All amounts are integer minor units.
 */
export interface TieredPricing {
  /** Exactly TIER_COUNT hourly rates. The last one repeats for every later hour. */
  hourlyRates: number[];
  overtimeMode: OvertimeMode;
  /** The block length under OvertimeMode.BLOCK, 1..60. Ignored per minute. */
  overtimeBlockMinutes: number;
  /** One of ROUNDING_STEPS_MINOR. 0 means the total is not rounded. */
  roundingStep: number;
  roundingMode: RoundingMode;
}
