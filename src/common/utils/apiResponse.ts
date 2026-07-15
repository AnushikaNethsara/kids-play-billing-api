import type { Response } from 'express';

export interface SuccessResponseBody<T> {
  success: true;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  options: { message?: string; statusCode?: number; meta?: Record<string, unknown> } = {},
): void {
  const { message, statusCode = 200, meta } = options;
  const body: SuccessResponseBody<T> = { success: true, data };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}
