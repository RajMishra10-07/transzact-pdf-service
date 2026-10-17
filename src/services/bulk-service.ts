import { EventEmitter } from 'events';
import { Response } from 'express';
import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { BulkRequest } from '../api/schemas/bulk-schemas.js';
import { BulkJob, GenerationJob } from '../domain/document.js';
import { NotFoundError, ConflictError } from '../domain/errors.js';
import { computeInputHash } from '../utils/hash.js';
import { generateUuid } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import {
  getBulkJobRepository,
  getDocumentRepository,
} from '../database/repositories/repository-factory.js';
import { getQueueManager } from '../queue/queues.js';
import { getStorageService } from '../storage/storage-factory.js';
import { archiveService, BulkManifest } from './archive-service.js';

class BulkProgressEmitter extends EventEmitter {}
export const bulkEmitter = new BulkProgressEmitter();
// Increase listener limit for high concurrent SSE clients
bulkEmitter.setMaxListeners(1000);

export interface BulkCreationResult {
  bulkJobId: string;
  totalDocuments: number;
  queuedDocuments: number;
  statusUrl: string;
  progressUrl: string;
  manifestUrl: string;
  estimatedCompletionSeconds: number;
}

export interface BulkStatusResponse {
  bulkJobId: string;
  tenantId: string;
  status: string;
  totalDocuments: number;
  queuedDocuments: number;
  processingDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  percentageComplete: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  downloadUrl?: string | null;
  archiveChecksum?: string | null;
  archiveSizeBytes?: number | null;
}

export class BulkService {
  /**
   * Processes a bulk generation request for 1-100 documents.
   * Validates all payloads, creates durable DB snapshots, and enqueues individual render jobs.
   */
  public async createBulkJob(request: BulkRequest): Promise<BulkCreationResult> {
    const bulkRepo = getBulkJobRepository();
    const docRepo = getDocumentRepository();
    const queueManager = getQueueManager();

    const bulkJobId = generateUuid();
    const totalDocs = request.documents.length;

    logger.info({ bulkJobId, totalDocs, tenantId: request.tenantId }, 'Creating bulk PDF generation batch');

    // 1. Create bulk_job record
    const bulkJob = await bulkRepo.createBulkJob({
      id: bulkJobId,
      tenantId: request.tenantId,
      totalDocuments: totalDocs,
    });

    // 2. Create generation_jobs and bulk_job_items for each document
    const bulkItemsToInsert: Array<{
      id: string;
      bulkJobId: string;
      tenantId: string;
      documentId: string;
      generationJobId: string;
      orderIndex: number;
    }> = [];

    const jobsToEnqueue: Array<{
      job: GenerationJob;
      isLargeDoc: boolean;
      options?: any;
    }> = [];

    for (let i = 0; i < request.documents.length; i++) {
      const docSpec = request.documents[i];
      const inputHash = computeInputHash(docSpec.data);
      const items = (docSpec.data.items as unknown[]) || [];
      const isLargeDoc = items.length >= env.LARGE_DOCUMENT_THRESHOLD;

      // Create generation job record
      const genJob = await docRepo.createGenerationJob({
        tenantId: request.tenantId,
        documentId: docSpec.documentId,
        documentType: docSpec.documentType,
        status: 'queued',
        idempotencyKey: docSpec.idempotencyKey || null,
        inputHash,
        inputPayload: docSpec.data,
        priority: isLargeDoc ? 1 : 0,
      });

      bulkItemsToInsert.push({
        id: generateUuid(),
        bulkJobId,
        tenantId: request.tenantId,
        documentId: docSpec.documentId,
        generationJobId: genJob.id,
        orderIndex: i,
      });

      jobsToEnqueue.push({
        job: genJob,
        isLargeDoc,
        options: docSpec.options,
      });
    }

    // Persist items
    await bulkRepo.createBulkJobItems(bulkItemsToInsert);

    // 3. Enqueue all jobs into BullMQ
    for (const { job, isLargeDoc, options } of jobsToEnqueue) {
      await queueManager.addRenderJob({
        jobId: job.id,
        tenantId: job.tenantId,
        documentId: job.documentId,
        documentType: job.documentType,
        inputPayload: job.inputPayload,
        options,
        bulkJobId,
        isLargeDocument: isLargeDoc,
      });
    }

    // Calculate defensible estimated time: ~2.5s per doc divided by concurrency
    const effectiveConcurrency = Math.max(1, env.NORMAL_WORKER_CONCURRENCY);
    const estimatedCompletionSeconds = Math.ceil((totalDocs * 2.5) / effectiveConcurrency) + 5; // +5s buffer for ZIP packaging

    return {
      bulkJobId,
      totalDocuments: totalDocs,
      queuedDocuments: totalDocs,
      statusUrl: `/api/v1/bulk/${bulkJobId}/status`,
      progressUrl: `/api/v1/bulk/${bulkJobId}/events`,
      manifestUrl: `/api/v1/bulk/${bulkJobId}/manifest`,
      estimatedCompletionSeconds,
    };
  }

