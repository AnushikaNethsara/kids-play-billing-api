import pinoHttp from 'pino-http';
import type { Request, Response } from 'express';
import { logger } from './logger';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request & { id?: string }).id,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} completed with ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} failed with ${res.statusCode}: ${err.message}`,
  serializers: {
    req(req: Request) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        userId: req.user?.id,
      };
    },
    res(res: Response) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/ready',
  },
});
