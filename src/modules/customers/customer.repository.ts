import { CustomerModel, type CustomerHydrated } from './customer.model';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';

export const customerRepository = {
  async findById(id: string): Promise<CustomerHydrated | null> {
    return CustomerModel.findById(id).exec();
  },

  async findByPhoneNumber(phoneNumber: string): Promise<CustomerHydrated | null> {
    return CustomerModel.findOne({ phoneNumber }).exec();
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
      mongoFilter.$or = [
        { parentName: { $regex: escaped, $options: 'i' } },
        { phoneNumber: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
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

  async searchByPhoneNumber(phoneNumber: string): Promise<CustomerHydrated[]> {
    return CustomerModel.find({ phoneNumber: { $regex: `^${escapeRegExp(phoneNumber)}` } })
      .limit(10)
      .exec();
  },
};
