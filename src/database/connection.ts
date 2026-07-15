import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../common/logger/logger';

const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 10;

mongoose.set('strictQuery', true);

let connectionAttempt = 0;

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connection established');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  return attemptConnect();
}

async function attemptConnect(): Promise<typeof mongoose> {
  try {
    connectionAttempt += 1;
    const connection = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    connectionAttempt = 0;
    return connection;
  } catch (err) {
    if (connectionAttempt >= MAX_RETRIES) {
      logger.error({ err }, 'MongoDB connection failed after maximum retries');
      throw err;
    }

    logger.warn(
      { attempt: connectionAttempt, maxRetries: MAX_RETRIES },
      `MongoDB connection failed, retrying in ${RETRY_DELAY_MS}ms`,
    );

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return attemptConnect();
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
