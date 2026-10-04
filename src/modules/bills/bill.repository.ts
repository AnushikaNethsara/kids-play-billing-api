import { BillModel, type BillHydrated, type BillDocument } from './bill.model';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';
import type { ListBillsQuery } from './bill.types';
import { BillStatus } from '../../common/constants/billStatus';
import { BillItemKind } from '../../common/constants/billItemKind';

const SORT_OPTIONS: Record<NonNullable<ListBillsQuery['sort']>, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  total_desc: { grandTotal: -1 },
  total_asc: { grandTotal: 1 },
};

export const billRepository = {
  async create(data: Partial<BillDocument>): Promise<BillHydrated> {
    return BillModel.create(data);
  },

  async findById(id: string): Promise<BillHydrated | null> {
    return BillModel.findById(id).exec();
  },

  async findByBillNumber(billNumber: string): Promise<BillHydrated | null> {
    return BillModel.findOne({ billNumber }).exec();
  },

  /**
   * Atomic compare-and-set: only transitions a bill from DRAFT to PAID if it is still
   * DRAFT at the moment of the update. This is what makes double-completion impossible
   * even without the Idempotency-Key header, since concurrent requests race on the same
   * atomic findOneAndUpdate and only one can match the { status: DRAFT } filter.
   */
  async completeIfDraft(id: string, update: Partial<BillDocument>): Promise<BillHydrated | null> {
    return BillModel.findOneAndUpdate({ _id: id, status: BillStatus.DRAFT }, { $set: update }, { new: true }).exec();
  },

  /** Same compare-and-set pattern as completeIfDraft, applied to cancel/refund transitions. */
  async transitionIfStatusIn(
    id: string,
    allowedStatuses: BillStatus[],
    update: Partial<BillDocument>,
  ): Promise<BillHydrated | null> {
    return BillModel.findOneAndUpdate(
      { _id: id, status: { $in: allowedStatuses } },
      { $set: update },
      { new: true },
    ).exec();
  },

  /**
   * Compare-and-set on "no longer a draft", the same pattern as completeIfDraft. The rule
   * that a bill may only be marked as a test after it has been checked out is enforced
   * here rather than only in the service, so a draft that is completed in the gap between
   * the service's read and its write cannot end up flagged while it was still open.
   */
  async setTestFlagIfSettled(id: string, update: Partial<BillDocument>): Promise<BillHydrated | null> {
    return BillModel.findOneAndUpdate(
      { _id: id, status: { $ne: BillStatus.DRAFT } },
      { $set: update },
      { new: true },
    ).exec();
  },

  async list(
    filter: ListBillsQuery,
  ): Promise<{ bills: BillHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};

    if (filter.billNumber) {
      mongoFilter.billNumber = { $regex: escapeRegExp(filter.billNumber), $options: 'i' };
    }
    if (filter.parentName) {
      mongoFilter.parentName = { $regex: escapeRegExp(filter.parentName), $options: 'i' };
    }
    if (filter.phoneNumber) {
      mongoFilter.phoneNumber = { $regex: escapeRegExp(filter.phoneNumber), $options: 'i' };
    }
    if (filter.cashierId) mongoFilter.cashierId = filter.cashierId;
    if (filter.status) mongoFilter.status = filter.status;
    if (filter.paymentMethod) mongoFilter.paymentMethod = filter.paymentMethod;
    if (filter.from || filter.to) {
      const createdAt: Record<string, Date> = {};
      if (filter.from) createdAt.$gte = new Date(filter.from);
      if (filter.to) createdAt.$lte = new Date(filter.to);
      mongoFilter.createdAt = createdAt;
    }
    const itemConditions: Record<string, unknown>[] = [];
    if (filter.isTimed !== undefined) {
      // A timed bill is one with any session line. Matched per element because a checkout
      // also carries product lines (socks sold onto the visit), which have no session - a
      // plain `items.playSessionId: { $ne: null }` would require every line to have one.
      const hasSessionLine = { items: { $elemMatch: { playSessionId: { $ne: null } } } };
      itemConditions.push(filter.isTimed ? hasSessionLine : { $nor: [hasSessionLine] });
    }
    if (filter.kind) {
      // Lines written before kinds existed carry no `kind` and are all PLAY lines.
      itemConditions.push({
        items: {
          $elemMatch: {
            kind: filter.kind === BillItemKind.PLAY ? { $in: [BillItemKind.PLAY, null] } : filter.kind,
          },
        },
      });
    }
    if (itemConditions.length > 0) mongoFilter.$and = itemConditions;
    if (filter.isTestBill !== undefined) {
      // `$ne: true` rather than `false`: every bill written before this flag existed has
      // no such field at all, and matching on `false` would silently hide all of them.
      mongoFilter.isTestBill = filter.isTestBill ? true : { $ne: true };
    }
    if (filter.minTotal !== undefined || filter.maxTotal !== undefined) {
      const grandTotal: Record<string, number> = {};
      if (filter.minTotal !== undefined) grandTotal.$gte = filter.minTotal;
      if (filter.maxTotal !== undefined) grandTotal.$lte = filter.maxTotal;
      mongoFilter.grandTotal = grandTotal;
    }

    const sort = SORT_OPTIONS[filter.sort ?? 'newest'];

    const [bills, total] = await Promise.all([
      BillModel.find(mongoFilter)
        .sort(sort)
        .skip(getSkip(filter))
        .limit(filter.limit)
        .exec(),
      BillModel.countDocuments(mongoFilter),
    ]);

    return { bills, total };
  },

};
