import { UserModel, type UserHydrated } from './user.model';
import type { UserRole } from '../../common/constants/roles';
import { getSkip } from '../../common/utils/pagination';
import { escapeRegExp } from '../../common/utils/regex';

export interface FindUsersFilter {
  role?: UserRole;
  isActive?: boolean;
  search?: string;
}

export const userRepository = {
  async findByEmail(email: string, withPasswordHash = false): Promise<UserHydrated | null> {
    const query = UserModel.findOne({ email: email.toLowerCase() });
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  },

  async findById(id: string, withPasswordHash = false): Promise<UserHydrated | null> {
    const query = UserModel.findById(id);
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  },

  async create(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
  }): Promise<UserHydrated> {
    return UserModel.create(data);
  },

  async updateById(id: string, update: Partial<UserHydrated>): Promise<UserHydrated | null> {
    return UserModel.findByIdAndUpdate(id, update, { new: true }).exec();
  },

  async list(
    filter: FindUsersFilter,
    pagination: { page: number; limit: number },
  ): Promise<{ users: UserHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.role) mongoFilter.role = filter.role;
    if (filter.isActive !== undefined) mongoFilter.isActive = filter.isActive;
    if (filter.search) {
      const escaped = escapeRegExp(filter.search);
      mongoFilter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      UserModel.find(mongoFilter)
        .sort({ createdAt: -1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      UserModel.countDocuments(mongoFilter),
    ]);

    return { users, total };
  },
};
