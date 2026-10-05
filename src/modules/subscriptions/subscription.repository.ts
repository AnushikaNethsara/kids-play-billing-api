import { Types } from 'mongoose';
import {
  SubscriptionModel,
  type SubscriptionChildSubdocument,
  type SubscriptionDocument,
  type SubscriptionHydrated,
} from './subscription.model';
import {
  SubscriptionLedgerModel,
  type SubscriptionLedgerDocument,
  type SubscriptionLedgerHydrated,
} from './subscriptionLedger.model';
import { SubscriptionStatus } from './subscriptionRules';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';
import { phoneSearchDigits } from '../../common/utils/phone';
import type { ListSubscriptionsQuery } from './subscription.types';

export const subscriptionRepository = {
  async create(data: Partial<SubscriptionDocument>): Promise<SubscriptionHydrated> {
    return SubscriptionModel.create(data);
  },

  async findById(id: Types.ObjectId | string): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findById(id).exec();
  },

  async findByCode(code: string): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findOne({ code }).exec();
  },

  async findBySaleBillId(billId: Types.ObjectId | string): Promise<SubscriptionHydrated[]> {
    return SubscriptionModel.find({ saleBillId: new Types.ObjectId(billId) }).sort({ saleLineIndex: 1 }).exec();
  },

  async findBySaleLine(
    billId: Types.ObjectId | string,
    saleLineIndex: number,
  ): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findOne({ saleBillId: new Types.ObjectId(billId), saleLineIndex }).exec();
  },

  async findByIds(ids: (Types.ObjectId | string)[]): Promise<SubscriptionHydrated[]> {
    if (ids.length === 0) return [];
    return SubscriptionModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).exec();
  },

  async list(
    filter: ListSubscriptionsQuery,
    now: Date,
  ): Promise<{ subscriptions: SubscriptionHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};

    if (filter.phoneNumber) {
      mongoFilter.phoneNumber = { $regex: escapeRegExp(phoneSearchDigits(filter.phoneNumber)) };
    }
    if (filter.customerId) mongoFilter.customerId = new Types.ObjectId(filter.customerId);
    if (filter.code) mongoFilter.code = filter.code.trim().toUpperCase();

    // The derived statuses, expressed as the same comparisons resolveSubscriptionStatus makes.
    switch (filter.status) {
      case 'CANCELLED':
        mongoFilter.status = SubscriptionStatus.CANCELLED;
        break;
      case 'EXPIRED':
        mongoFilter.status = SubscriptionStatus.ACTIVE;
        mongoFilter.expiresAt = { $lte: now };
        break;
      case 'EXHAUSTED':
        mongoFilter.status = SubscriptionStatus.ACTIVE;
        mongoFilter.expiresAt = { $gt: now };
        mongoFilter.$expr = { $gte: ['$creditsUsed', '$creditsTotal'] };
        break;
      case 'ACTIVE':
        mongoFilter.status = SubscriptionStatus.ACTIVE;
        mongoFilter.expiresAt = { $gt: now };
        mongoFilter.$expr = { $lt: ['$creditsUsed', '$creditsTotal'] };
        break;
      default:
        break;
    }

    if (filter.expiringWithinDays !== undefined) {
      const until = new Date(now.getTime() + filter.expiringWithinDays * 24 * 60 * 60_000);
      mongoFilter.status = SubscriptionStatus.ACTIVE;
      mongoFilter.expiresAt = { $gt: now, $lte: until };
    }

    const sort: Record<string, 1 | -1> =
      filter.expiringWithinDays !== undefined ? { expiresAt: 1 } : { createdAt: -1 };

    const [subscriptions, total] = await Promise.all([
      SubscriptionModel.find(mongoFilter).sort(sort).skip(getSkip(filter)).limit(filter.limit).exec(),
      SubscriptionModel.countDocuments(mongoFilter),
    ]);
    return { subscriptions, total };
  },

  /** Every subscription a family can still check in with, for the cashier app's cache. */
  async listUsable(now: Date): Promise<SubscriptionHydrated[]> {
    return SubscriptionModel.find({
      status: SubscriptionStatus.ACTIVE,
      expiresAt: { $gt: now },
      $expr: { $lt: ['$creditsUsed', '$creditsTotal'] },
    })
      .sort({ expiresAt: 1 })
      .exec();
  },

  /** A family's subscriptions that have not expired, soonest expiry first. */
  async listUnexpiredForCustomer(customerId: string, now: Date): Promise<SubscriptionHydrated[]> {
    return SubscriptionModel.find({
      customerId: new Types.ObjectId(customerId),
      status: SubscriptionStatus.ACTIVE,
      expiresAt: { $gt: now },
    })
      .sort({ expiresAt: 1 })
      .exec();
  },

  /**
   * Takes `credits` off the balance, compare-and-set. Every condition a reservation has to
   * meet is in the filter of one atomic update, so two cashiers reaching for the last credit
   * at the same moment cannot both have it - the loser gets null. `validAt` is the moment
   * the credit is for: the check-in time, never the server's clock, so a visit that began
   * before expiry still finishes on the subscription.
   */
  async reserveCredits(
    id: Types.ObjectId | string,
    credits: number,
    validAt: Date,
  ): Promise<SubscriptionHydrated | null> {
    if (credits <= 0) return SubscriptionModel.findById(id).exec();
    return SubscriptionModel.findOneAndUpdate(
      {
        _id: id,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { $gt: validAt },
        $expr: { $lte: [{ $add: ['$creditsUsed', credits] }, '$creditsTotal'] },
      },
      { $inc: { creditsUsed: credits } },
      { new: true },
    ).exec();
  },

  /**
   * Gives credits back. Deliberately not conditional on status or expiry: credits taken in
   * error belong to the family whatever has happened to the subscription since. Guarded so
   * the counter can never go below zero.
   */
  async releaseCredits(id: Types.ObjectId | string, credits: number): Promise<SubscriptionHydrated | null> {
    if (credits <= 0) return SubscriptionModel.findById(id).exec();
    return SubscriptionModel.findOneAndUpdate(
      { _id: id, creditsUsed: { $gte: credits } },
      { $inc: { creditsUsed: -credits } },
      { new: true },
    ).exec();
  },

  /** An admin granting (positive) or removing (negative) credits. Never below what is used. */
  async adjustTotal(id: string, delta: number): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findOneAndUpdate(
      {
        _id: id,
        $expr: { $gte: [{ $add: ['$creditsTotal', delta] }, '$creditsUsed'] },
      },
      { $inc: { creditsTotal: delta } },
      { new: true },
    ).exec();
  },

  async setExpiresAt(id: string, expiresAt: Date): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findByIdAndUpdate(id, { $set: { expiresAt } }, { new: true }).exec();
  },

  async setChildren(id: string, children: SubscriptionChildSubdocument[]): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findByIdAndUpdate(id, { $set: { children } }, { new: true }).exec();
  },

  /** Cancels only while nothing has been used, compare-and-set like every other transition. */
  async cancelIfUnused(
    id: Types.ObjectId | string,
    update: { cancelledAt: Date; cancelledBy: Types.ObjectId; cancelReason: string },
  ): Promise<SubscriptionHydrated | null> {
    return SubscriptionModel.findOneAndUpdate(
      { _id: id, status: SubscriptionStatus.ACTIVE, creditsUsed: 0 },
      { $set: { ...update, status: SubscriptionStatus.CANCELLED } },
      { new: true },
    ).exec();
  },

  /** Undoes cancelIfUnused when a later step of the same cancellation fails. */
  async uncancel(id: Types.ObjectId | string): Promise<void> {
    await SubscriptionModel.updateOne(
      { _id: id, status: SubscriptionStatus.CANCELLED },
      { $set: { status: SubscriptionStatus.ACTIVE, cancelledAt: null, cancelledBy: null, cancelReason: null } },
    ).exec();
  },

  /** Follows a customer merge: the duplicate's subscriptions belong to the survivor. */
  async repointCustomer(fromCustomerId: string, toCustomerId: string): Promise<number> {
    const result = await SubscriptionModel.updateMany(
      { customerId: new Types.ObjectId(fromCustomerId) },
      { $set: { customerId: new Types.ObjectId(toCustomerId) } },
    ).exec();
    return result.modifiedCount;
  },

  async addLedgerEntry(entry: Omit<SubscriptionLedgerDocument, 'at'> & { at?: Date }): Promise<void> {
    await SubscriptionLedgerModel.create({ ...entry, at: entry.at ?? new Date() });
  },

  async listLedger(subscriptionId: string): Promise<SubscriptionLedgerHydrated[]> {
    return SubscriptionLedgerModel.find({ subscriptionId: new Types.ObjectId(subscriptionId) })
      .sort({ at: -1 })
      .limit(500)
      .exec();
  },

  /** Sum of every ledger delta - what the counters must agree with. */
  async ledgerBalanceDelta(subscriptionId: Types.ObjectId | string): Promise<number> {
    const [row] = await SubscriptionLedgerModel.aggregate<{ total: number }>([
      { $match: { subscriptionId: new Types.ObjectId(subscriptionId) } },
      { $group: { _id: null, total: { $sum: '$delta' } } },
    ]).exec();
    return row?.total ?? 0;
  },
};
