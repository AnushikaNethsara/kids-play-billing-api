import bcrypt from 'bcryptjs';
import { UserModel } from '../../src/modules/users/user.model';
import { PlayPackageModel } from '../../src/modules/play-packages/playPackage.model';
import { authService } from '../../src/modules/auth/auth.service';
import { UserRole } from '../../src/common/constants/roles';

const TEST_PASSWORD = 'TestPassword123!';

async function createUserWithToken(role: UserRole, emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

  const user = await UserModel.create({
    name: role === UserRole.ADMIN ? 'Test Admin' : 'Test Cashier',
    email,
    passwordHash,
    role,
  });

  const { tokens } = await authService.login(
    { email, password: TEST_PASSWORD },
    { userAgent: 'vitest', ipAddress: '127.0.0.1' },
  );

  return { user, accessToken: tokens.accessToken };
}

export async function createAdmin() {
  return createUserWithToken(UserRole.ADMIN, 'admin');
}

export async function createCashier() {
  return createUserWithToken(UserRole.CASHIER, 'cashier');
}

export async function createPlayPackage(overrides: Partial<{
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
}> = {}) {
  return PlayPackageModel.create({
    name: overrides.name ?? '1 Hour',
    durationMinutes: overrides.durationMinutes ?? 60,
    price: overrides.price ?? 80000,
    isActive: overrides.isActive ?? true,
    description: '',
    sortOrder: 0,
    createdBy: null,
    updatedBy: null,
  });
}
