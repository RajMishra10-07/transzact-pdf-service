import { Router } from 'express';
import { DocumentController } from '../controllers/document-controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const documentRouter = Router();

documentRouter.use(authMiddleware);
documentRouter.use(tenantMiddleware);

documentRouter.post('/documents/generate', asyncHandler(DocumentController.generate));
documentRouter.get('/documents/:documentId/status', asyncHandler(DocumentController.getStatus));
documentRouter.get('/documents/:documentId/download', asyncHandler(DocumentController.download));
documentRouter.get('/documents/:documentId/verify', asyncHandler(DocumentController.verify));
documentRouter.get('/storage/download', asyncHandler(DocumentController.storageDownload));
documentRouter.get('/jobs/:jobId', asyncHandler(DocumentController.getJob));
