import { CustomerModel, type CustomerHydrated } from './customer.model';
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
    stats: { visitCount: number; totalSpent: number; lastVisitAt: Date | null },
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

  async list(
    filter: { search?: string },
    pagination: { page: number; limit: number },
  ): Promise<{ customers: CustomerHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.search) {
      const escaped = escapeRegExp(filter.search);
      const phoneDigits = phoneSearchDigits(filter.search);
      mongoFilter.$or = [
        { parentName: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        // Phones are stored normalised, so "077 123" has to be matched as "77123".
        ...(phoneDigits ? [{ phoneNumber: { $regex: escapeRegExp(phoneDigits) } }] : []),
      ];
    }

    const [customers, total] = await Promise.all([
      CustomerModel.find(mongoFilter)
        .sort({ createdAt: -1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      CustomerModel.countDocuments(mongoFilter),
    ]);

    return { customers, total };
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
