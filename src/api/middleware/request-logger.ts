import { Request, Response, NextFunction } from 'express';
import { generateUuid } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { metricsService } from '../../services/metrics-service.js';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateUuid();
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const isSuccess = res.statusCode < 400;

    metricsService.recordRequest(durationMs, isSuccess);

    if (req.path !== '/health' && req.path !== '/ready' && req.path !== '/metrics') {
      logger.info(
        {
          correlationId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        },
        'HTTP request completed'
      );
    }
  });

  next();
}
