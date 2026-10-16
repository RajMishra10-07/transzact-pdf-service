import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestLoggerMiddleware } from './api/middleware/request-logger.js';
import { rateLimiterMiddleware } from './api/middleware/rate-limiter.js';
import { errorHandlerMiddleware } from './api/middleware/error-handler.js';
import { healthRouter } from './api/routes/health-routes.js';
import { documentRouter } from './api/routes/document-routes.js';
import { bulkRouter } from './api/routes/bulk-routes.js';

export function createApp(): Express {
  const app = express();

  // Security headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
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

  // Health and Observability
  app.use('/', healthRouter);

  // Core API v1 Routes
  app.use('/api/v1', documentRouter);
  app.use('/api/v1', bulkRouter);

  // Centralized Error Handling
  app.use(errorHandlerMiddleware);

  return app;
}

export const app = createApp();
