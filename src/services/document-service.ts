import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { GenerateDocumentRequest } from '../api/schemas/document-schemas.js';
import { DocumentRecord, GenerationJob } from '../domain/document.js';
import { NotFoundError, ConflictError } from '../domain/errors.js';
import { computeBufferHash, computeInputHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import {
  getDocumentRepository,
  getAuditRepository,
} from '../database/repositories/repository-factory.js';
import { getStorageService } from '../storage/storage-factory.js';
import { getQueueManager } from '../queue/queues.js';
import { pdfService } from './pdf-service.js';
import { integrityService } from './integrity-service.js';
import { metricsService } from './metrics-service.js';

export interface GenerateResult {
  isSync: boolean;
  jobId: string;
  documentId: string;
  status: string;
  downloadUrl?: string;
  fileSizeBytes?: number;
  sha256Checksum?: string;
  statusUrl: string;
}

export class DocumentService {
  /**
   * Generates a single document with idempotency, snapshot immutability,
   * safe synchronous rendering option, and fallback to asynchronous queue.
   */
  public async generateDocument(
    req: GenerateDocumentRequest,
    performedBy = 'system'
  ): Promise<GenerateResult> {
    const docRepo = getDocumentRepository();
    const storage = getStorageService();

    // 1. Compute canonical input hash to guarantee snapshot immutability
    const inputHash = computeInputHash(req.data);

    // 2. Idempotency check
    if (req.idempotencyKey) {
      const existingJob = await docRepo.findGenerationJobByIdempotencyKey(
        req.tenantId,
        req.idempotencyKey
      );
      if (existingJob) {
        // Enforce that identical idempotency key must have identical payload
        if (existingJob.inputHash !== inputHash) {
          throw new ConflictError(
            `Idempotency key '${req.idempotencyKey}' was already used with a different request payload`
          );
        }

        logger.info(
          { tenantId: req.tenantId, idempotencyKey: req.idempotencyKey, jobId: existingJob.id },
          'Idempotent request matched existing generation job'
        );

        if (existingJob.status === 'completed') {
          const doc = await docRepo.findDocumentByDocumentId(
            req.tenantId,
            req.documentType,
            req.documentId
          );
          if (doc) {
            const downloadUrl = await storage.getSignedUrl(doc.storageKey);
            return {
              isSync: true,
              jobId: existingJob.id,
              documentId: doc.documentId,
              status: 'completed',
              downloadUrl,
              fileSizeBytes: doc.fileSizeBytes,
              sha256Checksum: doc.sha256Checksum,
              statusUrl: `/api/v1/jobs/${existingJob.id}`,
            };
          }
        }

        return {
          isSync: false,
          jobId: existingJob.id,
          documentId: existingJob.documentId,
          status: existingJob.status,
          statusUrl: `/api/v1/jobs/${existingJob.id}`,
        };
      }
    }

    const items = (req.data.items as unknown[]) || [];
    const isLargeDoc = items.length >= env.LARGE_DOCUMENT_THRESHOLD;

    // 3. Persist Generation Job (Immutable Snapshot)
    const job = await docRepo.createGenerationJob({
      tenantId: req.tenantId,
      documentId: req.documentId,
      documentType: req.documentType,
      status: 'queued',
      idempotencyKey: req.idempotencyKey || null,
      inputHash,
      inputPayload: req.data,
      priority: isLargeDoc ? 1 : 0,
    });

    const statusUrl = `/api/v1/jobs/${job.id}`;

    // If job was already processing or completed due to a concurrent race condition, do not re-enqueue
    if (job.status !== 'queued') {
      return {
        isSync: false,
        jobId: job.id,
        documentId: job.documentId,
        status: job.status,
        statusUrl,
      };
    }

    // 4. Check if synchronous generation should be attempted
    const shouldAttemptSync = req.options?.preferSync && !isLargeDoc;

    if (shouldAttemptSync) {
      try {
        logger.info({ jobId: job.id, documentId: req.documentId }, 'Attempting synchronous PDF rendering');
        await docRepo.updateGenerationJobStatus(job.id, 'processing');

        const renderResult = await pdfService.renderPdf(req.documentType, req.data, req.options);
        const checksum = computeBufferHash(renderResult.pdfBuffer);
        const storageKey = APP_CONSTANTS.STORAGE_KEYS.PDF(req.tenantId, req.documentType, req.documentId);

        // Save PDF to storage
        await storage.save(storageKey, renderResult.pdfBuffer, 'application/pdf');

        // Persist document record
        const docRecord = await docRepo.createDocument({
          tenantId: req.tenantId,
          documentId: req.documentId,
          jobId: job.id,
          documentType: req.documentType,
          templateVersion: renderResult.templateVersion,
          storageKey,
          fileSizeBytes: renderResult.pdfBuffer.length,
          sha256Checksum: checksum,
          renderDurationMs: renderResult.renderDurationMs,
        });

        // Record audit trail
        await integrityService.recordGenerationAudit(req.documentId, req.tenantId, checksum, performedBy);
        await docRepo.updateGenerationJobStatus(job.id, 'completed');
        metricsService.recordRender(renderResult.renderDurationMs);

        const downloadUrl = await storage.getSignedUrl(storageKey);
        return {
          isSync: true,
          jobId: job.id,
          documentId: req.documentId,
          status: 'completed',
          downloadUrl,
          fileSizeBytes: docRecord.fileSizeBytes,
          sha256Checksum: docRecord.sha256Checksum,
          statusUrl,
        };
      } catch (syncErr) {
        logger.warn(
          { syncErr, jobId: job.id },
          'Synchronous rendering timed out or failed; falling back gracefully to background queue'
        );
        // Fall back to queue
        await docRepo.updateGenerationJobStatus(job.id, 'queued');
      }
    }

    // 5. Enqueue Asynchronous Background Job
    const queueManager = getQueueManager();
    await queueManager.addRenderJob({
      jobId: job.id,
      tenantId: req.tenantId,
      documentId: req.documentId,
      documentType: req.documentType,
      inputPayload: req.data,
      options: req.options,
      isLargeDocument: isLargeDoc,
    });

    return {
      isSync: false,
      jobId: job.id,
      documentId: req.documentId,
      status: 'queued',
      statusUrl,
    };
  }

  public async getJob(jobId: string): Promise<GenerationJob> {
    const docRepo = getDocumentRepository();
    const job = await docRepo.findGenerationJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Generation job not found: ${jobId}`);
    }

    // Stranded job recovery: if worker crashed while processing (processing > 60s), mark failed
    if (job.status === 'processing' && job.startedAt) {
      const elapsedMs = Date.now() - new Date(job.startedAt).getTime();
      if (elapsedMs > 60000) {
        logger.warn({ jobId, elapsedMs }, 'Detected stranded processing job from crashed worker; marking failed');
        await docRepo.updateGenerationJobStatus(
          jobId,
          'failed',
          'Worker process terminated or crashed before completing render'
        );
        job.status = 'failed';
        job.errorMessage = 'Worker process terminated or crashed before completing render';
      }
    }

    return job;
  }

  public async getDocument(
    tenantId: string,
    documentType: string,
    documentId: string
  ): Promise<DocumentRecord> {
    const docRepo = getDocumentRepository();
    const doc = await docRepo.findDocumentByDocumentId(tenantId, documentType as any, documentId);
    if (!doc) {
      throw new NotFoundError(`Document not found: ${documentType}/${documentId}`);
    }
    return doc;
  }
}

export const documentService = new DocumentService();
