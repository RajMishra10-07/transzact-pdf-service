import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestLoggerMiddleware } from './api/middleware/request-logger.js';
import { rateLimiterMiddleware } from './api/middleware/rate-limiter.js';
import { errorHandlerMiddleware } from './api/middleware/error-handler.js';
import path from 'path';
import { healthRouter } from './api/routes/health-routes.js';
import { previewRouter } from './api/routes/preview-routes.js';
import { documentRouter } from './api/routes/document-routes.js';
import { bulkRouter } from './api/routes/bulk-routes.js';
import { authRouter } from './api/routes/auth-routes.js';

export function createApp(): Express {
  const app = express();

  // Security headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameSrc: ["'self'"],
        },
      },
    })
  );

  // CORS
  app.use(cors());

  // Request body parsing with safe configurable limit
  app.use(express.json({ limit: `${env.MAX_PAYLOAD_SIZE_MB}mb` }));
  app.use(express.urlencoded({ extended: true, limit: `${env.MAX_PAYLOAD_SIZE_MB}mb` }));

  // Request correlation tracking and structured logging
  app.use(requestLoggerMiddleware);

  // Rate Limiting
  app.use(rateLimiterMiddleware);

  // Serve static assets from public/ (Full Interactive Frontend Studio)
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Health, Observability & Live Browser Playground
  app.use('/', healthRouter);
  app.use('/', previewRouter);

  // Core API v1 Routes
  app.use('/api/v1', authRouter);
  app.use('/api/v1', documentRouter);
  app.use('/api/v1', bulkRouter);

  // Centralized Error Handling
  app.use(errorHandlerMiddleware);

  return app;
}

export const app = createApp();
