import cors from 'cors';
import type { CorsOptions } from 'cors';
import { env } from '../config/env';

/**
 * React Native apps typically do not send an Origin header, so they are unaffected by
 * this allowlist. This is configured for browser-based clients (the Next.js admin app,
 * local and deployed).
 */
export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
};

export const corsMiddleware = cors(corsOptions);