  /**
   * Retrieves aggregated status of a bulk job.
   */
  public async getBulkStatus(bulkJobId: string): Promise<BulkStatusResponse> {
    const bulkRepo = getBulkJobRepository();
    const bulkJob = await bulkRepo.findBulkJobById(bulkJobId);
    if (!bulkJob) {
      throw new NotFoundError(`Bulk job not found: ${bulkJobId}`);
    }

    const processed = bulkJob.completedDocuments + bulkJob.failedDocuments;
    const percentageComplete =
      bulkJob.totalDocuments > 0 ? Math.round((processed / bulkJob.totalDocuments) * 100) : 0;

    let downloadUrl: string | null = null;
    if (bulkJob.archiveStorageKey) {
      downloadUrl = `/api/v1/bulk/${bulkJob.id}/download`;
    }

    return {
      bulkJobId: bulkJob.id,
      tenantId: bulkJob.tenantId,
      status: bulkJob.status,
      totalDocuments: bulkJob.totalDocuments,
      queuedDocuments: bulkJob.queuedDocuments,
      processingDocuments: bulkJob.processingDocuments,
      completedDocuments: bulkJob.completedDocuments,
      failedDocuments: bulkJob.failedDocuments,
      percentageComplete,
      createdAt: bulkJob.createdAt,
      updatedAt: bulkJob.updatedAt,
      completedAt: bulkJob.completedAt,
      downloadUrl,
      archiveChecksum: bulkJob.archiveChecksum,
      archiveSizeBytes: bulkJob.archiveSizeBytes,
    };
  }

  /**
   * Handles Server-Sent Events (SSE) connection for a bulk job.
   */
  public async handleSseConnection(bulkJobId: string, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send immediate snapshot from database
    const snapshot = await this.getBulkStatus(bulkJobId);
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    // If already terminal, close stream
    if (['completed', 'partially_completed', 'failed'].includes(snapshot.status)) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: snapshot.status })}\n\n`);
      res.end();
      return;
    }

    // Heartbeat interval to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Event listener
    const onProgress = (update: BulkStatusResponse) => {
      if (update.bulkJobId === bulkJobId) {
        res.write(`event: progress\ndata: ${JSON.stringify(update)}\n\n`);
        if (['completed', 'partially_completed', 'failed'].includes(update.status)) {
          res.write(`event: done\ndata: ${JSON.stringify({ status: update.status })}\n\n`);
          cleanup();
          res.end();
        }
      }
    };

    const cleanup = () => {
      clearInterval(heartbeat);
      bulkEmitter.removeListener('progress', onProgress);
    };

    bulkEmitter.on('progress', onProgress);
    res.on('close', cleanup);
  }

  /**
   * Returns the manifest for a bulk job.
   */
  public async getManifest(bulkJobId: string): Promise<BulkManifest> {
    return archiveService.generateManifest(bulkJobId);
  }
}

export const bulkService = new BulkService();
