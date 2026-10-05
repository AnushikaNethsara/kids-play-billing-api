import { Types } from 'mongoose';
import { playSessionRepository } from './playSession.repository';
import { playPackageRepository } from '../play-packages/playPackage.repository';
import { resolveGraceMinutes, resolvePricingMode } from '../play-packages/playPackage.model';
import { resolveTieredPricing } from '../play-packages/tieredPricing.schema';
import { settingsService } from '../settings/settings.service';
import {
  resolveMaximumSessionHours,
  resolveMinimumBillableMinutes,
} from '../settings/settings.model';
import { InvalidPlayPackageError } from '../bills/bill.errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { priceSessionForPeriod, type SessionPriceBreakdown } from '../bills/billCalculator';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { subscriptionService } from '../subscriptions/subscription.service';
import { creditsPerChildForStay, nextCreditAtMinute } from '../subscriptions/subscriptionRules';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { UserRole } from '../../common/constants/roles';
import { AuthorizationError, InvalidStateError, NotFoundError, ValidationError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';
import {
  resolveChildCount,
  resolveChildNames,
  resolveSessionRate,
  sumSessionExtras,
  type PlaySessionExtraSubdocument,
  type PlaySessionHydrated,
  type PlaySessionSubscriptionSubdocument,
} from './playSession.model';
import { productRepository } from '../products/product.repository';
import { InvalidProductError } from '../bills/bill.errors';
import type {
  AddSessionExtrasInput,
  SessionExtraInput,
  CheckInInput,
  CheckInResult,
  ListPlaySessionsQuery,
  PlaySessionPublic,
  PlaySessionWithQuote,
  SessionQuote,
  SessionSubscriptionQuote,
  VoidSessionInput,
} from './playSession.types';
import type { AuthenticatedUser } from '../../common/types/express';

/**
 * How far ahead of the server's own clock a device-supplied check-in time may be before
 * we treat it as a broken clock rather than ordinary drift.
 */
const MAX_CLOCK_SKEW_MINUTES = 10;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;

export function toPublicSession(session: PlaySessionHydrated): PlaySessionPublic {
  return {
    id: session.id,
    ticketCode: session.ticketCode,
    status: session.status,
    childName: session.childName,
    childNames: resolveChildNames(session),
    childCount: resolveChildCount(session),
    playPackageId: session.playPackageId ? session.playPackageId.toString() : null,
    packageName: session.packageName,
    rateDurationMinutes: session.rateDurationMinutes,
    unitPrice: session.unitPrice,
    pricingMode: resolveSessionRate(session).pricingMode,
    graceMinutes: resolveSessionRate(session).graceMinutes,
    tieredPricing: resolveSessionRate(session).tieredPricing,
    customerId: session.customerId ? session.customerId.toString() : null,
    parentName: session.parentName,
    phoneNumber: session.phoneNumber,
    checkInAt: session.checkInAt,
    checkOutAt: session.checkOutAt,
    billedMinutes: session.billedMinutes,
    chargedAmount: session.chargedAmount ?? null,
    billId: session.billId ? session.billId.toString() : null,
    checkInCashierId: session.checkInCashierId.toString(),
    checkInCashierName: session.checkInCashierName,
    checkOutCashierId: session.checkOutCashierId ? session.checkOutCashierId.toString() : null,
    checkOutCashierName: session.checkOutCashierName,
    voidedAt: session.voidedAt,
    voidReason: session.voidReason,
    extras: (session.extras ?? []).map((extra) => ({
      localId: extra.localId,
      productId: extra.productId.toString(),
      productName: extra.productName,
      unitPrice: extra.unitPrice,
      quantity: extra.quantity,
      lineTotal: extra.unitPrice * extra.quantity,
      addedAt: extra.addedAt,
      addedByCashierName: extra.addedByCashierName,
    })),
    extrasTotal: sumSessionExtras(session),
    isTestBill: session.isTestBill ?? false,
    subscription: session.subscription
      ? {
          subscriptionId: session.subscription.subscriptionId.toString(),
          code: session.subscription.code,
          planName: session.subscription.planName,
          visitMinutes: session.subscription.visitMinutes,
          graceMinutes: session.subscription.graceMinutes,
          extraBlockPrice: session.subscription.extraBlockPrice,
          creditsReserved: session.subscription.creditsReserved,
          creditsUsed: session.subscription.creditsUsed ?? null,
          shortfallBlocks: session.subscription.shortfallBlocks ?? null,
          rejectedReason: session.subscription.rejectedReason ?? null,
        }
      : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Prices a session as of `asOf`. Shared by the live quote shown on the cashier's screen
 * and by the authoritative calculation inside checkout, so the two can never drift apart.
 *
 * A family ticket is priced as one child and multiplied out, so it always costs exactly
 * what the same children on separate tickets would - rounding included.
 */
export function quoteSession(
  session: Pick<
    PlaySessionHydrated,
    'checkInAt' | 'unitPrice' | 'rateDurationMinutes' | 'pricingMode' | 'graceMinutes' | 'tieredPricing'
  > &
    Partial<Pick<PlaySessionHydrated, 'childCount' | 'subscription'>>,
  asOf: Date,
  settings: { minimumBillableMinutes: number; maximumSessionHours: number },
  /** A subscription ticket's current balance, when the caller has read it. */
  subscriptionRemaining: number | null = null,
): SessionQuote {
  const { elapsedMinutes, billedMinutes, minimumApplied, breakdown } = priceSessionForPeriod({
    checkInAt: session.checkInAt,
    checkOutAt: asOf,
    rate: resolveSessionRate(session),
    minimumBillableMinutes: settings.minimumBillableMinutes,
  });

  if (session.subscription) {
    return quoteSubscriptionTicket(
      session.subscription,
      resolveChildCount(session),
      { asOf, elapsedMinutes, billedMinutes, breakdown },
      settings,
      subscriptionRemaining,
    );
  }

  // An absolute instant rather than a duration, so a board polling every 30 seconds can
  // tick the countdown down locally instead of showing a number that is half a minute old.
  const nextChargeAt =
    breakdown.minutesUntilNextCharge === null
      ? null
      : new Date(asOf.getTime() + breakdown.minutesUntilNextCharge * MILLISECONDS_PER_MINUTE);

  const childCount = resolveChildCount(session);

  return {
    asOf,
    elapsedMinutes,
    billedMinutes,
    minimumApplied,
    lineTotal: breakdown.lineTotal * childCount,
    perChildLineTotal: breakdown.lineTotal,
    childCount,
    exceedsMaximumSession: elapsedMinutes > settings.maximumSessionHours * MINUTES_PER_HOUR,
    breakdown,
    nextChargeAt,
    subscription: null,
  };
}

/**
 * The live quote of a subscription ticket. Its money is only the cash shortfall - child-
 * blocks no credit will cover - so the useful figures are in credits. The breakdown is
 * re-expressed in the same terms (one block per credit, no pro-rata overage), so a client
 * that only knows how to show blocks still shows something true.
 */
function quoteSubscriptionTicket(
  sub: PlaySessionSubscriptionSubdocument,
  childCount: number,
  period: { asOf: Date; elapsedMinutes: number; billedMinutes: number; breakdown: SessionPriceBreakdown },
  settings: { maximumSessionHours: number },
  subscriptionRemaining: number | null,
): SessionQuote {
  const { asOf, elapsedMinutes, billedMinutes, breakdown } = period;
  const creditsPerChild = creditsPerChildForStay({
    elapsedMinutes,
    visitMinutes: sub.visitMinutes,
    graceMinutes: sub.graceMinutes,
  });
  const creditsNeeded = creditsPerChild * childCount;

  let shortfallBlocks = creditsNeeded;
  if (!sub.rejectedReason) {
    const extra = Math.max(creditsNeeded - sub.creditsReserved, 0);
    const available = subscriptionRemaining ?? extra;
    shortfallBlocks = Math.max(extra - available, 0);
  }

  const lineTotal = shortfallBlocks * sub.extraBlockPrice;
  // Shortfall blocks need not divide evenly between the children, so this is advisory;
  // `lineTotal` is the ticket's figure.
  const perChildLineTotal = Math.floor(lineTotal / childCount);
  const nextMinute = nextCreditAtMinute({
    creditsPerChild,
    visitMinutes: sub.visitMinutes,
    graceMinutes: sub.graceMinutes,
  });
  const minutesUntilNextCredit = Math.max(nextMinute - elapsedMinutes, 0);
  const nextCreditAt = new Date(asOf.getTime() + minutesUntilNextCredit * MILLISECONDS_PER_MINUTE);
  const completed = Math.floor(elapsedMinutes / sub.visitMinutes);
  const remainder = elapsedMinutes - completed * sub.visitMinutes;
  const graceApplied = completed >= 1 && remainder > 0 && remainder <= sub.graceMinutes;

  const subscription: SessionSubscriptionQuote = {
    creditsPerChild,
    creditsNeeded,
    creditsReserved: sub.creditsReserved,
    creditsAvailable: subscriptionRemaining,
    shortfallBlocks,
    nextCreditAt,
  };

  return {
    asOf,
    elapsedMinutes,
    billedMinutes,
    minimumApplied: false,
    lineTotal,
    perChildLineTotal,
    childCount,
    exceedsMaximumSession: elapsedMinutes > settings.maximumSessionHours * MINUTES_PER_HOUR,
    breakdown: {
      ...breakdown,
      lineTotal: perChildLineTotal,
      blocksCharged: creditsPerChild,
      blockSubtotal: perChildLineTotal,
      overageMinutes: 0,
      overageAmount: 0,
      graceApplied,
      // Credits are whole: there is no running extra time between one and the next.
      inExtraTime: false,
      minutesUntilNextCharge: minutesUntilNextCredit,
      hourLines: [],
      overtime: null,
      rawTotal: perChildLineTotal,
      roundingAdjustment: 0,
    },
    nextChargeAt: nextCreditAt,
    subscription,
  };
}

/**
 * Snapshots each requested extra from its product's current name and price. Done before
 * anything is written, so one unknown or inactive product fails the whole request rather
 * than leaving half the extras on the session.
 */
async function snapshotExtras(
  inputs: SessionExtraInput[],
  actor: AuthenticatedUser,
  addedAt: Date,
): Promise<PlaySessionExtraSubdocument[]> {
  const extras: PlaySessionExtraSubdocument[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    // Two entries with one localId in the same request are one sale, not two.
    if (seen.has(input.localId)) continue;
    seen.add(input.localId);

    const product = await productRepository.findById(input.productId);
    if (!product) throw new InvalidProductError('The selected product does not exist');
    if (!product.isActive) throw new InvalidProductError(`${product.name} is not currently available`);

    extras.push({
      localId: input.localId,
      productId: product._id,
      productName: product.name,
      unitPrice: product.price,
      quantity: input.quantity,
      addedAt,
      // Taken from the authenticated session, never the client, like every cashier field.
      addedByCashierId: new Types.ObjectId(actor.id),
      addedByCashierName: actor.name,
    });
  }

  return extras;
}

/** Balances of the subscriptions behind these tickets, in one read. */
async function subscriptionBalances(sessions: PlaySessionHydrated[]): Promise<Map<string, number>> {
  const ids = sessions
    .map((session) => session.subscription?.subscriptionId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  return ids.length > 0 ? subscriptionService.remainingByIds(ids) : new Map();
}

function balanceFor(session: PlaySessionHydrated, balances: Map<string, number>): number | null {
  const id = session.subscription?.subscriptionId?.toString();
  return id ? (balances.get(id) ?? null) : null;
}

export const playSessionService = {
  /**
   * Checking a child - or a family of children on one ticket - in. Retry-safe by construction: the unique index on `ticketCode`
   * means a sync that retries after an ambiguous network failure gets the session it
   * already created back, rather than checking the same child in twice. This is why no
   * Idempotency-Key header is needed here, unlike bill completion.
   */
  async checkIn(input: CheckInInput, actor: AuthenticatedUser): Promise<CheckInResult> {
    const existing = await playSessionRepository.findByTicketCode(input.ticketCode);
    if (existing) {
      // A replay may carry extras added on the device after the first attempt went out.
      // They are merged by localId, so the ones the first attempt already saved are not
      // sold twice.
      const known = new Set((existing.extras ?? []).map((extra) => extra.localId));
      const pending = (input.extras ?? []).filter((extra) => !known.has(extra.localId));
      if (pending.length > 0 && existing.status === PlaySessionStatus.ACTIVE) {
        const session = await this.addExtras(input.ticketCode, { extras: pending }, actor);
        return { session, created: false };
      }
      return { session: toPublicSession(existing), created: false };
    }

    const settings = await settingsService.getRaw();
    const now = new Date();
    const checkInAt = this.resolveCheckInAt(input.checkInAt, now, resolveMaximumSessionHours(settings));

    // Validation guarantees exactly one of the two is present.
    const childNames = input.childNames ?? [input.childName as string];

    // Everything that can reject the request is checked before any credit is reserved, so
    // a refused check-in never costs the family a visit.
    const packageRate = input.subscriptionId
      ? null
      : await this.packageRateFor(input.playPackageId as string);
    const extras = await snapshotExtras(input.extras ?? [], actor, checkInAt);

    let subscription: PlaySessionSubscriptionSubdocument | null = null;
    let customer = {
      customerId: input.customer?.customerId ? new Types.ObjectId(input.customer.customerId) : null,
      parentName: input.customer?.parentName ?? '',
      phoneNumber: input.customer?.phoneNumber ?? '',
    };
    if (input.subscriptionId) {
      const reservation = await subscriptionService.reserveForCheckIn({
        subscriptionId: input.subscriptionId,
        childNames,
        checkInAt,
      });
      subscription = reservation.snapshot;
      // The family is whoever bought the subscription, unless the cashier said otherwise.
      customer = {
        customerId: customer.customerId ?? reservation.subscription.customerId,
        parentName: customer.parentName || reservation.subscription.parentName,
        phoneNumber: customer.phoneNumber || reservation.subscription.phoneNumber,
      };
    }

    // A subscription ticket has no package. Its rate fields describe the plan's cash
    // fallback - block pricing at the extra block price - so every display that predates
    // subscriptions still reads something true; pricing itself goes by `subscription`.
    const rate = subscription
      ? {
          playPackageId: null,
          packageName: subscription.planName,
          rateDurationMinutes: subscription.visitMinutes,
          unitPrice: subscription.extraBlockPrice,
          pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
          graceMinutes: subscription.graceMinutes,
          tieredPricing: null,
        }
      : (packageRate as NonNullable<typeof packageRate>);

    try {
      const session = await playSessionRepository.create({
        ticketCode: input.ticketCode,
        status: PlaySessionStatus.ACTIVE,
        childName: childNames.join(', '),
        childNames,
        childCount: childNames.length,
        ...rate,
        ...customer,
        checkInAt,
        checkInRecordedAt: now,
        // The cashier is always taken from the authenticated session, never the client.
        checkInCashierId: new Types.ObjectId(actor.id),
        checkInCashierName: actor.name,
        extras,
        subscription,
      });

      await subscriptionService.recordReservation(session, actor);

      return { session: toPublicSession(session), created: true };
    } catch (err) {
      // Whatever went wrong, this request's reservation is on no saved ticket.
      if (subscription && subscription.creditsReserved > 0) {
        await subscriptionService.undoReservation(subscription.subscriptionId, subscription.creditsReserved);
      }
      // Two syncs racing on the same ticket code: the loser reads back the winner's
      // session instead of failing, keeping the retry safe end to end.
      if ((err as { code?: number }).code === 11000) {
        const raced = await playSessionRepository.findByTicketCode(input.ticketCode);
        if (raced) return { session: toPublicSession(raced), created: false };
      }
      throw err;
    }
  },

  /** A package's rate as a session snapshot, refusing a missing or inactive package. */
  async packageRateFor(playPackageId: string) {
    const pkg = await playPackageRepository.findById(playPackageId);
    if (!pkg) {
      throw new InvalidPlayPackageError('The selected play package does not exist');
    }
    if (!pkg.isActive) {
      throw new InvalidPlayPackageError('The selected play package is not currently available');
    }

    // Read through the same resolver the session uses, so the snapshot is already
    // normalised (grace 0 under PRORATA) rather than a raw copy of the package.
    const packageRate = resolveSessionRate({
      unitPrice: pkg.price,
      rateDurationMinutes: pkg.durationMinutes,
      pricingMode: resolvePricingMode(pkg),
      graceMinutes: resolveGraceMinutes(pkg),
      tieredPricing: resolveTieredPricing(pkg),
    });

    return {
      playPackageId: pkg._id,
      packageName: pkg.name,
      rateDurationMinutes: pkg.durationMinutes,
      unitPrice: pkg.price,
      pricingMode: packageRate.pricingMode,
      // Normalised at snapshot time: the package keeps its grace value so flipping the
      // mode back does not lose it, but a PRORATA session carries 0, so even a client
      // that forgets to check the mode cannot misprice from this snapshot.
      graceMinutes: packageRate.graceMinutes,
      // The whole tier table, so a later edit to the package never reprices this child.
      tieredPricing: packageRate.tieredPricing,
    };
  },

  /**
   * A device-supplied check-in time is trusted only within sane bounds. Note that when
   * check-in and check-out both happen on the same till, a constant clock offset cancels
   * out of the elapsed calculation - the absolute timestamp matters for the receipt and
   * the audit trail, but it is the difference that bills.
   */
  resolveCheckInAt(supplied: string | undefined, now: Date, maximumSessionHours: number): Date {
    if (!supplied) return now;

    const checkInAt = new Date(supplied);
    if (Number.isNaN(checkInAt.getTime())) {
      throw new ValidationError('Check-in time is not a valid date');
    }

    const skewMs = checkInAt.getTime() - now.getTime();
    if (skewMs > MAX_CLOCK_SKEW_MINUTES * 60_000) {
      throw new ValidationError('Check-in time is in the future - please check the device clock');
    }

    const maximumAgeMs = maximumSessionHours * MINUTES_PER_HOUR * 60_000;
    if (-skewMs > maximumAgeMs) {
      throw new ValidationError(
        `Check-in time is more than ${maximumSessionHours} hours old and cannot be recorded`,
      );
    }

    return checkInAt;
  },

  async getById(id: string): Promise<PlaySessionHydrated> {
    const session = await playSessionRepository.findById(id);
    if (!session) throw new NotFoundError('Play session not found');
    return session;
  },

  async getPublicById(id: string): Promise<PlaySessionWithQuote> {
    return this.withQuote(await this.getById(id));
  },

  /** The scan endpoint: resolve a printed ticket and price it as of right now. */
  async getByTicketCode(ticketCode: string): Promise<PlaySessionWithQuote> {
    const session = await playSessionRepository.findByTicketCode(ticketCode);
    if (!session) throw new NotFoundError('No ticket found for this code');
    return this.withQuote(session);
  },

  async withQuote(session: PlaySessionHydrated, asOf = new Date()): Promise<PlaySessionWithQuote> {
    if (session.status !== PlaySessionStatus.ACTIVE) {
      return { session: toPublicSession(session), quote: null };
    }

    const settings = await settingsService.getRaw();
    const balances = await subscriptionBalances([session]);
    return {
      session: toPublicSession(session),
      quote: quoteSession(
        session,
        asOf,
        {
          minimumBillableMinutes: resolveMinimumBillableMinutes(settings),
          maximumSessionHours: resolveMaximumSessionHours(settings),
        },
        balanceFor(session, balances),
      ),
    };
  },

  async list(query: ListPlaySessionsQuery) {
    const { sessions, total } = await playSessionRepository.list(query);
    const settings = await settingsService.getRaw();
    const asOf = new Date();
    const quoteSettings = {
      minimumBillableMinutes: resolveMinimumBillableMinutes(settings),
      maximumSessionHours: resolveMaximumSessionHours(settings),
    };
    const balances = await subscriptionBalances(
      sessions.filter((session) => session.status === PlaySessionStatus.ACTIVE),
    );

    return {
      sessions: sessions.map((session) => ({
        session: toPublicSession(session),
        quote:
          session.status === PlaySessionStatus.ACTIVE
            ? quoteSession(session, asOf, quoteSettings, balanceFor(session, balances))
            : null,
      })),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  /**
   * Sells products onto a child who is still playing; they are charged at checkout.
   * Idempotent per extra `localId`, so the device can retry a sync blindly. An extra for a
   * session that has already been checked out is refused rather than silently dropped:
   * the family has paid and gone, and the sale has to be rung up as a bill of its own.
   */
  async addExtras(
    ticketCode: string,
    input: AddSessionExtrasInput,
    actor: AuthenticatedUser,
  ): Promise<PlaySessionPublic> {
    const session = await playSessionRepository.findByTicketCode(ticketCode);
    if (!session) throw new NotFoundError('No ticket found for this code');

    const known = new Set((session.extras ?? []).map((extra) => extra.localId));
    const pending = input.extras.filter((extra) => !known.has(extra.localId));
    if (pending.length === 0) return toPublicSession(session);

    if (session.status !== PlaySessionStatus.ACTIVE) {
      throw new InvalidStateError(
        'This child has already been checked out - sell the items on a separate bill',
      );
    }

    let latest: PlaySessionHydrated = session;
    for (const extra of await snapshotExtras(pending, actor, new Date())) {
      const updated = await playSessionRepository.addExtraIfActive(ticketCode, extra);
      if (updated) {
        latest = updated;
        continue;
      }

      // Lost a race: either a concurrent retry already added this one, which is fine, or
      // the child was checked out in between, which is not.
      const current = await playSessionRepository.findByTicketCode(ticketCode);
      if (!current) throw new NotFoundError('No ticket found for this code');
      if (!(current.extras ?? []).some((saved) => saved.localId === extra.localId)) {
        throw new InvalidStateError(
          'This child has already been checked out - sell the items on a separate bill',
        );
      }
      latest = current;
    }

    return toPublicSession(latest);
  },

  /**
   * Takes back an extra added by mistake, before checkout. Always audited: removing a sale
   * the family will never be charged for is exactly what an audit trail is for.
   */
  async removeExtra(
    ticketCode: string,
    localId: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<PlaySessionPublic> {
    const session = await playSessionRepository.findByTicketCode(ticketCode);
    if (!session) throw new NotFoundError('No ticket found for this code');

    const extra = (session.extras ?? []).find((saved) => saved.localId === localId);
    // Already gone: a retried removal is a no-op.
    if (!extra) return toPublicSession(session);

    if (session.status !== PlaySessionStatus.ACTIVE) {
      throw new InvalidStateError('Items on a checked-out ticket are on its bill and cannot be removed');
    }

    const updated = await playSessionRepository.removeExtraIfActive(ticketCode, localId);
    if (!updated) {
      const current = await playSessionRepository.findByTicketCode(ticketCode);
      if (current && !(current.extras ?? []).some((saved) => saved.localId === localId)) {
        return toPublicSession(current);
      }
      throw new InvalidStateError('Items on a checked-out ticket are on its bill and cannot be removed');
    }

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SESSION_EXTRA_REMOVED,
      entityType: AuditEntityType.PLAY_SESSION,
      entityId: updated.id,
      metadata: {
        ticketCode,
        childName: updated.childName,
        productName: extra.productName,
        quantity: extra.quantity,
        lineTotal: extra.unitPrice * extra.quantity,
        addedByCashierName: extra.addedByCashierName,
        reason: reason ?? null,
      },
    });

    return toPublicSession(updated);
  },

  /**
   * Writes off a mistaken check-in. A voided session never produces a bill, which is
   * exactly why cashiers may only void their own - it is the one way to make a ticket
   * disappear without money changing hands.
   */
  async voidSession(id: string, input: VoidSessionInput, actor: AuthenticatedUser): Promise<PlaySessionPublic> {
    const session = await this.getById(id);

    if (actor.role === UserRole.CASHIER && session.checkInCashierId.toString() !== actor.id) {
      throw new AuthorizationError('Cashiers may only void sessions they checked in');
    }
    if (session.status !== PlaySessionStatus.ACTIVE) {
      throw new InvalidStateError('Only active sessions can be voided');
    }

    const updated = await playSessionRepository.voidIfActive(id, {
      voidedBy: new Types.ObjectId(actor.id),
      voidReason: input.reason,
      voidedAt: new Date(),
    });

    if (!updated) {
      throw new InvalidStateError('This session is no longer active - it may have just been checked out');
    }

    // A voided ticket was never a visit, so whatever credits it reserved go back.
    if (updated.subscription) await subscriptionService.releaseReservationForVoid(updated._id, actor);

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SESSION_VOIDED,
      entityType: AuditEntityType.PLAY_SESSION,
      entityId: updated.id,
      before: toPublicSession(session),
      after: toPublicSession(updated),
      metadata: { reason: input.reason, ticketCode: updated.ticketCode },
    });

    return toPublicSession(updated);
  },
};
