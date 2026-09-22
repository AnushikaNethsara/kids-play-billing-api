import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';
import { logger } from '../common/logger/logger';
import { env } from '../config/env';
import type { ErrorResponseBody } from '../common/utils/apiResponse';

/** MongoDB's unique-index violation, thrown by the driver as a MongoServerError. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route found for ${req.method} ${req.originalUrl}`,
    },
    requestId: String(req.id),
  };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId: req.id }, err.message);
    }

    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId: String(req.id),
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues,
      },
      requestId: String(req.id),
    };
    res.status(400).json(body);
    return;
  }

  // A duplicate-key error is a conflict, not a server fault the caller should retry.
  // Sent as a 500 it reads as transient, and an offline-first client will re-send the
  // same request forever against a condition no retry can clear. Logged at error level
  // regardless: reaching here means a uniqueness rule was hit that the code did not
  // check for, which is usually a bug or an index that no longer matches its schema.
  if (isDuplicateKeyError(err)) {
    logger.error({ err, requestId: req.id }, 'Duplicate key error');

    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message: 'A record with these details already exists',
        details: env.isProduction ? undefined : { message: (err as Error).message },
      },
      requestId: String(req.id),
    };
    res.status(409).json(body);
    return;
  }

  const error = err as Error;
  logger.error({ err: error, requestId: req.id }, 'Unhandled error');

  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.isProduction ? 'An unexpected error occurred' : error.message,
      details: env.isProduction ? undefined : { stack: error.stack },
    },
    requestId: String(req.id),
  };
  res.status(500).json(body);
}
