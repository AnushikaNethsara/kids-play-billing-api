import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.header(REQUEST_ID_HEADER);
  req.id = incomingId && incomingId.length > 0 ? incomingId : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
