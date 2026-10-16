import { Router } from 'express';
import { BulkController } from '../controllers/bulk-controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const bulkRouter = Router();

bulkRouter.use(authMiddleware);
bulkRouter.use(tenantMiddleware);

bulkRouter.post('/documents/bulk', asyncHandler(BulkController.createBulk));
bulkRouter.get('/bulk/:bulkJobId/status', asyncHandler(BulkController.getStatus));
bulkRouter.get('/bulk/:bulkJobId/events', asyncHandler(BulkController.getEvents));
bulkRouter.get('/bulk/:bulkJobId/download', asyncHandler(BulkController.download));
bulkRouter.get('/bulk/:bulkJobId/manifest', asyncHandler(BulkController.getManifest));
