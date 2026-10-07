import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { UserModel } from '../src/modules/users/user.model';
import { PlayPackageModel } from '../src/modules/play-packages/playPackage.model';
import { ProductModel } from '../src/modules/products/product.model';
import { settingsRepository } from '../src/modules/settings/settings.repository';
import { UserRole } from '../src/common/constants/roles';
import {
  OvertimeMode,
  RoundingMode,
  SessionPricingMode,
} from '../src/common/constants/pricingModes';
import { env } from '../src/config';
import { logger } from '../src/common/logger/logger';

const BCRYPT_SALT_ROUNDS = 12;
const SEEDED_PASSWORD = 'ChangeMe123!';

const SEED_USERS = [
  { name: 'System Admin', email: 'admin@example.com', role: UserRole.ADMIN },
  { name: 'Cashier 01', email: 'cashier@example.com', role: UserRole.CASHIER },
];

const SEED_PACKAGES = [
  { name: '30 Minutes', durationMinutes: 30, price: 50000, sortOrder: 1 },
  { name: '1 Hour', durationMinutes: 60, price: 80000, sortOrder: 2 },
  { name: '2 Hours', durationMinutes: 120, price: 140000, sortOrder: 3 },
];

// Seeded only when tiered packages are enabled, for the same reason the API refuses to
// create one otherwise: older cashier builds cannot show its running total.
const TIERED_SEED_PACKAGE = {
  name: 'Tiered Hourly',
  durationMinutes: 60,
  price: 60000,
  pricingMode: SessionPricingMode.TIERED_HOURLY,
  graceMinutes: 10,
  tieredPricing: {
    hourlyRates: [60000, 50000, 40000, 40000],
    overtimeMode: OvertimeMode.PER_MINUTE,
    overtimeBlockMinutes: 15,
    roundingStep: 0,
    roundingMode: RoundingMode.NEAREST,
  },
  sortOrder: 4,
};

async function seedUsers() {
  const passwordHash = await bcrypt.hash(SEEDED_PASSWORD, BCRYPT_SALT_ROUNDS);

  for (const user of SEED_USERS) {
    const existing = await UserModel.findOne({ email: user.email });
    if (existing) {
      logger.info(`User ${user.email} already exists, skipping`);
      continue;
    }

    await UserModel.create({ ...user, passwordHash });
    logger.info(`Created ${user.role} user: ${user.email}`);
  }
}

async function seedPlayPackages() {
  const packages = env.tieredPricingEnabled ? [...SEED_PACKAGES, TIERED_SEED_PACKAGE] : SEED_PACKAGES;
  for (const pkg of packages) {
    const existing = await PlayPackageModel.findOne({ name: pkg.name });
    if (existing) {
      logger.info(`Play package "${pkg.name}" already exists, skipping`);
      continue;
    }

    await PlayPackageModel.create({ ...pkg, description: '', createdBy: null, updatedBy: null });
    logger.info(`Created play package: ${pkg.name}`);
  }
}

// Placeholder prices - an admin sets the real ones from the Products page.
const SEED_PRODUCTS = [
  { name: 'Long socks', price: 30000, sortOrder: 1 },
  { name: 'Half socks', price: 20000, sortOrder: 2 },
];

async function seedProducts() {
  for (const product of SEED_PRODUCTS) {
    const existing = await ProductModel.findOne({ name: product.name });
    if (existing) {
      logger.info(`Product "${product.name}" already exists, skipping`);
      continue;
    }

    await ProductModel.create({ ...product, description: '', createdBy: null, updatedBy: null });
    logger.info(`Created product: ${product.name}`);
  }
}

async function seedSettings() {
  await settingsRepository.getOrCreate();
  logger.info('Ensured default business settings exist');
}

async function run() {
  await connectDatabase();

  await seedUsers();
  await seedPlayPackages();
  await seedProducts();
  await seedSettings();

  logger.warn(
    `Seeded accounts use the password "${SEEDED_PASSWORD}" - change these immediately in any ` +
      'environment other than local development.',
  );

  await disconnectDatabase();
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'Seed script failed');
  process.exit(1);
});
