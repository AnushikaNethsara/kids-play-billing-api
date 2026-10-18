import { CustomerModel, type CustomerDocument, type CustomerHydrated } from './customer.model';
import type { CustomerSortField } from './customerSegments';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';
import { phoneSearchDigits } from '../../common/utils/phone';

export const customerRepository = {
  async findById(id: string): Promise<CustomerHydrated | null> {
    return CustomerModel.findById(id).exec();
  },

  async findByPhoneNumber(phoneNumber: string): Promise<CustomerHydrated | null> {
    return CustomerModel.findOne({ phoneNumber }).exec();
  },

  /** Finds the customer with this (normalised) number, creating an empty one if none. */
  async upsertByPhoneNumber(phoneNumber: string): Promise<CustomerHydrated | null> {
    return CustomerModel.findOneAndUpdate(
      { phoneNumber },
      { $setOnInsert: { phoneNumber, parentName: '', email: '', notes: '' } },
      { upsert: true, new: true },
    ).exec();
  },

  /** Writes the derived visit figures. Only `customerService.recomputeStats` calls this. */
  async setStats(
    id: string,
    stats: {
      visitCount: number;
      totalSpent: number;
      lastVisitAt: Date | null;
      firstVisitAt: Date | null;
    },
  ): Promise<void> {
    await CustomerModel.updateOne({ _id: id }, { $set: stats }).exec();
  },

  async create(data: {
    parentName: string;
    phoneNumber: string;
    email: string;
    notes: string;
  }): Promise<CustomerHydrated> {
    return CustomerModel.create(data);
  },

  /**
   * The admin's customer list. `conditions` are ready-made Mongo filters (segment, ranges)
   * combined with the free-text search. Sorted with `_id` as a tiebreaker so pages stay
   * stable when many families share a value, and customers who never visited sort after
   * the rest whichever way a visit date is sorted.
   */
  async list(
    filter: { search?: string; conditions: Record<string, unknown>[] },
    sort: { field: CustomerSortField; order: 'asc' | 'desc' },
    pagination: { page: number; limit: number },
  ): Promise<{ customers: CustomerHydrated[]; total: number }> {
    const and: Record<string, unknown>[] = [...filter.conditions];
    if (filter.search) {
      const escaped = escapeRegExp(filter.search);
      const phoneDigits = phoneSearchDigits(filter.search);
      and.push({
        $or: [
          { parentName: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
          // Phones are stored normalised, so "077 123" has to be matched as "77123".
          ...(phoneDigits ? [{ phoneNumber: { $regex: escapeRegExp(phoneDigits) } }] : []),
        ],
      });
    }
    const mongoFilter = and.length > 0 ? { $and: and } : {};
    const direction = sort.order === 'asc' ? 1 : -1;

    const [rows, total] = await Promise.all([
      CustomerModel.aggregate<CustomerDocument & { _id: unknown }>([
        { $match: mongoFilter },
        { $addFields: { _sortMissing: { $eq: [{ $ifNull: [`$${sort.field}`, null] }, null] } } },
        { $sort: { _sortMissing: 1, [sort.field]: direction, _id: direction } },
        { $skip: getSkip(pagination) },
        { $limit: pagination.limit },
        { $project: { _sortMissing: 0 } },
      ]).collation({ locale: 'en', strength: 2 }),
      CustomerModel.countDocuments(mongoFilter),
    ]);

    return { customers: rows.map((row) => CustomerModel.hydrate(row)), total };
  },

  /** How many customers match each filter, in one round trip. */
  async countEach(filters: Record<string, Record<string, unknown>>): Promise<Record<string, number>> {
    const facets = Object.fromEntries(
      Object.entries(filters).map(([key, match]) => [key, [{ $match: match }, { $count: 'n' }]]),
    );
    const [result] = await CustomerModel.aggregate<Record<string, { n: number }[]>>([
      { $facet: facets },
    ]);
    return Object.fromEntries(
      Object.keys(filters).map((key) => [key, result?.[key]?.[0]?.n ?? 0]),
    );
  },

  /** Search-as-you-type at the till: whatever has been typed so far, in any format. */
  async searchByPhoneNumber(phoneNumber: string): Promise<CustomerHydrated[]> {
    const digits = phoneSearchDigits(phoneNumber);
    if (!digits) return [];
    return CustomerModel.find({ phoneNumber: { $regex: escapeRegExp(digits) } })
      .sort({ lastVisitAt: -1 })
      .limit(10)
      .exec();
  },
};
