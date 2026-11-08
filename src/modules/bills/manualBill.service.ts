import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { billService, toPublicBill } from './bill.service';
import { BillEntrySource, BillModel } from './bill.model';
import type { BillPublic, CreateManualBillInput } from './bill.types';
import { playSessionService } from '../play-sessions/playSession.service';
import { PlaySessionModel } from '../play-sessions/playSession.model';
import type { PlaySessionPublic } from '../play-sessions/playSession.types';
import { userRepository } from '../users/user.repository';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { BillStatus } from '../../common/constants/billStatus';
import { UserRole } from '../../common/constants/roles';
import { AuthorizationError, PaymentError, ValidationError } from '../../common/errors';
import type { AuthenticatedUser } from '../../common/types/express';
import { formatMoney } from '../../common/utils/money';

/** One visit is a day at most; anything longer is a typo in the date. */
const MAX_VISIT_MS = 24 * 60 * 60_000;

function parseTime(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${label} is not a valid date`);
  return date;
}

/**
 * Removes what a failed manual entry created. Everything here was made by this same
 * request a moment ago and was never printed or shown to anyone, so it is deleted rather
 * than voided or cancelled - a voided ticket or a cancelled bill would land on the
 * exceptions report and in the day's cancelled count for a bill that never existed.
 */
async function discard(sessions: PlaySessionPublic[], draftId: string | null): Promise<void> {
  try {
    if (draftId) await BillModel.deleteOne({ _id: draftId, status: BillStatus.DRAFT });
    if (sessions.length > 0) {
      await PlaySessionModel.deleteMany({
        _id: { $in: sessions.map((session) => new Types.ObjectId(session.id)) },
        entrySource: BillEntrySource.MANUAL,
        // Never a ticket on a bill that did get paid.
        $or: [{ billId: null }, ...(draftId ? [{ billId: new Types.ObjectId(draftId) }] : [])],
      });
    }
  } catch {
    // A failed clean-up must not mask the original error.
  }
}

export const manualBillService = {
  /**
   * Back-enters a play bill that the till missed and the cashier wrote on paper.
   *
   * It runs the ordinary three steps - check in, check out, pay - in one request, so the
   * pricing (pro-rata, block, tiered, best price, family tickets, extras, multi-child
   * discount) is exactly the till's. The tickets are checked in at the book's times, and
   * the payment is dated to the book's check-out time, so the bill number, the revenue day
   * and the daily close are all the day it really happened. Nothing half-made is left
   * behind if any step fails.
   *
   * Prices are today's package prices: a package's price on the visit day is not kept
   * anywhere. The admin can add a discount when the book shows less.
   */
  async create(input: CreateManualBillInput, actor: AuthenticatedUser): Promise<BillPublic> {
    if (actor.role !== UserRole.ADMIN) {
      throw new AuthorizationError('Only an admin can enter a bill from a paper record');
    }

    const now = new Date();
    const checkOutAt = parseTime(input.checkOutAt, 'Check-out time');
    if (checkOutAt.getTime() > now.getTime()) {
      throw new ValidationError('Check-out time cannot be in the future');
    }
    for (const ticket of input.tickets) {
      const checkInAt = parseTime(ticket.checkInAt, 'Check-in time');
      if (checkInAt.getTime() >= checkOutAt.getTime()) {
        throw new ValidationError('Check-out time must be after every check-in time');
      }
      if (checkOutAt.getTime() - checkInAt.getTime() > MAX_VISIT_MS) {
        throw new ValidationError('A visit cannot be longer than 24 hours - please check the dates');
      }
    }

    // Who took the money at the till. The admin is the one entering it, which the bill
    // records separately in paymentRecordedBy.
    let cashier = { id: actor.id, name: actor.name };
    if (input.cashierId && input.cashierId !== actor.id) {
      const user = await userRepository.findById(input.cashierId);
      if (!user) throw new ValidationError('The selected cashier does not exist');
      cashier = { id: user.id, name: user.name };
    }

    const sessions: PlaySessionPublic[] = [];
    let draftId: string | null = null;
    // Once paid, the bill is real: a later failure must never discard it.
    let paidId: string | null = null;

    try {
      for (const ticket of input.tickets) {
        const { session } = await playSessionService.checkIn(
          {
            ticketCode: `MANUAL-${randomUUID()}`,
            childNames: ticket.childNames,
            playPackageId: ticket.playPackageId,
            checkInAt: ticket.checkInAt,
            customer: input.customer,
            extras: (ticket.extras ?? []).map((extra) => ({
              localId: `MANUAL-${randomUUID()}`,
              productId: extra.productId,
              quantity: extra.quantity,
            })),
          },
          actor,
          { allowPastCheckIn: true, entrySource: BillEntrySource.MANUAL },
        );
        sessions.push(session);
      }

      const draft = await billService.createDraftFromSessions(
        {
          ticketCodes: sessions.map((session) => session.ticketCode),
          checkOutAt: checkOutAt.toISOString(),
          discount: input.discount,
          customer: input.customer,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
        },
        actor,
        { manualEntry: true },
      );
      draftId = draft.id;

      if (input.paidAmount !== undefined && input.paidAmount < draft.grandTotal) {
        throw new PaymentError(
          `Amount received is less than the bill total of ${formatMoney(draft.grandTotal)}. Add a discount if the book shows less.`,
        );
      }

      // Marked before payment, so the payment's own audit entry names the real cashier.
      await BillModel.updateOne(
        { _id: draft.id, status: BillStatus.DRAFT },
        {
          $set: {
            entrySource: BillEntrySource.MANUAL,
            manualEntryReason: input.reason,
            manualEntryReference: input.reference ?? null,
            cashierId: new Types.ObjectId(cashier.id),
            cashierName: cashier.name,
          },
        },
      );
      await PlaySessionModel.updateMany(
        { _id: { $in: sessions.map((session) => new Types.ObjectId(session.id)) } },
        {
          $set: {
            checkInCashierId: new Types.ObjectId(cashier.id),
            checkInCashierName: cashier.name,
            checkOutCashierId: new Types.ObjectId(cashier.id),
            checkOutCashierName: cashier.name,
          },
        },
      );

      const paid = await billService.completeBill(
        draft.id,
        { paymentMethod: input.paymentMethod, paidAmount: input.paidAmount, backdateToCheckout: true },
        actor,
      );
      paidId = paid.id;

      await auditLogService.record({
        userId: actor.id,
        userName: actor.name,
        action: AuditAction.BILL_MANUAL_ENTRY,
        entityType: AuditEntityType.BILL,
        entityId: paid.id,
        after: paid,
        metadata: {
          reason: input.reason,
          reference: input.reference ?? null,
          cashierId: cashier.id,
          cashierName: cashier.name,
          ticketCodes: sessions.map((session) => session.ticketCode),
          checkInTimes: input.tickets.map((ticket) => ticket.checkInAt),
          checkOutAt: checkOutAt.toISOString(),
          grandTotal: paid.grandTotal,
          paidAt: paid.paidAt,
        },
      });

      return toPublicBill(await billService.getById(paid.id));
    } catch (err) {
      if (!paidId) await discard(sessions, draftId);
      throw err;
    }
  },
};
