import { beforeAll, afterEach, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// Must be set before any src module (in particular src/config/env.ts) is imported by a
// test file, since that module parses process.env once at import time. The actual test
// database connection below is made directly with mongoose, independent of
// MONGODB_URI/connectDatabase, so this value only needs to satisfy env validation.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/kids_play_area_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-do-not-use-in-production';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
process.env.BUSINESS_TIMEZONE ??= 'Asia/Colombo';
process.env.LOG_LEVEL ??= 'silent';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 60000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
