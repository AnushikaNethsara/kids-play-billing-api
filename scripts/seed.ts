import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { UserModel } from '../src/modules/users/user.model';
import { PlayPackageModel } from '../src/modules/play-packages/playPackage.model';
import { settingsRepository } from '../src/modules/settings/settings.repository';
import { UserRole } from '../src/common/constants/roles';
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
  for (const pkg of SEED_PACKAGES) {
    const existing = await PlayPackageModel.findOne({ name: pkg.name });
    if (existing) {
      logger.info(`Play package "${pkg.name}" already exists, skipping`);
      continue;
    }

    await PlayPackageModel.create({ ...pkg, description: '', createdBy: null, updatedBy: null });
    logger.info(`Created play package: ${pkg.name}`);
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
