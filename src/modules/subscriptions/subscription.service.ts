import { randomInt } from 'crypto';
import { Types } from 'mongoose';
import { subscriptionRepository } from './subscription.repository';
import type { SubscriptionHydrated } from './subscription.model';
import { SubscriptionLedgerType, type SubscriptionLedgerHydrated } from './subscriptionLedger.model';
import {
  SubscriptionStatus,
  computeExpiresAt,
  creditsPerChildForStay,
  normaliseChildName,
  resolveSubscriptionStatus,
  SubscriptionDisplayStatus,
} from './subscriptionRules';
import type {
  AdjustSubscriptionCreditsInput,
  ExtendSubscriptionInput,
  ListSubscriptionsQuery,
  SubscriptionCacheEntry,
  SubscriptionDetailPublic,
  SubscriptionLedgerEntryPublic,
  SubscriptionPublic,
  SubscriptionSummary,
  SubscriptionSummaryQuery,
  UpdateSubscriptionChildrenInput,
} from './subscription.types';
import { BillModel, type BillHydrated } from '../bills/bill.model';
import { SubscriptionModel } from './subscription.model';
import { SubscriptionLedgerModel } from './subscriptionLedger.model';
import { lineRevenueOfKind, revenueRecognizedMatch } from '../../common/reporting/billFilters';
import { resolveDateRange } from '../../common/utils/dateRange';
import {
  PlaySessionModel,
  SubscriptionRejectedReason,
  type PlaySessionHydrated,
  type PlaySessionSubscriptionSubdocument,
} from '../play-sessions/playSession.model';
import { MAX_CHILDREN_PER_TICKET } from '../play-sessions/playSession.validation';
import { settingsService } from '../settings/settings.service';
import { BillItemKind, resolveItemKind } from '../../common/constants/billItemKind';
import { BillStatus } from '../../common/constants/billStatus';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AppError, InvalidStateError, NotFoundError, ValidationError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { logger } from '../../common/logger/logger';
import type { AuthenticatedUser } from '../../common/types/express';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;
/** No 0/O or 1/I/L: the code is read aloud and typed in when a card's QR will not scan. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PREFIX = 'KPS-';
const MAX_CODE_ATTEMPTS = 5;
/** Attempts at taking checkout credits before treating the rest as a cash shortfall. */
const MAX_CHECKOUT_CREDIT_ATTEMPTS = 3;

export class InvalidSubscriptionError extends AppError {
  constructor(message = 'The selected subscription does not exist') {
    super(message, 422, 'INVALID_SUBSCRIPTION');
  }
}

export class SubscriptionInUseError extends AppError {
  constructor(message: string) {
    super(message, 409, 'SUBSCRIPTION_IN_USE');
  }
}

