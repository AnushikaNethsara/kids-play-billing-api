import { PlayPackageModel, type PlayPackageHydrated } from './playPackage.model';
import { getSkip } from '../../common/utils/pagination';

export const playPackageRepository = {
  async findById(id: string): Promise<PlayPackageHydrated | null> {
    return PlayPackageModel.findById(id).exec();
  },

  async create(data: {
    name: string;
    durationMinutes: number;
    price: number;
    description: string;
    sortOrder: number;
    createdBy: string;
  }): Promise<PlayPackageHydrated> {
    return PlayPackageModel.create({ ...data, updatedBy: data.createdBy });
  },

  async list(
    filter: { isActive?: boolean },
    pagination: { page: number; limit: number },
  ): Promise<{ packages: PlayPackageHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.isActive !== undefined) mongoFilter.isActive = filter.isActive;

    const [packages, total] = await Promise.all([
      PlayPackageModel.find(mongoFilter)
        .sort({ sortOrder: 1, durationMinutes: 1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      PlayPackageModel.countDocuments(mongoFilter),
    ]);

    return { packages, total };
  },

  async listAllActive(): Promise<PlayPackageHydrated[]> {
    return PlayPackageModel.find({ isActive: true }).sort({ sortOrder: 1, durationMinutes: 1 }).exec();
  },
};
