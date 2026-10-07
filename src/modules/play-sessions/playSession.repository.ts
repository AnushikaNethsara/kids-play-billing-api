import { Types } from 'mongoose';
import {
  PlaySessionModel,
  type PlaySessionDocument,
  type PlaySessionExtraSubdocument,
  type PlaySessionHydrated,
} from './playSession.model';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';
import { phoneSearchDigits } from '../../common/utils/phone';
import { EXCLUDE_TEST_SESSIONS, SESSION_CHILD_NAMES } from '../../common/reporting/billFilters';
import type { ListPlaySessionsQuery } from './playSession.types';

const SORT_OPTIONS: Record<NonNullable<ListPlaySessionsQuery['sort']>, Record<string, 1 | -1>> = {
  newest: { checkInAt: -1 },
  oldest: { checkInAt: 1 },
};

export const playSessionRepository = {
  async create(data: Partial<PlaySessionDocument>): Promise<PlaySessionHydrated> {
    return PlaySessionModel.create(data);
  },

  async findById(id: string): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findById(id).exec();
  },

  async findByTicketCode(ticketCode: string): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOne({ ticketCode }).exec();
  },

  async findByBillId(billId: string): Promise<PlaySessionHydrated[]> {
    return PlaySessionModel.find({ billId: new Types.ObjectId(billId) }).exec();
  },

  /**
   * Atomic compare-and-set claiming an ACTIVE session for checkout, mirroring
   * billRepository.completeIfDraft. Two cashiers scanning the same slip at the same
   * moment race on this single update and only one can win, so a ticket can never be
   * billed twice - the same guarantee the bill completion path relies on.
   */
  async claimIfActive(
    ticketCode: string,
    update: {
      checkOutAt: Date;
      billedMinutes: number;
      /** Frozen in the same atomic write as billedMinutes, so the two can never disagree. */
      chargedAmount: number;
      checkOutCashierId: Types.ObjectId;
      checkOutCashierName: string;
    },
  ): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOneAndUpdate(
      { ticketCode, status: PlaySessionStatus.ACTIVE },
      { $set: { ...update, status: PlaySessionStatus.CLOSED } },
      { new: true },
    ).exec();
  },

  /**
   * Undoes claimIfActive. Used both to roll back a checkout that failed part-way through
   * and to reopen sessions when their bill is cancelled - in each case the children are
   * still in the play area, so the ticket must go back to being billable.
   */
  async reopen(sessionId: Types.ObjectId | string): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOneAndUpdate(
      { _id: sessionId, status: PlaySessionStatus.CLOSED },
      {
        $set: {
          status: PlaySessionStatus.ACTIVE,
          checkOutAt: null,
          billedMinutes: null,
          // Must be cleared with billedMinutes. The dashboard sums chargedAmount, so a
          // session left carrying one after its bill was cancelled would keep reporting
          // revenue that was reversed - and would double-count once it is billed again.
          chargedAmount: null,
          billId: null,
          checkOutCashierId: null,
          checkOutCashierName: null,
        },
      },
      { new: true },
    ).exec();
  },

  /**
   * Adds one extra, compare-and-set twice over: the session must still be ACTIVE (an
   * extra added after checkout would never be billed), and must not already carry this
   * `localId` (a retried sync must not sell the same pair twice). Null when either fails;
   * the caller reads the session back to tell which.
   */
  async addExtraIfActive(
    ticketCode: string,
    extra: PlaySessionExtraSubdocument,
  ): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOneAndUpdate(
      { ticketCode, status: PlaySessionStatus.ACTIVE, 'extras.localId': { $ne: extra.localId } },
      { $push: { extras: extra } },
      { new: true },
    ).exec();
  },

  /** Only while ACTIVE: once checked out, the extra is on a bill and stays there. */
  async removeExtraIfActive(ticketCode: string, localId: string): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOneAndUpdate(
      { ticketCode, status: PlaySessionStatus.ACTIVE, 'extras.localId': localId },
      { $pull: { extras: { localId } } },
      { new: true },
    ).exec();
  },

  async setBillId(sessionId: Types.ObjectId | string, billId: Types.ObjectId): Promise<void> {
    await PlaySessionModel.updateOne({ _id: sessionId }, { $set: { billId } }).exec();
  },

  /** Links the tickets a bill paid for to its customer, where the cashier did not pick one. */
  async setCustomerIdByBillId(billId: Types.ObjectId | string, customerId: string): Promise<void> {
    await PlaySessionModel.updateMany(
      { billId: new Types.ObjectId(billId), customerId: null },
      { $set: { customerId: new Types.ObjectId(customerId) } },
    ).exec();
  },

  /**
   * Propagates a bill's test flag to the sessions it billed. Called only from the bill
   * service - the session's copy of the flag is a denormalisation of the bill's, never an
   * independent decision.
   */
  async setTestFlagByBillId(billId: Types.ObjectId | string, isTestBill: boolean): Promise<number> {
    const result = await PlaySessionModel.updateMany(
      { billId: new Types.ObjectId(billId) },
      { $set: { isTestBill } },
    ).exec();
    return result.modifiedCount;
  },

  async voidIfActive(
    id: string,
    update: { voidedBy: Types.ObjectId; voidReason: string; voidedAt: Date },
  ): Promise<PlaySessionHydrated | null> {
    return PlaySessionModel.findOneAndUpdate(
      { _id: id, status: PlaySessionStatus.ACTIVE },
      { $set: { ...update, status: PlaySessionStatus.VOIDED } },
      { new: true },
    ).exec();
  },

  /**
   * Distinct child names checked in under this phone number, most recently seen first -
   * lets the cashier pick a returning child instead of retyping a name that's just going
   * to collide with itself under a different spelling. Keyed off `phoneNumber` rather
   * than `customerId`: the session always carries whatever number the cashier typed,
   * while `customerId` is only ever set when they explicitly picked a matched customer,
   * so it misses most of this same parent's earlier check-ins.
   */
  async findRecentChildrenByPhoneNumber(
    phoneNumber: string,
  ): Promise<{ childName: string; lastCheckInAt: Date }[]> {
    const rows = await PlaySessionModel.aggregate<{ childName: string; lastCheckInAt: Date }>([
      // A test check-in's child is usually made up, so it is not offered as a real one.
      { $match: { phoneNumber, ...EXCLUDE_TEST_SESSIONS } },
      // One row per child: a family ticket carries several names, and grouping its joined
      // display name would offer "Amal, Nimal, Sara" as a single child to pick.
      {
        $project: {
          checkInAt: 1,
          name: SESSION_CHILD_NAMES,
        },
      },
      { $unwind: '$name' },
      { $sort: { checkInAt: -1 } },
      { $group: { _id: '$name', lastCheckInAt: { $first: '$checkInAt' } } },
      { $sort: { lastCheckInAt: -1 } },
      { $project: { _id: 0, childName: '$_id', lastCheckInAt: 1 } },
    ]).exec();
    return rows;
  },

  async list(filter: ListPlaySessionsQuery): Promise<{ sessions: PlaySessionHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};

    if (filter.status) mongoFilter.status = filter.status;
    if (filter.phoneNumber) {
      // Stored normalised; matched on the digits typed, wherever they fall in the number.
      mongoFilter.phoneNumber = { $regex: escapeRegExp(phoneSearchDigits(filter.phoneNumber)) };
    }
    if (filter.childName) {
      mongoFilter.childName = { $regex: escapeRegExp(filter.childName), $options: 'i' };
    }
    if (filter.from || filter.to) {
      const checkInAt: Record<string, Date> = {};
      if (filter.from) checkInAt.$gte = new Date(filter.from);
      if (filter.to) checkInAt.$lte = new Date(filter.to);
      mongoFilter.checkInAt = checkInAt;
    }

    const [sessions, total] = await Promise.all([
      PlaySessionModel.find(mongoFilter)
        .sort(SORT_OPTIONS[filter.sort ?? 'newest'])
        .skip(getSkip(filter))
        .limit(filter.limit)
        .exec(),
      PlaySessionModel.countDocuments(mongoFilter),
    ]);

    return { sessions, total };
  },
};
