import bcrypt from 'bcryptjs';
import { UserModel } from '../../src/modules/users/user.model';
import { PlayPackageModel } from '../../src/modules/play-packages/playPackage.model';
import { ProductModel } from '../../src/modules/products/product.model';
import { SubscriptionPlanModel } from '../../src/modules/subscription-plans/subscriptionPlan.model';
import { authService } from '../../src/modules/auth/auth.service';
import { UserRole } from '../../src/common/constants/roles';
import { SessionPricingMode, type TieredPricing } from '../../src/common/constants/pricingModes';

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
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  tieredPricing: TieredPricing | null;
  isActive: boolean;
}> = {}) {
  return PlayPackageModel.create({
    name: overrides.name ?? '1 Hour',
    durationMinutes: overrides.durationMinutes ?? 60,
    price: overrides.price ?? 80000,
    pricingMode: overrides.pricingMode ?? SessionPricingMode.PRORATA,
    graceMinutes: overrides.graceMinutes ?? 0,
    tieredPricing: overrides.tieredPricing ?? null,
    isActive: overrides.isActive ?? true,
    description: '',
    sortOrder: 0,
    createdBy: null,
    updatedBy: null,
  });
}

export async function createSubscriptionPlan(overrides: Partial<{
  name: string;
  price: number;
  visitCredits: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  maxChildren: number | null;
  isActive: boolean;
}> = {}) {
  return SubscriptionPlanModel.create({
    name: overrides.name ?? 'Monthly 8 visits',
    price: overrides.price ?? 300_000,
    visitCredits: overrides.visitCredits ?? 8,
    visitMinutes: overrides.visitMinutes ?? 60,
    graceMinutes: overrides.graceMinutes ?? 10,
    extraBlockPrice: overrides.extraBlockPrice ?? 80_000,
    maxChildren: overrides.maxChildren ?? null,
    isActive: overrides.isActive ?? true,
    description: '',
    sortOrder: 0,
    createdBy: null,
    updatedBy: null,
  });
}

export async function createProduct(overrides: Partial<{
  name: string;
  price: number;
  isActive: boolean;
}> = {}) {
  return ProductModel.create({
    name: overrides.name ?? 'Long socks',
    price: overrides.price ?? 30000,
    isActive: overrides.isActive ?? true,
    description: '',
    sortOrder: 0,
    createdBy: null,
    updatedBy: null,
  });
}
