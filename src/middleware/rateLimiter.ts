import rateLimit from 'express-rate-limit';
import { RateLimitError } from '../common/errors';
import { env } from '../config';

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  // The whole test suite runs in one process from one address, so it shares a single
  // budget - which it outgrew. Nothing asserts on this limiter; the login limiter, which
  // tests do exercise, stays on.
  skip: () => env.isTest,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new RateLimitError()),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new RateLimitError('Too many authentication attempts, please try again later')),
});
