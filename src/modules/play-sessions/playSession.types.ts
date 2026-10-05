import type { PlaySessionStatus } from '../../common/constants/sessionStatus';
import type { SessionPricingMode, TieredPricing } from '../../common/constants/pricingModes';
import type { SessionPriceBreakdown } from '../bills/billCalculator';

/** A product sold onto a playing child, as the device sends it. */
export interface SessionExtraInput {
  /** Device-generated; makes a retried add a no-op rather than a second sale. */
  localId: string;
  productId: string;
  quantity: number;
}

export interface AddSessionExtrasInput {
  extras: SessionExtraInput[];
}

export interface PlaySessionExtraPublic {
  localId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  addedAt: Date;
  addedByCashierName: string;
}

export interface CheckInInput {
  ticketCode: string;
  /** A single child. Exactly one of this and `childNames` is sent. */
  childName?: string;
  /** A family ticket: every child on the same package, checking out together. */
  childNames?: string[];
  /** The package the children play on. Exactly one of this and `subscriptionId` is sent. */
  playPackageId?: string;
  /**
   * Pay with a subscription's credits instead of a package, one credit per child. The
   * children must be named on the subscription. Never refused for want of credits: see
   * `PlaySessionSubscriptionPublic.rejectedReason`.
   */
  subscriptionId?: string;
  /** ISO timestamp from the device. Defaults to server time when omitted (online check-in). */
  checkInAt?: string;
  customer?: {
    customerId?: string;
    parentName?: string;
    phoneNumber?: string;
  };
  /** Socks and the like handed over at the gate, charged at checkout. */
  extras?: SessionExtraInput[];
}

export interface VoidSessionInput {
  reason: string;
}

/**
 * `created` is false when the ticket code was already known - a retried offline sync
 * replaying a check-in it had already completed. The caller uses it to answer 200
 * rather than 201, so a replay is distinguishable from a fresh check-in.
 */
export interface CheckInResult {
  session: PlaySessionPublic;
  created: boolean;
}

export interface PlaySessionSubscriptionPublic {
  subscriptionId: string;
  code: string;
  planName: string;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  creditsReserved: number;
  /** Set at checkout. */
  creditsUsed: number | null;
  shortfallBlocks: number | null;
  /**
   * Why no credits could be reserved at check-in (no credits left, expired, cancelled, or a
   * child not named on it). Such a ticket is charged entirely at `extraBlockPrice`.
   */
  rejectedReason: string | null;
}

export interface PlaySessionPublic {
  id: string;
  ticketCode: string;
  status: PlaySessionStatus;
  /** The one name, or the names joined with ", " on a family ticket. */
  childName: string;
  /** One name per child. Never empty - an older ticket answers `[childName]`. */
  childNames: string[];
  /** Children on this ticket. The ticket is charged one child's price times this. */
  childCount: number;
  /** Null on a ticket paid for with a subscription. */
  playPackageId: string | null;
  packageName: string;
  rateDurationMinutes: number;
  unitPrice: number;
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  /** The hourly rates, overtime and rounding of a TIERED_HOURLY session. Null otherwise. */
  tieredPricing: TieredPricing | null;
  customerId: string | null;
  parentName: string;
  phoneNumber: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  billedMinutes: number | null;
  /** What this session was billed, frozen at checkout. Null while still playing. */
  chargedAmount: number | null;
  billId: string | null;
  checkInCashierId: string;
  checkInCashierName: string;
  checkOutCashierId: string | null;
  checkOutCashierName: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  /** Products sold onto this visit; charged at checkout on top of the time. */
  extras: PlaySessionExtraPublic[];
  /** What `extras` add up to. Not included in the quote, which prices time only. */
  extrasTotal: number;
  /** True once the bill this session was checked out into was marked as a test bill. */
  isTestBill: boolean;
  /** Set only on a ticket paid for with subscription credits. */
  subscription: PlaySessionSubscriptionPublic | null;
  createdAt: Date;
  updatedAt: Date;
}

/** How a subscription ticket stands so far, in credits rather than money. */
export interface SessionSubscriptionQuote {
  /** Credits one child has used so far. */
  creditsPerChild: number;
  /** Credits the whole ticket has used so far: `creditsPerChild x childCount`. */
  creditsNeeded: number;
  creditsReserved: number;
  /** The subscription's balance right now, or null if it could not be read. */
  creditsAvailable: number | null;
  /** Child-blocks that will be charged in cash if the family leaves now. */
  shortfallBlocks: number;
  /** When the ticket next uses another credit per child. */
  nextCreditAt: Date;
}

/**
 * A non-binding price for a session as of a given moment, so the cashier's screen can
 * show a live running total. The authoritative amount is always recomputed inside
 * `POST /bills/from-sessions`.
 */
export interface SessionQuote {
  asOf: Date;
  elapsedMinutes: number;
  billedMinutes: number;
  /** Always false under BLOCK_WITH_GRACE and TIERED_HOURLY, where the first block or hour is the floor. */
  minimumApplied: boolean;
  /** What the whole ticket costs so far: `perChildLineTotal x childCount`. */
  lineTotal: number;
  /** What one child on this ticket costs so far - the figure `breakdown` explains. */
  perChildLineTotal: number;
  childCount: number;
  /** True once the session has run past `BusinessSettings.maximumSessionHours`. */
  exceedsMaximumSession: boolean;
  /**
   * How one child's price was arrived at, so a client never has to work it out. On a
   * family ticket this is per child: its `lineTotal` is `perChildLineTotal`.
   */
  breakdown: SessionPriceBreakdown;
  /**
   * When the total next rises, as an instant rather than a duration - a board that polls
   * every 30 seconds can then tick a countdown locally instead of showing a stale number.
   * Null under PRORATA, where every passing minute already costs something.
   */
  nextChargeAt: Date | null;
  /**
   * Set only on a subscription ticket, whose `lineTotal` is just the cash shortfall (usually
   * 0) and whose `breakdown` describes credits as blocks.
   */
  subscription: SessionSubscriptionQuote | null;
}

export interface PlaySessionWithQuote {
  session: PlaySessionPublic;
  /** Null for sessions that are no longer active - there is nothing left to quote. */
  quote: SessionQuote | null;
}

export interface ListPlaySessionsQuery {
  page: number;
  limit: number;
  status?: PlaySessionStatus;
  phoneNumber?: string;
  childName?: string;
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest';
}
