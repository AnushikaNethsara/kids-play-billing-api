import {
  SubscriptionPlanModel,
  type SubscriptionPlanDocument,
  type SubscriptionPlanHydrated,
} from './subscriptionPlan.model';
import { getSkip } from '../../common/utils/pagination';

export const subscriptionPlanRepository = {
  async findById(id: string): Promise<SubscriptionPlanHydrated | null> {
    return SubscriptionPlanModel.findById(id).exec();
  },

  async create(data: Partial<SubscriptionPlanDocument>): Promise<SubscriptionPlanHydrated> {
    return SubscriptionPlanModel.create({ ...data, updatedBy: data.createdBy });
  },

  async list(
    filter: { isActive?: boolean },
    pagination: { page: number; limit: number },
  ): Promise<{ plans: SubscriptionPlanHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.isActive !== undefined) mongoFilter.isActive = filter.isActive;

    const [plans, total] = await Promise.all([
      SubscriptionPlanModel.find(mongoFilter)
        .sort({ sortOrder: 1, price: 1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      SubscriptionPlanModel.countDocuments(mongoFilter),
    ]);

    return { plans, total };
  },

  async listAllActive(): Promise<SubscriptionPlanHydrated[]> {
    return SubscriptionPlanModel.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).exec();
  },
};
