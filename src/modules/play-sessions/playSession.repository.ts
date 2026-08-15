import { Types } from 'mongoose';
import { PlaySessionModel, type PlaySessionDocument, type PlaySessionHydrated } from './playSession.model';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';
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
          billId: null,
          checkOutCashierId: null,
          checkOutCashierName: null,
        },
      },
      { new: true },
    ).exec();
  },

  async setBillId(sessionId: Types.ObjectId | string, billId: Types.ObjectId): Promise<void> {
    await PlaySessionModel.updateOne({ _id: sessionId }, { $set: { billId } }).exec();
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

  async list(filter: ListPlaySessionsQuery): Promise<{ sessions: PlaySessionHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};

    if (filter.status) mongoFilter.status = filter.status;
    if (filter.phoneNumber) {
      mongoFilter.phoneNumber = { $regex: escapeRegExp(filter.phoneNumber), $options: 'i' };
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
