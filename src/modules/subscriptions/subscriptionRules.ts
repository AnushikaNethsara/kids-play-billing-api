import { DateTime } from 'luxon';

/**
 * The pure rules of a subscription, shared by check-in, checkout, the live quote and the
 * reports - and mirrored exactly in the cashier app's `src/lib/sessionBilling.ts`, which
 * shows the same numbers offline. Change one, change both.
 */

/**
 * Credits one child uses for a stay of `elapsedMinutes`.
 *
 * One credit covers a `visitMinutes` block, and a stay shorter than that still uses the
 * whole credit. After each completed block, `graceMinutes` of overrun are forgiven before
 * the next credit is taken - the same boundaries as a BLOCK_WITH_GRACE package, but always
 * whole credits: a credit cannot be part-used the way a block package charges a pro-rata
 * overage.
 *
 *   visitMinutes 60, grace 10:  20m -> 1,  70m -> 1,  71m -> 2,  130m -> 2,  131m -> 3
 */
export function creditsPerChildForStay(input: {
  elapsedMinutes: number;
  visitMinutes: number;
  graceMinutes: number;
}): number {
  const { elapsedMinutes, visitMinutes } = input;
  const graceMinutes = Math.max(input.graceMinutes, 0);
  if (!(visitMinutes > 0)) throw new Error('visitMinutes must be positive');

  const completed = Math.floor(Math.max(elapsedMinutes, 0) / visitMinutes);
  const remainder = Math.max(elapsedMinutes, 0) - completed * visitMinutes;
  const extra = completed >= 1 && remainder > graceMinutes ? 1 : 0;
  return Math.max(completed, 1) + extra;
}

/** Credits a whole ticket uses: every child on it plays the same time. */
export function creditsForStay(input: {
  elapsedMinutes: number;
  visitMinutes: number;
  graceMinutes: number;
  childCount: number;
}): number {
  return creditsPerChildForStay(input) * Math.max(input.childCount, 1);
}

/**
 * The elapsed minute at which one child next uses another credit, given the credits used
 * so far. Grace is always shorter than a block, so the next credit always starts just past
 * the grace of the block now being played.
 */
export function nextCreditAtMinute(input: {
  creditsPerChild: number;
  visitMinutes: number;
  graceMinutes: number;
}): number {
  return input.creditsPerChild * input.visitMinutes + Math.max(input.graceMinutes, 0) + 1;
}

/**
 * A subscription runs for one calendar month from the day it is bought, to the end of the
 * same day next month in the business timezone: bought 5 Oct, valid to 5 Nov 23:59:59.999.
 * Luxon clamps to the last day of a shorter month, so 31 Jan runs to 28 (or 29) Feb.
 */
export function computeExpiresAt(startsAt: Date, timezone: string): Date {
  return DateTime.fromJSDate(startsAt).setZone(timezone).plus({ months: 1 }).endOf('day').toJSDate();
}

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/**
 * What a client is shown. Only ACTIVE and CANCELLED are ever stored; EXPIRED and
 * EXHAUSTED are read off the dates and counters, so nothing has to run at midnight to keep
 * them true.
 */
export const SubscriptionDisplayStatus = {
  ACTIVE: 'ACTIVE',
  EXHAUSTED: 'EXHAUSTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionDisplayStatus =
  (typeof SubscriptionDisplayStatus)[keyof typeof SubscriptionDisplayStatus];

export function resolveSubscriptionStatus(
  subscription: { status: string; expiresAt: Date; creditsUsed: number; creditsTotal: number },
  now: Date,
): SubscriptionDisplayStatus {
  if (subscription.status === SubscriptionStatus.CANCELLED) return SubscriptionDisplayStatus.CANCELLED;
  if (subscription.expiresAt.getTime() <= now.getTime()) return SubscriptionDisplayStatus.EXPIRED;
  if (subscription.creditsUsed >= subscription.creditsTotal) return SubscriptionDisplayStatus.EXHAUSTED;
  return SubscriptionDisplayStatus.ACTIVE;
}

/** Child names compared the way a cashier would: ignoring case and surrounding spaces. */
export function normaliseChildName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
