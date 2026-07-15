import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';
import { logger } from '../common/logger/logger';
import { env } from '../config/env';
import type { ErrorResponseBody } from '../common/utils/apiResponse';

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
