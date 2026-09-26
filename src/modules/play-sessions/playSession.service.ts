import { Types } from 'mongoose';
import { playSessionRepository } from './playSession.repository';
import { playPackageRepository } from '../play-packages/playPackage.repository';
import { resolveGraceMinutes, resolvePricingMode } from '../play-packages/playPackage.model';
import { settingsService } from '../settings/settings.service';
import {
  resolveMaximumSessionHours,
  resolveMinimumBillableMinutes,
} from '../settings/settings.model';
import { InvalidPlayPackageError } from '../bills/bill.errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { priceSessionForPeriod } from '../bills/billCalculator';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { UserRole } from '../../common/constants/roles';
import { AuthorizationError, InvalidStateError, NotFoundError, ValidationError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { resolveSessionRate, type PlaySessionHydrated } from './playSession.model';
import type {
  CheckInInput,
  CheckInResult,
  ListPlaySessionsQuery,
  PlaySessionPublic,
  PlaySessionWithQuote,
  SessionQuote,
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
    playPackageId: session.playPackageId.toString(),
    packageName: session.packageName,
    rateDurationMinutes: session.rateDurationMinutes,
    unitPrice: session.unitPrice,
    pricingMode: resolveSessionRate(session).pricingMode,
    graceMinutes: resolveSessionRate(session).graceMinutes,
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
    isTestBill: session.isTestBill ?? false,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Prices a session as of `asOf`. Shared by the live quote shown on the cashier's screen
 * and by the authoritative calculation inside checkout, so the two can never drift apart.
 */
export function quoteSession(
  session: Pick<
    PlaySessionHydrated,
    'checkInAt' | 'unitPrice' | 'rateDurationMinutes' | 'pricingMode' | 'graceMinutes'
  >,
  asOf: Date,
  settings: { minimumBillableMinutes: number; maximumSessionHours: number },
): SessionQuote {
  const { elapsedMinutes, billedMinutes, minimumApplied, breakdown } = priceSessionForPeriod({
    checkInAt: session.checkInAt,
    checkOutAt: asOf,
    rate: resolveSessionRate(session),
    minimumBillableMinutes: settings.minimumBillableMinutes,
  });

  // An absolute instant rather than a duration, so a board polling every 30 seconds can
  // tick the countdown down locally instead of showing a number that is half a minute old.
  const nextChargeAt =
    breakdown.minutesUntilNextCharge === null
      ? null
      : new Date(asOf.getTime() + breakdown.minutesUntilNextCharge * MILLISECONDS_PER_MINUTE);

  return {
    asOf,
    elapsedMinutes,
    billedMinutes,
    minimumApplied,
    lineTotal: breakdown.lineTotal,
    exceedsMaximumSession: elapsedMinutes > settings.maximumSessionHours * MINUTES_PER_HOUR,
    breakdown,
    nextChargeAt,
  };
}

export const playSessionService = {
  /**
   * Checking a child in. Retry-safe by construction: the unique index on `ticketCode`
   * means a sync that retries after an ambiguous network failure gets the session it
   * already created back, rather than checking the same child in twice. This is why no
   * Idempotency-Key header is needed here, unlike bill completion.
   */
  async checkIn(input: CheckInInput, actor: AuthenticatedUser): Promise<CheckInResult> {
    const existing = await playSessionRepository.findByTicketCode(input.ticketCode);
    if (existing) return { session: toPublicSession(existing), created: false };

    const settings = await settingsService.getRaw();
    const pkg = await playPackageRepository.findById(input.playPackageId);
    if (!pkg) {
      throw new InvalidPlayPackageError('The selected play package does not exist');
    }
    if (!pkg.isActive) {
      throw new InvalidPlayPackageError('The selected play package is not currently available');
    }

    const now = new Date();
    const checkInAt = this.resolveCheckInAt(input.checkInAt, now, resolveMaximumSessionHours(settings));

    // Read through the same resolver the session uses, so the snapshot is already
    // normalised (grace 0 under PRORATA) rather than a raw copy of the package.
    const packageRate = resolveSessionRate({
      unitPrice: pkg.price,
      rateDurationMinutes: pkg.durationMinutes,
      pricingMode: resolvePricingMode(pkg),
      graceMinutes: resolveGraceMinutes(pkg),
    });

    try {
      const session = await playSessionRepository.create({
        ticketCode: input.ticketCode,
        status: PlaySessionStatus.ACTIVE,
        childName: input.childName,
        playPackageId: pkg._id,
        packageName: pkg.name,
        rateDurationMinutes: pkg.durationMinutes,
        unitPrice: pkg.price,
        pricingMode: packageRate.pricingMode,
        // Normalised at snapshot time: the package keeps its grace value so flipping the
        // mode back does not lose it, but a PRORATA session carries 0, so even a client
        // that forgets to check the mode cannot misprice from this snapshot.
        graceMinutes: packageRate.graceMinutes,
        customerId: input.customer?.customerId ? new Types.ObjectId(input.customer.customerId) : null,
        parentName: input.customer?.parentName ?? '',
        phoneNumber: input.customer?.phoneNumber ?? '',
        checkInAt,
        checkInRecordedAt: now,
        // The cashier is always taken from the authenticated session, never the client.
        checkInCashierId: new Types.ObjectId(actor.id),
        checkInCashierName: actor.name,
      });

      return { session: toPublicSession(session), created: true };
    } catch (err) {
      // Two syncs racing on the same ticket code: the loser reads back the winner's
      // session instead of failing, keeping the retry safe end to end.
      if ((err as { code?: number }).code === 11000) {
        const raced = await playSessionRepository.findByTicketCode(input.ticketCode);
        if (raced) return { session: toPublicSession(raced), created: false };
      }
      throw err;
    }
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
    return {
      session: toPublicSession(session),
      quote: quoteSession(session, asOf, {
        minimumBillableMinutes: resolveMinimumBillableMinutes(settings),
        maximumSessionHours: resolveMaximumSessionHours(settings),
      }),
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

    return {
      sessions: sessions.map((session) => ({
        session: toPublicSession(session),
        quote:
          session.status === PlaySessionStatus.ACTIVE
            ? quoteSession(session, asOf, quoteSettings)
            : null,
      })),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
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
