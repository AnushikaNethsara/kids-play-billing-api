import bcrypt from 'bcryptjs';
import { userRepository } from './user.repository';
import type { UserHydrated } from './user.model';
import type { CreateUserInput, UpdateUserInput, ListUsersQuery, UserPublic } from './user.types';
import { DuplicateResourceError, NotFoundError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { AuthenticatedUser } from '../../common/types/express';

const BCRYPT_SALT_ROUNDS = 12;

function toPublicUser(user: UserHydrated): UserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const userService = {
  async createUser(input: CreateUserInput, actor: AuthenticatedUser): Promise<UserPublic> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new DuplicateResourceError('A user with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.USER_CREATED,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role },
    });

    return toPublicUser(user);
  },

  async listUsers(query: ListUsersQuery): Promise<{ users: UserPublic[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const { users, total } = await userRepository.list(
      { role: query.role, isActive: query.isActive, search: query.search },
      { page: query.page, limit: query.limit },
    );

    return {
      users: users.map(toPublicUser),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async getUserById(id: string): Promise<UserPublic> {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return toPublicUser(user);
  },

  async updateUser(id: string, input: UpdateUserInput, actor: AuthenticatedUser): Promise<UserPublic> {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');

    if (input.email && input.email !== user.email) {
      const existing = await userRepository.findByEmail(input.email);
      if (existing) throw new DuplicateResourceError('A user with this email already exists');
    }

    const before = { name: user.name, email: user.email };
    if (input.name !== undefined) user.name = input.name;
    if (input.email !== undefined) user.email = input.email;
    await user.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.USER_UPDATED,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      before,
      after: { name: user.name, email: user.email },
    });

    return toPublicUser(user);
  },

  async setUserStatus(id: string, isActive: boolean, actor: AuthenticatedUser): Promise<UserPublic> {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');

    const before = { isActive: user.isActive };
    user.isActive = isActive;
    await user.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      before,
      after: { isActive: user.isActive },
    });

    return toPublicUser(user);
  },

  async resetPassword(id: string, newPassword: string, actor: AuthenticatedUser): Promise<void> {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await user.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.USER_PASSWORD_RESET,
      entityType: AuditEntityType.USER,
      entityId: user.id,
    });
  },
};

export { toPublicUser };
