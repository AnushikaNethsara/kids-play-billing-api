import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { env } from '../config/env';
import { API_PREFIX, APP_NAME } from '../config';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: APP_NAME,
      version: '1.0.0',
      description:
        'Backend API for a kids\' play-area billing and management system. Used by both the ' +
        'cashier Android (React Native) app and the Next.js admin back-office.',
    },
    servers: [{ url: API_PREFIX, description: env.NODE_ENV }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
            },
            requestId: { type: 'string' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Login, token refresh, logout' },
      { name: 'Users', description: 'Admin-only cashier/admin account management' },
      { name: 'Play Packages', description: 'Configurable play-duration pricing' },
      { name: 'Customers', description: 'Optional parent/child customer records' },
      { name: 'Bills', description: 'The core billing lifecycle: draft, complete, cancel, refund' },
      { name: 'Dashboard', description: 'Admin-only revenue and business statistics' },
      { name: 'Settings', description: 'Business-wide configuration' },
      { name: 'Audit Logs', description: 'Admin-only trail of sensitive actions' },
    ],
  },
  // swagger-jsdoc's glob resolution does not handle Windows-style backslash paths, so
  // the pattern is normalized to forward slashes regardless of platform.
  apis: [path.join(__dirname, '..', 'modules', '**', '*.routes.{ts,js}').split(path.sep).join('/')],
};

export const openApiSpec = swaggerJsdoc(options);