function generateCode(): string {
  let code = CODE_PREFIX;
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function duplicateKeyOn(error: unknown, field: string): boolean {
  const mongoError = error as { code?: number; keyPattern?: Record<string, unknown> };
  return mongoError?.code === MONGO_DUPLICATE_KEY_ERROR_CODE && !!mongoError.keyPattern?.[field];
}

function creditsRemaining(subscription: { creditsTotal: number; creditsUsed: number }): number {
  return Math.max(subscription.creditsTotal - subscription.creditsUsed, 0);
}

export function toPublicSubscription(subscription: SubscriptionHydrated, now = new Date()): SubscriptionPublic {
  const status = resolveSubscriptionStatus(subscription, now);
  return {
    id: subscription.id,
    code: subscription.code,
    customerId: subscription.customerId.toString(),
    parentName: subscription.parentName,
    phoneNumber: subscription.phoneNumber,
    planId: subscription.planId.toString(),
    planName: subscription.planName,
    price: subscription.price,
    creditsPurchased: subscription.creditsPurchased,
    creditsTotal: subscription.creditsTotal,
    creditsUsed: subscription.creditsUsed,
    creditsRemaining: creditsRemaining(subscription),
    visitMinutes: subscription.visitMinutes,
    graceMinutes: subscription.graceMinutes ?? 0,
    extraBlockPrice: subscription.extraBlockPrice,
    maxChildren: subscription.maxChildren ?? null,
    children: subscription.children.map((child) => ({ name: child.name, addedAt: child.addedAt })),
    startsAt: subscription.startsAt,
    expiresAt: subscription.expiresAt,
    status,
    isUsable: status === SubscriptionDisplayStatus.ACTIVE,
    saleBillId: subscription.saleBillId.toString(),
    cancelledAt: subscription.cancelledAt ?? null,
    cancelReason: subscription.cancelReason ?? null,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

function toPublicLedgerEntry(entry: SubscriptionLedgerHydrated): SubscriptionLedgerEntryPublic {
  return {
    id: entry.id,
    type: entry.type,
    delta: entry.delta,
    playSessionId: entry.playSessionId ? entry.playSessionId.toString() : null,
    ticketCode: entry.ticketCode ?? null,
    billId: entry.billId ? entry.billId.toString() : null,
    reason: entry.reason ?? null,
    actorName: entry.actorName,
    at: entry.at,
  };
}

function toCacheEntry(subscription: SubscriptionHydrated): SubscriptionCacheEntry {
  return {
    id: subscription.id,
    code: subscription.code,
    customerId: subscription.customerId.toString(),
    parentName: subscription.parentName,
    phoneNumber: subscription.phoneNumber,
    planName: subscription.planName,
    creditsRemaining: creditsRemaining(subscription),
    visitMinutes: subscription.visitMinutes,
    graceMinutes: subscription.graceMinutes ?? 0,
    extraBlockPrice: subscription.extraBlockPrice,
    children: subscription.children.map((child) => child.name),
    expiresAt: subscription.expiresAt,
  };
}

/**
 * Takes up to `wanted` credits, as many as the subscription still has. A checkout must
 * never fail for want of credits - the child has already played - so whatever cannot be
 * taken becomes a cash shortfall rather than an error. Retried a few times because a
 * concurrent check-in may move the balance between the read and the compare-and-set.
 */
async function takeUpTo(subscriptionId: Types.ObjectId, wanted: number, validAt: Date): Promise<number> {
  if (wanted <= 0) return 0;
  for (let attempt = 0; attempt < MAX_CHECKOUT_CREDIT_ATTEMPTS; attempt += 1) {
    const current = await subscriptionRepository.findById(subscriptionId);
    if (
      !current ||
      current.status !== SubscriptionStatus.ACTIVE ||
      current.expiresAt.getTime() <= validAt.getTime()
    ) {
      return 0;
    }
    const take = Math.min(wanted, creditsRemaining(current));
    if (take <= 0) return 0;
    if (await subscriptionRepository.reserveCredits(subscriptionId, take, validAt)) return take;
  }
  return 0;
}

export interface CheckoutCreditsResult {
  /** Credits taken now, on top of the check-in reservation. */
  checkoutCredits: number;
  /** Every credit this ticket used. */
  creditsUsed: number;
  /** Child-blocks no credit covered, charged at `extraBlockPrice` each. */
  shortfallBlocks: number;
  /** The cash part of the ticket: `shortfallBlocks x extraBlockPrice`. */
  chargedAmount: number;
  creditsRemainingAfter: number;
}

export const subscriptionService = {
  /**
   * Creates the subscription for every SUBSCRIPTION line on a paid bill. Called straight
   * after payment, and again by the startup sweep for any sale a crash left without one -
   * idempotent either way, through the unique index on (saleBillId, saleLineIndex).
   */
  async ensureForBill(bill: BillHydrated, actor: AuthenticatedUser | null): Promise<SubscriptionHydrated[]> {
    if (bill.status !== BillStatus.PAID || !bill.paidAt) return [];

    const lines = bill.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => resolveItemKind(item) === BillItemKind.SUBSCRIPTION && item.subscriptionSale);
    if (lines.length === 0) return [];

    if (!bill.customerId) {
      // Validation requires a phone number on every subscription sale, so this is a bill
      // from outside the API. Left for an admin rather than guessed at.
      logger.error({ billId: bill.id }, 'Paid subscription sale has no customer; subscription not created');
      return [];
    }

    const settings = await settingsService.getRaw();
    const results: SubscriptionHydrated[] = [];

    for (const { item, index } of lines) {
      const sale = item.subscriptionSale!;
      let subscription = await subscriptionRepository.findBySaleLine(bill._id, index);
      let created = false;

      for (let attempt = 0; !subscription && attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        try {
          subscription = await subscriptionRepository.create({
            code: generateCode(),
            customerId: bill.customerId,
            parentName: bill.parentName,
            phoneNumber: bill.phoneNumber,
            planId: sale.planId,
            planName: item.packageName,
            price: item.unitPrice,
            creditsPurchased: sale.visitCredits,
            creditsTotal: sale.visitCredits,
            creditsUsed: 0,
            visitMinutes: sale.visitMinutes,
            graceMinutes: sale.graceMinutes,
            extraBlockPrice: sale.extraBlockPrice,
            maxChildren: sale.maxChildren,
            children: sale.children.map((name) => ({
              name,
              addedAt: bill.paidAt as Date,
              addedBy: bill.cashierId,
            })),
            startsAt: bill.paidAt,
            expiresAt: computeExpiresAt(bill.paidAt, settings.timezone),
            status: SubscriptionStatus.ACTIVE,
            saleBillId: bill._id,
            saleLineIndex: index,
          });
          created = true;
        } catch (error) {
          if (duplicateKeyOn(error, 'saleBillId')) {
            // A concurrent sweep or retry got there first.
            subscription = await subscriptionRepository.findBySaleLine(bill._id, index);
          } else if (!duplicateKeyOn(error, 'code')) {
            throw error;
          }
          // A code collision just draws another code.
        }
      }

      if (!subscription) {
        throw new Error(`Could not create the subscription for bill ${bill.id} line ${index}`);
      }

      // Written back onto the line so the receipt can print the card's code and expiry
      // from the bill alone.
      if (!sale.subscriptionId || sale.code !== subscription.code) {
        await BillModel.updateOne(
          { _id: bill._id },
          {
            $set: {
              [`items.${index}.subscriptionSale.subscriptionId`]: subscription._id,
              [`items.${index}.subscriptionSale.code`]: subscription.code,
              [`items.${index}.subscriptionSale.expiresAt`]: subscription.expiresAt,
            },
          },
        ).exec();
        sale.subscriptionId = subscription._id;
        sale.code = subscription.code;
        sale.expiresAt = subscription.expiresAt;
      }

      if (created) {
        await auditLogService.record({
          userId: actor?.id ?? bill.cashierId.toString(),
          userName: actor?.name ?? bill.cashierName,
          action: AuditAction.SUBSCRIPTION_CREATED,
          entityType: AuditEntityType.SUBSCRIPTION,
          entityId: subscription.id,
          after: toPublicSubscription(subscription),
          metadata: { billId: bill.id, billNumber: bill.billNumber },
        });
      }

      results.push(subscription);
    }

    return results;
  },

  /**
   * Finds paid subscription sales still missing their subscription - a crash between the
   * payment and the create - and finishes them. Run once at startup.
   */
  async sweepMissing(): Promise<number> {
    const bills = await BillModel.find({
      status: BillStatus.PAID,
      items: {
        $elemMatch: { kind: BillItemKind.SUBSCRIPTION, 'subscriptionSale.subscriptionId': null },
      },
    }).exec();

    let repaired = 0;
    for (const bill of bills) {
      try {
        repaired += (await this.ensureForBill(bill, null)).length;
      } catch (err) {
        logger.error({ err, billId: bill.id }, 'Failed to create a missing subscription');
      }
    }
    return repaired;
  },

  /**
   * Reserves credits for a check-in, one per child.
   *
   * Never throws for want of credits. A cashier app checks in locally and syncs later, and
   * a refused sync would park the ticket of a child who is already in the play area. So a
   * reservation that cannot be made returns a snapshot with no credits and a reason, and
   * that ticket is charged in cash, at the plan's extra block price, when the child leaves.
   * Only a subscription that does not exist at all is an error.
   */
  async reserveForCheckIn(input: {
    subscriptionId: string;
    childNames: string[];
    checkInAt: Date;
  }): Promise<{ snapshot: PlaySessionSubscriptionSubdocument; subscription: SubscriptionHydrated }> {
    const subscription = await subscriptionRepository.findById(input.subscriptionId);
    if (!subscription) throw new InvalidSubscriptionError();

    const snapshot: PlaySessionSubscriptionSubdocument = {
      subscriptionId: subscription._id,
      code: subscription.code,
      planName: subscription.planName,
      visitMinutes: subscription.visitMinutes,
      graceMinutes: subscription.graceMinutes ?? 0,
      extraBlockPrice: subscription.extraBlockPrice,
      creditsReserved: 0,
      reservationReleasedAt: null,
      checkoutCredits: 0,
      creditsUsed: null,
      shortfallBlocks: null,
      rejectedReason: null,
    };

    const named = new Set(subscription.children.map((child) => normaliseChildName(child.name)));
    if (!input.childNames.every((name) => named.has(normaliseChildName(name)))) {
      return {
        snapshot: { ...snapshot, rejectedReason: SubscriptionRejectedReason.CHILD_NOT_ON_SUBSCRIPTION },
        subscription,
      };
    }

    const credits = input.childNames.length;
    const reserved = await subscriptionRepository.reserveCredits(subscription._id, credits, input.checkInAt);
    if (reserved) {
      return { snapshot: { ...snapshot, creditsReserved: credits }, subscription: reserved };
    }

    // Read again: the copy above may be older than whatever made the reservation fail.
    const current = (await subscriptionRepository.findById(subscription._id)) ?? subscription;
    let rejectedReason: PlaySessionSubscriptionSubdocument['rejectedReason'] =
      SubscriptionRejectedReason.INSUFFICIENT_CREDITS;
    if (current.status === SubscriptionStatus.CANCELLED) {
      rejectedReason = SubscriptionRejectedReason.CANCELLED;
    } else if (current.expiresAt.getTime() <= input.checkInAt.getTime()) {
      rejectedReason = SubscriptionRejectedReason.EXPIRED;
    }
    return { snapshot: { ...snapshot, rejectedReason }, subscription: current };
  },

  /** Gives back a reservation for a session that was never saved (a lost check-in race). */
  async undoReservation(subscriptionId: Types.ObjectId, credits: number): Promise<void> {
    await subscriptionRepository.releaseCredits(subscriptionId, credits);
  },

  async recordReservation(session: PlaySessionHydrated, actor: AuthenticatedUser): Promise<void> {
    const sub = session.subscription;
    if (!sub || sub.creditsReserved <= 0) return;
    await subscriptionRepository.addLedgerEntry({
      subscriptionId: sub.subscriptionId,
      type: SubscriptionLedgerType.RESERVE,
      delta: -sub.creditsReserved,
      playSessionId: session._id,
      ticketCode: session.ticketCode,
      billId: null,
      reason: null,
      actorId: new Types.ObjectId(actor.id),
      actorName: actor.name,
    });
  },

  /**
   * Gives a voided ticket's reserved credits back. Compare-and-set on the session, so a
   * retried void cannot hand the same credits back twice.
   */
  async releaseReservationForVoid(sessionId: Types.ObjectId, actor: AuthenticatedUser): Promise<void> {
    const session = await PlaySessionModel.findOneAndUpdate(
      {
        _id: sessionId,
        'subscription.creditsReserved': { $gt: 0 },
        'subscription.reservationReleasedAt': null,
      },
      { $set: { 'subscription.reservationReleasedAt': new Date() } },
      { new: true },
    ).exec();
    const sub = session?.subscription;
    if (!session || !sub) return;

    await subscriptionRepository.releaseCredits(sub.subscriptionId, sub.creditsReserved);
    await subscriptionRepository.addLedgerEntry({
      subscriptionId: sub.subscriptionId,
      type: SubscriptionLedgerType.VOID_REVERSAL,
      delta: sub.creditsReserved,
      playSessionId: session._id,
      ticketCode: session.ticketCode,
      billId: null,
      reason: session.voidReason ?? null,
      actorId: new Types.ObjectId(actor.id),
      actorName: actor.name,
    });
  },

  /**
   * Works out and takes the credits a stay used beyond its check-in reservation, after the
   * session has been claimed for checkout. The reservation already holds one credit per
   * child; a longer stay takes more, as many as are left, and any block no credit covers is
   * charged in cash. A ticket whose reservation was rejected is charged entirely in cash.
   */
  async takeCheckoutCredits(session: PlaySessionHydrated, elapsedMinutes: number, childCount: number): Promise<CheckoutCreditsResult> {
    const sub = session.subscription;
    if (!sub) throw new Error('takeCheckoutCredits called for a ticket with no subscription');

    const perChild = creditsPerChildForStay({
      elapsedMinutes,
      visitMinutes: sub.visitMinutes,
      graceMinutes: sub.graceMinutes,
    });
    const needed = perChild * childCount;

    let checkoutCredits = 0;
    let shortfallBlocks = needed;
    if (!sub.rejectedReason) {
      const extra = Math.max(needed - sub.creditsReserved, 0);
      checkoutCredits = await takeUpTo(sub.subscriptionId, extra, session.checkInAt);
      shortfallBlocks = extra - checkoutCredits;
    }

    const after = await subscriptionRepository.findById(sub.subscriptionId);
    return {
      checkoutCredits,
      creditsUsed: sub.rejectedReason ? 0 : sub.creditsReserved + checkoutCredits,
      shortfallBlocks,
      chargedAmount: shortfallBlocks * sub.extraBlockPrice,
      creditsRemainingAfter: after ? creditsRemaining(after) : 0,
    };
  },

  async recordCheckoutCredits(
    session: PlaySessionHydrated,
    checkoutCredits: number,
    billId: Types.ObjectId,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const sub = session.subscription;
    if (!sub || checkoutCredits <= 0) return;
    await subscriptionRepository.addLedgerEntry({
      subscriptionId: sub.subscriptionId,
      type: SubscriptionLedgerType.CHECKOUT_EXTRA,
      delta: -checkoutCredits,
      playSessionId: session._id,
      ticketCode: session.ticketCode,
      billId,
      reason: null,
      actorId: new Types.ObjectId(actor.id),
      actorName: actor.name,
    });
  },

  /**
   * Gives back the credits a checkout took beyond the reservation, when the checkout is
   * undone - rolled back mid-way, or its bill cancelled. Compare-and-set on the session so
   * it happens once. `ledger` is false for a rollback whose taking was never recorded.
   */
  async returnCheckoutCredits(
    sessionId: Types.ObjectId,
    options: { ledger: boolean; actor: AuthenticatedUser; billId: Types.ObjectId | null; reason?: string },
  ): Promise<void> {
    const before = await PlaySessionModel.findOneAndUpdate(
      { _id: sessionId, 'subscription.checkoutCredits': { $gt: 0 } },
      { $set: { 'subscription.checkoutCredits': 0 } },
      { new: false },
    ).exec();
    const sub = before?.subscription;
    if (!before || !sub || sub.checkoutCredits <= 0) return;

    await subscriptionRepository.releaseCredits(sub.subscriptionId, sub.checkoutCredits);
    if (!options.ledger) return;
    await subscriptionRepository.addLedgerEntry({
      subscriptionId: sub.subscriptionId,
      type: SubscriptionLedgerType.CHECKOUT_REVERSAL,
      delta: sub.checkoutCredits,
      playSessionId: before._id,
      ticketCode: before.ticketCode,
      billId: options.billId,
      reason: options.reason ?? null,
      actorId: new Types.ObjectId(options.actor.id),
      actorName: options.actor.name,
    });
  },

  /**
   * Cancels the subscriptions a sale bill created, as part of cancelling that bill. Only a
   * subscription nobody has used yet can go - there are no refunds, so once a credit has
   * been spent the sale stands. All or nothing: one in use leaves every one active.
   */
  async cancelForSaleBill(
    billId: Types.ObjectId,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<SubscriptionHydrated[]> {
    const subscriptions = await subscriptionRepository.findBySaleBillId(billId);
    const cancelled: SubscriptionHydrated[] = [];
    for (const subscription of subscriptions) {
      const updated = await subscriptionRepository.cancelIfUnused(subscription._id, {
        cancelledAt: new Date(),
        cancelledBy: new Types.ObjectId(actor.id),
        cancelReason: reason,
      });
      if (!updated) {
        for (const done of cancelled) await subscriptionRepository.uncancel(done._id);
        throw new SubscriptionInUseError(
          `Subscription ${subscription.code} has already been used, so the sale cannot be cancelled`,
        );
      }
      cancelled.push(updated);
    }
    return cancelled;
  },

  async auditCancelled(subscriptions: SubscriptionHydrated[], actor: AuthenticatedUser, billId: string): Promise<void> {
    for (const subscription of subscriptions) {
      await auditLogService.record({
        userId: actor.id,
        userName: actor.name,
        action: AuditAction.SUBSCRIPTION_CANCELLED,
        entityType: AuditEntityType.SUBSCRIPTION,
        entityId: subscription.id,
        after: toPublicSubscription(subscription),
        metadata: { billId, reason: subscription.cancelReason },
      });
    }
  },

  /** Restores subscriptions cancelled for a bill whose own cancellation then failed. */
  async undoCancel(subscriptions: SubscriptionHydrated[]): Promise<void> {
    for (const subscription of subscriptions) await subscriptionRepository.uncancel(subscription._id);
  },

  async list(query: ListSubscriptionsQuery) {
    const now = new Date();
    const { subscriptions, total } = await subscriptionRepository.list(query, now);
    return {
      subscriptions: subscriptions.map((subscription) => toPublicSubscription(subscription, now)),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async getDetail(id: string): Promise<SubscriptionDetailPublic> {
    const subscription = await subscriptionRepository.findById(id);
    if (!subscription) throw new NotFoundError('Subscription not found');
    const ledger = await subscriptionRepository.listLedger(id);
    return { ...toPublicSubscription(subscription), ledger: ledger.map(toPublicLedgerEntry) };
  },

  async getByCode(code: string): Promise<SubscriptionPublic> {
    const subscription = await subscriptionRepository.findByCode(code.trim().toUpperCase());
    if (!subscription) throw new NotFoundError('No subscription found for this code');
    return toPublicSubscription(subscription);
  },

  async summary(query: SubscriptionSummaryQuery): Promise<SubscriptionSummary> {
    const settings = await settingsService.getRaw();
    const { start, end } = resolveDateRange(settings.timezone, {
      period: query.period ?? (query.from || query.to ? undefined : 'this_month'),
      from: query.from,
      to: query.to,
    });
    const now = new Date();
    const soonUntil = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    const expiredUntil = end.getTime() < now.getTime() ? end : now;

    const [sold] = await BillModel.aggregate<{ count: number; revenue: number }>([
      { $match: { ...revenueRecognizedMatch(start, end), 'items.kind': BillItemKind.SUBSCRIPTION } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: lineRevenueOfKind(BillItemKind.SUBSCRIPTION) },
        },
      },
    ]).exec();

    // Admin grants are not visits, so only the usage entries and their reversals count.
    const [redeemed] = await SubscriptionLedgerModel.aggregate<{ delta: number }>([
      {
        $match: {
          at: { $gte: start, $lte: end },
          type: {
            $in: [
              SubscriptionLedgerType.RESERVE,
              SubscriptionLedgerType.CHECKOUT_EXTRA,
              SubscriptionLedgerType.VOID_REVERSAL,
              SubscriptionLedgerType.CHECKOUT_REVERSAL,
            ],
          },
        },
      },
      { $group: { _id: null, delta: { $sum: '$delta' } } },
    ]).exec();

    const [expired] = await SubscriptionModel.aggregate<{ count: number; unused: number }>([
      { $match: { status: SubscriptionStatus.ACTIVE, expiresAt: { $gte: start, $lte: expiredUntil } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          unused: { $sum: { $max: [{ $subtract: ['$creditsTotal', '$creditsUsed'] }, 0] } },
        },
      },
    ]).exec();

    const [outstanding] = await SubscriptionModel.aggregate<{
      active: number;
      credits: number;
      value: number;
      soon: number;
    }>([
      { $match: { status: SubscriptionStatus.ACTIVE, expiresAt: { $gt: now } } },
      { $addFields: { remaining: { $max: [{ $subtract: ['$creditsTotal', '$creditsUsed'] }, 0] } } },
      {
        $group: {
          _id: null,
          active: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } },
          credits: { $sum: '$remaining' },
          // Priced per credit as bought. Used credits come out of the bought ones first, and
          // credits an admin granted free carry no money, so only unused bought credits count.
          value: {
            $sum: {
              $cond: [
                { $gt: ['$creditsPurchased', 0] },
                {
                  $multiply: [
                    {
                      $max: [
                        { $subtract: [{ $min: ['$creditsPurchased', '$creditsTotal'] }, '$creditsUsed'] },
                        0,
                      ],
                    },
                    { $divide: ['$price', '$creditsPurchased'] },
                  ],
                },
                0,
              ],
            },
          },
          soon: {
            $sum: {
              $cond: [{ $and: [{ $gt: ['$remaining', 0] }, { $lte: ['$expiresAt', soonUntil] }] }, 1, 0],
            },
          },
        },
      },
    ]).exec();

    return {
      rangeStart: start,
      rangeEnd: end,
      soldCount: sold?.count ?? 0,
      soldRevenue: sold?.revenue ?? 0,
      creditsRedeemed: -(redeemed?.delta ?? 0),
      expiredCount: expired?.count ?? 0,
      expiredUnusedCredits: expired?.unused ?? 0,
      activeCount: outstanding?.active ?? 0,
      outstandingCredits: outstanding?.credits ?? 0,
      outstandingValue: Math.round(outstanding?.value ?? 0),
      expiringSoonCount: outstanding?.soon ?? 0,
    };
  },

  async listUsableForCache(): Promise<SubscriptionCacheEntry[]> {
    const subscriptions = await subscriptionRepository.listUsable(new Date());
    return subscriptions.map(toCacheEntry);
  },

  /** A family's unexpired subscriptions, for the check-in screen's phone lookup. */
  async listForCustomer(customerId: string): Promise<SubscriptionPublic[]> {
    const now = new Date();
    const subscriptions = await subscriptionRepository.listUnexpiredForCustomer(customerId, now);
    return subscriptions.map((subscription) => toPublicSubscription(subscription, now));
  },

  /** Balances for several subscriptions at once - the active-sessions board quotes many. */
  async remainingByIds(ids: Types.ObjectId[]): Promise<Map<string, number>> {
    const subscriptions = await subscriptionRepository.findByIds(ids);
    return new Map(subscriptions.map((subscription) => [subscription.id, creditsRemaining(subscription)]));
  },

  async updateChildren(
    id: string,
    input: UpdateSubscriptionChildrenInput,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionPublic> {
    const subscription = await subscriptionRepository.findById(id);
    if (!subscription) throw new NotFoundError('Subscription not found');

    const names = assertChildNames(input.children, subscription.maxChildren ?? null);
    const existing = new Map(subscription.children.map((child) => [normaliseChildName(child.name), child]));
    const now = new Date();
    const children = names.map(
      (name) =>
        existing.get(normaliseChildName(name)) ?? {
          name,
          addedAt: now,
          addedBy: new Types.ObjectId(actor.id),
        },
    );

    const before = toPublicSubscription(subscription);
    const updated = await subscriptionRepository.setChildren(id, children);
    if (!updated) throw new NotFoundError('Subscription not found');

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_CHILDREN_UPDATED,
      entityType: AuditEntityType.SUBSCRIPTION,
      entityId: updated.id,
      before: { children: before.children.map((child) => child.name) },
      after: { children: names },
    });

    return toPublicSubscription(updated);
  },

  async adjustCredits(
    id: string,
    input: AdjustSubscriptionCreditsInput,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionPublic> {
    const subscription = await subscriptionRepository.findById(id);
    if (!subscription) throw new NotFoundError('Subscription not found');

    const updated = await subscriptionRepository.adjustTotal(id, input.delta);
    if (!updated) {
      throw new InvalidStateError(
        `Cannot remove ${Math.abs(input.delta)} credits - only ${creditsRemaining(subscription)} are unused`,
      );
    }

    await subscriptionRepository.addLedgerEntry({
      subscriptionId: updated._id,
      type: SubscriptionLedgerType.ADMIN_ADJUST,
      delta: input.delta,
      playSessionId: null,
      ticketCode: null,
      billId: null,
      reason: input.reason,
      actorId: new Types.ObjectId(actor.id),
      actorName: actor.name,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_CREDITS_ADJUSTED,
      entityType: AuditEntityType.SUBSCRIPTION,
      entityId: updated.id,
      before: { creditsTotal: subscription.creditsTotal, creditsUsed: subscription.creditsUsed },
      after: { creditsTotal: updated.creditsTotal, creditsUsed: updated.creditsUsed },
      metadata: { delta: input.delta, reason: input.reason },
    });

    return toPublicSubscription(updated);
  },

  async extend(id: string, input: ExtendSubscriptionInput, actor: AuthenticatedUser): Promise<SubscriptionPublic> {
    const subscription = await subscriptionRepository.findById(id);
    if (!subscription) throw new NotFoundError('Subscription not found');
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new InvalidStateError('A cancelled subscription cannot be extended');
    }

    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= subscription.startsAt.getTime()) {
      throw new ValidationError('The new expiry must be after the subscription started');
    }

    const updated = await subscriptionRepository.setExpiresAt(id, expiresAt);
    if (!updated) throw new NotFoundError('Subscription not found');

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_EXTENDED,
      entityType: AuditEntityType.SUBSCRIPTION,
      entityId: updated.id,
      before: { expiresAt: subscription.expiresAt },
      after: { expiresAt: updated.expiresAt },
      metadata: { reason: input.reason },
    });

    return toPublicSubscription(updated);
  },
};

/**
 * Validates the names on a subscription: at least one, no duplicates (ignoring case), and
 * no more than the plan allows. Shared by the sale and by later edits.
 */
export function assertChildNames(input: string[], maxChildren: number | null): string[] {
  const names = input.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (names.length === 0) throw new ValidationError('At least one child must be named on a subscription');

  const limit = maxChildren ?? MAX_CHILDREN_PER_TICKET;
  if (names.length > limit) {
    throw new ValidationError(`This subscription allows at most ${limit} ${limit === 1 ? 'child' : 'children'}`);
  }

  const seen = new Set<string>();
  for (const name of names) {
    const key = normaliseChildName(name);
    if (seen.has(key)) throw new ValidationError(`${name} is listed twice`);
    seen.add(key);
  }
  return names;
}
