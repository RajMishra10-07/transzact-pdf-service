import { Router } from 'express';
import { HealthController } from '../controllers/health-controller.js';
import { MetricsController } from '../controllers/metrics-controller.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const healthRouter = Router();

healthRouter.get('/health', asyncHandler(HealthController.getHealth));
healthRouter.get('/ready', asyncHandler(HealthController.getReady));
healthRouter.get('/metrics', asyncHandler(MetricsController.getMetrics));
