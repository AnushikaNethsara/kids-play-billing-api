import type { UserRole } from '../../common/constants/roles';

export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

export interface ListUsersQuery {
  page: number;
  limit: number;
  role?: UserRole;
  isActive?: boolean;
  search?: string;
}
