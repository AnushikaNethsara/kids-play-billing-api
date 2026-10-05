import type { SubscriptionDisplayStatus } from './subscriptionRules';
import type { SubscriptionLedgerType } from './subscriptionLedger.model';

export interface SubscriptionChildPublic {
  name: string;
  addedAt: Date;
}

export interface SubscriptionPublic {
  id: string;
  code: string;
  customerId: string;
  parentName: string;
  phoneNumber: string;
  planId: string;
  planName: string;
  price: number;
  creditsPurchased: number;
  creditsTotal: number;
  creditsUsed: number;
  /** `creditsTotal - creditsUsed`, never negative. */
  creditsRemaining: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  maxChildren: number | null;
  children: SubscriptionChildPublic[];
  startsAt: Date;
  expiresAt: Date;
  /** Derived: EXPIRED and EXHAUSTED are read off the dates and counters. */
  status: SubscriptionDisplayStatus;
  /** True while a check-in can reserve against it right now. */
  isUsable: boolean;
  saleBillId: string;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionLedgerEntryPublic {
  id: string;
  type: SubscriptionLedgerType;
  delta: number;
  playSessionId: string | null;
  ticketCode: string | null;
  billId: string | null;
  reason: string | null;
  actorName: string;
  at: Date;
}

export interface SubscriptionDetailPublic extends SubscriptionPublic {
  ledger: SubscriptionLedgerEntryPublic[];
}

/**
 * What the cashier app keeps on disk so a family can check in on their subscription with
 * no network. Advisory only: the server re-checks the balance when the check-in syncs.
 */
export interface SubscriptionCacheEntry {
  id: string;
  code: string;
  customerId: string;
  parentName: string;
  phoneNumber: string;
  planName: string;
  creditsRemaining: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  children: string[];
  expiresAt: Date;
}

export interface ListSubscriptionsQuery {
  page: number;
  limit: number;
  phoneNumber?: string;
  customerId?: string;
  code?: string;
  status?: SubscriptionDisplayStatus;
  expiringWithinDays?: number;
}

export interface SubscriptionSummaryQuery {
  period?: string;
  from?: string;
  to?: string;
}

/**
 * The subscriptions report. The sold, redeemed and expired figures cover the requested
 * period; the rest are a snapshot as of now - a balance, not a flow.
 */
export interface SubscriptionSummary {
  rangeStart: Date;
  rangeEnd: Date;
  /** Subscriptions sold (paid) in the period, and what they brought in. */
  soldCount: number;
  soldRevenue: number;
  /** Credits used by visits in the period, net of voids and cancelled checkouts. */
  creditsRedeemed: number;
  /** Subscriptions that ran out of time in the period, and the credits left unused on them. */
  expiredCount: number;
  expiredUnusedCredits: number;
  /** Subscriptions a family can check in with right now. */
  activeCount: number;
  /** Credits still to be used across every unexpired subscription. */
  outstandingCredits: number;
  /**
   * What those credits were paid for: each subscription's unused credits at its own price
   * per credit. Money taken for visits not yet given.
   */
  outstandingValue: number;
  /** Active subscriptions ending within the next 7 days. */
  expiringSoonCount: number;
}

export interface UpdateSubscriptionChildrenInput {
  children: string[];
}

export interface AdjustSubscriptionCreditsInput {
  /** Credits to add (positive) or remove (negative). */
  delta: number;
  reason: string;
}

export interface ExtendSubscriptionInput {
  expiresAt: string;
  reason: string;
}
