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
} as const;

export type SessionPricingMode = (typeof SessionPricingMode)[keyof typeof SessionPricingMode];

/**
 * What a document written before pricing modes existed means. Every such package, session
 * and bill item was priced pro-rata, so that is what an absent field has to read as.
 */
export const DEFAULT_SESSION_PRICING_MODE: SessionPricingMode = SessionPricingMode.PRORATA;
