import { Job, Worker, UnrecoverableError } from 'bullmq';
import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { RenderJobData, getQueueManager } from '../queue/queues.js';
import { getRedisOptions } from '../queue/connection.js';
import { pdfService } from '../services/pdf-service.js';
import { integrityService } from '../services/integrity-service.js';
import { metricsService } from '../services/metrics-service.js';
import { computeBufferHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import {
  getDocumentRepository,
  getBulkJobRepository,
} from '../database/repositories/repository-factory.js';
import { getStorageService } from '../storage/storage-factory.js';
import { bulkEmitter, bulkService } from '../services/bulk-service.js';
import { LargeDocumentMemoryError, ValidationError } from '../domain/errors.js';

export async function processRenderJob(jobData: RenderJobData): Promise<void> {
  const docRepo = getDocumentRepository();
  const bulkRepo = getBulkJobRepository();
  const storage = getStorageService();
  const queueManager = getQueueManager();

  const { jobId, tenantId, documentId, documentType, inputPayload, options, bulkJobId } = jobData;
  logger.info({ jobId, documentId, tenantId, bulkJobId }, 'Worker processing PDF render job');

  await docRepo.updateGenerationJobStatus(jobId, 'processing');
  if (bulkJobId) {
    await bulkRepo.updateBulkJobItemStatus(bulkJobId, jobId, 'processing');
    await bulkRepo.recalculateBulkJobProgress(bulkJobId);
  }

  try {
    // 1. Render PDF using Chromium
    const renderResult = await pdfService.renderPdf(documentType, inputPayload, options);
    const checksum = computeBufferHash(renderResult.pdfBuffer);
    const storageKey = APP_CONSTANTS.STORAGE_KEYS.PDF(tenantId, documentType, documentId);

    // 2. Persist PDF to object storage
    await storage.save(storageKey, renderResult.pdfBuffer, 'application/pdf');

    // 3. Persist document record
    await docRepo.createDocument({
      tenantId,
      documentId,
      jobId,
      documentType,
      templateVersion: renderResult.templateVersion,
      storageKey,
      fileSizeBytes: renderResult.pdfBuffer.length,
      sha256Checksum: checksum,
      renderDurationMs: renderResult.renderDurationMs,
    });

    // 4. Record audit entry
    await integrityService.recordGenerationAudit(documentId, tenantId, checksum, 'worker');
    await docRepo.updateGenerationJobStatus(jobId, 'completed');
    metricsService.recordRender(renderResult.renderDurationMs);

    // 5. Handle bulk job item progress if applicable
    if (bulkJobId) {
      await bulkRepo.updateBulkJobItemStatus(bulkJobId, jobId, 'completed');
      const updatedBulk = await bulkRepo.recalculateBulkJobProgress(bulkJobId);

      const snapshot = await bulkService.getBulkStatus(bulkJobId);
      bulkEmitter.emit('progress', snapshot);

      // Check if all documents reached terminal state
      const totalProcessed = updatedBulk.completedDocuments + updatedBulk.failedDocuments;
      if (totalProcessed >= updatedBulk.totalDocuments) {
        logger.info({ bulkJobId }, 'All bulk documents completed; enqueueing archive creation');
        await queueManager.addArchiveJob({ bulkJobId, tenantId });
      }
    }
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || 'Unknown rendering error';
    const isDeterministic =
      err instanceof LargeDocumentMemoryError ||
      err instanceof ValidationError ||
      (err as { name?: string }).name === 'ValidationError';

    logger.error(
      { err: errorMsg, jobId, documentId, isDeterministic },
      'PDF rendering failed in worker'
    );

    // If deterministic, this error will NEVER succeed on retry; fail permanently immediately
    if (isDeterministic) {
      await docRepo.updateGenerationJobStatus(jobId, 'failed', errorMsg);
      if (bulkJobId) {
        await bulkRepo.updateBulkJobItemStatus(bulkJobId, jobId, 'failed', errorMsg);
        const updatedBulk = await bulkRepo.recalculateBulkJobProgress(bulkJobId);
        const snapshot = await bulkService.getBulkStatus(bulkJobId);
        bulkEmitter.emit('progress', snapshot);

        const totalProcessed = updatedBulk.completedDocuments + updatedBulk.failedDocuments;
        if (totalProcessed >= updatedBulk.totalDocuments) {
          logger.info({ bulkJobId }, 'All bulk documents reached terminal state; enqueueing archive creation');
          await queueManager.addArchiveJob({ bulkJobId, tenantId });
        }
      }
      // Instruct BullMQ to abort retries for this unrecoverable error
      throw new UnrecoverableError(errorMsg);
    }

    // For transient errors, update job status and re-throw to allow bounded BullMQ retry
    await docRepo.updateGenerationJobStatus(jobId, 'failed', errorMsg);
    throw err;
  }
}

export function startNormalDocumentWorker(): Worker<RenderJobData> {
  const worker = new Worker<RenderJobData>(
    APP_CONSTANTS.QUEUES.NORMAL,
    async (job: Job<RenderJobData>) => {
      await processRenderJob(job.data);
    },
    {
      connection: getRedisOptions(),
      concurrency: env.NORMAL_WORKER_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Normal PDF worker completed job');
  });

  worker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err: err.message, attempts: job?.attemptsMade }, 'Normal PDF worker failed job');
    metricsService.recordRetry();

    // If all attempts exhausted, ensure permanent failure status is recorded
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
      const docRepo = getDocumentRepository();
      const bulkRepo = getBulkJobRepository();
      const { jobId, bulkJobId, tenantId } = job.data;
      await docRepo.updateGenerationJobStatus(jobId, 'failed', err.message);
      if (bulkJobId) {
        await bulkRepo.updateBulkJobItemStatus(bulkJobId, jobId, 'failed', err.message);
        const updatedBulk = await bulkRepo.recalculateBulkJobProgress(bulkJobId);
        const snapshot = await bulkService.getBulkStatus(bulkJobId);
        bulkEmitter.emit('progress', snapshot);

        const totalProcessed = updatedBulk.completedDocuments + updatedBulk.failedDocuments;
        if (totalProcessed >= updatedBulk.totalDocuments) {
          const queueManager = getQueueManager();
          await queueManager.addArchiveJob({ bulkJobId, tenantId });
        }
      }
    }
  });

  return worker;
}
