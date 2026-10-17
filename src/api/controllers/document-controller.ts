import { Request, Response } from 'express';
import { generateDocumentSchema } from '../schemas/document-schemas.js';
import { documentService } from '../../services/document-service.js';
import { integrityService } from '../../services/integrity-service.js';
import { getStorageService } from '../../storage/storage-factory.js';
import { getAuditRepository } from '../../database/repositories/repository-factory.js';
import { ForbiddenError, NotFoundError } from '../../domain/errors.js';
import { DocumentType } from '../../domain/document.js';

export class DocumentController {
  public static async generate(req: Request, res: Response): Promise<void> {
    const validated = generateDocumentSchema.parse(req.body);

    // Enforce tenant match if tenantId was extracted from headers
    if (req.tenantId && req.tenantId !== validated.tenantId) {
      throw new ForbiddenError('Tenant ID in header does not match tenant ID in request payload');
    }

    const result = await documentService.generateDocument(
      validated,
      (req.headers['x-user-id'] as string) || 'system'
    );

    if (result.isSync) {
      res.status(200).json(result);
    } else {
      res.status(202).json(result);
    }
  }

  public static async getStatus(req: Request, res: Response): Promise<void> {
    const { documentId } = req.params;
    const documentType = (req.query.documentType as DocumentType) || 'invoice';
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new ForbiddenError('Tenant ID must be supplied via x-tenant-id header');
    }

    const doc = await documentService.getDocument(tenantId, documentType, documentId);
    res.status(200).json({
      documentId: doc.documentId,
      tenantId: doc.tenantId,
      documentType: doc.documentType,
      status: 'completed',
      fileSizeBytes: doc.fileSizeBytes,
      sha256Checksum: doc.sha256Checksum,
      templateVersion: doc.templateVersion,
      createdAt: doc.createdAt,
      downloadUrl: `/api/v1/documents/${doc.documentId}/download?documentType=${doc.documentType}&tenantId=${doc.tenantId}`,
    });
  }

  public static async getJob(req: Request, res: Response): Promise<void> {
    const { jobId } = req.params;
    const job = await documentService.getJob(jobId);

    if (!req.tenantId || req.tenantId !== job.tenantId) {
      throw new ForbiddenError('Access to job belongs to a different tenant');
    }

    res.status(200).json(job);
  }

  public static async download(req: Request, res: Response): Promise<void> {
    const { documentId } = req.params;
    const documentType = (req.query.documentType as DocumentType) || 'invoice';
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new ForbiddenError('Tenant ID must be supplied via x-tenant-id header');
    }

    const doc = await documentService.getDocument(tenantId, documentType, documentId);

    // Verify SHA-256 integrity before serving
    await integrityService.verifyDocumentIntegrity(
      tenantId,
      documentType,
      documentId,
      (req.headers['x-user-id'] as string) || 'download_client'
    );

    const storage = getStorageService();
    const metadata = await storage.getMetadata(doc.storageKey);

    // Record download audit
    await integrityService.recordDownloadAudit(
      documentId,
      tenantId,
      doc.sha256Checksum,
      (req.headers['x-user-id'] as string) || 'client',
      req.ip
    );

    // Handle HTTP Range header for resumable downloads
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
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${documentType}_${documentId}.pdf"`);

      const stream = await storage.getStream(doc.storageKey, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', metadata.sizeBytes);
    res.setHeader('Content-Disposition', `attachment; filename="${documentType}_${documentId}.pdf"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Document-SHA256', doc.sha256Checksum);

    const stream = await storage.getStream(doc.storageKey);
    stream.pipe(res);
  }

  public static async storageDownload(req: Request, res: Response): Promise<void> {
    const rawKey = req.query.key;
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Storage key query parameter is required' } });
      return;
    }
    const key = rawKey.trim();

    // 1. Always require a tenant
    if (!req.tenantId) {
      throw new ForbiddenError('Tenant ID is required to access storage download');
    }

    // 2. Reject keys containing ".." or starting with "/" (including URL-decoded variants)
    let decodedKey = key;
    try {
      decodedKey = decodeURIComponent(key);
    } catch {}

    if (
      key.includes('..') ||
      key.startsWith('/') ||
      key.startsWith('\\') ||
      decodedKey.includes('..') ||
      decodedKey.startsWith('/') ||
      decodedKey.startsWith('\\')
    ) {
      throw new ForbiddenError(
        'Invalid storage key: path traversal sequences ("..") and leading slashes are strictly forbidden'
      );
    }

    // 3. Check the key belongs to the caller's tenant
    const expectedPrefix = `tenants/${req.tenantId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new ForbiddenError(
        `Access to storage key belongs to a different tenant: key must start with '${expectedPrefix}'`
      );
    }

    const storage = getStorageService();
    const metadata = await storage.getMetadata(key);

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
      res.setHeader('Content-Type', metadata.contentType);
      const stream = await storage.getStream(key, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Type', metadata.contentType);
    res.setHeader('Content-Length', metadata.sizeBytes);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = await storage.getStream(key);
    stream.pipe(res);
  }

  public static async verify(req: Request, res: Response): Promise<void> {
    const { documentId } = req.params;
    const documentType = (req.query.documentType as DocumentType) || 'invoice';
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new ForbiddenError('Tenant ID must be supplied via x-tenant-id header or query parameter');
    }

    const result = await integrityService.verifyDocumentIntegrity(
      tenantId,
      documentType,
      documentId,
      (req.headers['x-user-id'] as string) || 'verifier_client'
    );

    const auditRepo = getAuditRepository();
    const auditLogs = await auditRepo.findAuditRecords(tenantId, documentId);

    res.status(200).json({
      documentId,
      tenantId,
      documentType,
      ...result,
      auditLogs,
    });
  }
}
