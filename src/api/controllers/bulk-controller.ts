import { Request, Response } from 'express';
import { bulkRequestSchema } from '../schemas/bulk-schemas.js';
import { bulkService } from '../../services/bulk-service.js';
import { getStorageService } from '../../storage/storage-factory.js';
import { ForbiddenError, NotFoundError } from '../../domain/errors.js';

export class BulkController {
  public static async createBulk(req: Request, res: Response): Promise<void> {
    const validated = bulkRequestSchema.parse(req.body);

    if (req.tenantId && req.tenantId !== validated.tenantId) {
      throw new ForbiddenError('Tenant ID in header does not match tenant ID in bulk request');
    }

    const result = await bulkService.createBulkJob(validated);
    res.status(202).json(result);
  }

  public static async getStatus(req: Request, res: Response): Promise<void> {
    const { bulkJobId } = req.params;
    const status = await bulkService.getBulkStatus(bulkJobId);

    if (!req.tenantId || req.tenantId !== status.tenantId) {
      throw new ForbiddenError('Bulk job belongs to a different tenant');
    }

    res.status(200).json(status);
  }

  public static async getEvents(req: Request, res: Response): Promise<void> {
    const { bulkJobId } = req.params;
    const status = await bulkService.getBulkStatus(bulkJobId);

    if (!req.tenantId || req.tenantId !== status.tenantId) {
      throw new ForbiddenError('Bulk job belongs to a different tenant');
    }

    await bulkService.handleSseConnection(bulkJobId, res);
  }

  public static async download(req: Request, res: Response): Promise<void> {
    const { bulkJobId } = req.params;
    const status = await bulkService.getBulkStatus(bulkJobId);

    if (!req.tenantId || req.tenantId !== status.tenantId) {
      throw new ForbiddenError('Bulk job belongs to a different tenant');
    }

    if (status.status !== 'completed' && status.status !== 'partially_completed') {
      res.status(409).json({
        error: {
          code: 'ARCHIVE_NOT_READY',
          message: `Bulk job is currently '${status.status}'. Archive generation has not completed yet.`,
          percentageComplete: status.percentageComplete,
        },
      });
      return;
    }

    const storage = getStorageService();
    const archiveKey = `tenants/${status.tenantId}/bulk/${bulkJobId}/archive.zip`;
    const exists = await storage.exists(archiveKey);
    if (!exists) {
      throw new NotFoundError(`Bulk archive not found in storage: ${archiveKey}`);
    }

    const metadata = await storage.getMetadata(archiveKey);

    // Support HTTP Range header for resumable archive downloads
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : metadata.sizeBytes - 1;

      if (start >= metadata.sizeBytes || end >= metadata.sizeBytes) {
        res.status(416).setHeader('Content-Range', `bytes */${metadata.sizeBytes}`).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${metadata.sizeBytes}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="bulk_archive_${bulkJobId}.zip"`);

      const stream = await storage.getStream(archiveKey, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', metadata.sizeBytes);
    res.setHeader('Content-Disposition', `attachment; filename="bulk_archive_${bulkJobId}.zip"`);
    res.setHeader('Accept-Ranges', 'bytes');
    const checksum = status.archiveChecksum || metadata.sha256;
    if (checksum) {
      res.setHeader('X-Archive-SHA256', checksum);
    }

    const stream = await storage.getStream(archiveKey);
    stream.pipe(res);
  }

  public static async getManifest(req: Request, res: Response): Promise<void> {
    const { bulkJobId } = req.params;
    const manifest = await bulkService.getManifest(bulkJobId);

    if (!req.tenantId || req.tenantId !== manifest.tenantId) {
      throw new ForbiddenError('Bulk job belongs to a different tenant');
    }

    res.status(200).json(manifest);
  }
}
