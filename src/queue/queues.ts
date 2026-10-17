import { Queue, QueueOptions } from 'bullmq';
import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { getRedisOptions } from './connection.js';
import { logger } from '../utils/logger.js';
import { DocumentRenderOptions, DocumentType } from '../domain/document.js';

export interface RenderJobData {
  jobId: string;
  tenantId: string;
  documentId: string;
  documentType: DocumentType;
  inputPayload: Record<string, unknown>;
  options?: DocumentRenderOptions;
  bulkJobId?: string;
  isLargeDocument?: boolean;
}

export interface ArchiveJobData {
  bulkJobId: string;
  tenantId: string;
}

export interface IQueueManager {
  addRenderJob(data: RenderJobData): Promise<string>;
  addArchiveJob(data: ArchiveJobData): Promise<string>;
  getQueueMetrics(): Promise<Record<string, { waiting: number; active: number; completed: number; failed: number }>>;
}

class BullMQManager implements IQueueManager {
  private normalQueue: Queue;
  private largeQueue: Queue;
  private archiveQueue: Queue;

  constructor() {
    const redisOptions = getRedisOptions();
    const queueOptions: QueueOptions = {
      connection: redisOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    };

    this.normalQueue = new Queue(APP_CONSTANTS.QUEUES.NORMAL, queueOptions);
    this.largeQueue = new Queue(APP_CONSTANTS.QUEUES.LARGE, queueOptions);
    this.archiveQueue = new Queue(APP_CONSTANTS.QUEUES.ARCHIVE, queueOptions);
  }

  public async addRenderJob(data: RenderJobData): Promise<string> {
    const targetQueue = data.isLargeDocument ? this.largeQueue : this.normalQueue;
    const job = await targetQueue.add('render-pdf', data, {
      jobId: data.jobId,
    });
    return job.id || data.jobId;
  }

  public async addArchiveJob(data: ArchiveJobData): Promise<string> {
    const job = await this.archiveQueue.add('create-archive', data, {
      jobId: `archive_${data.bulkJobId}`,
    });
    return job.id || data.bulkJobId;
  }

  public async getQueueMetrics(): Promise<Record<string, { waiting: number; active: number; completed: number; failed: number }>> {
    const [normalCounts, largeCounts, archiveCounts] = await Promise.all([
      this.normalQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
      this.largeQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
      this.archiveQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    ]);

    return {
      [APP_CONSTANTS.QUEUES.NORMAL]: {
        waiting: normalCounts.waiting || 0,
        active: normalCounts.active || 0,
        completed: normalCounts.completed || 0,
        failed: normalCounts.failed || 0,
      },
      [APP_CONSTANTS.QUEUES.LARGE]: {
        waiting: largeCounts.waiting || 0,
        active: largeCounts.active || 0,
        completed: largeCounts.completed || 0,
        failed: largeCounts.failed || 0,
      },
      [APP_CONSTANTS.QUEUES.ARCHIVE]: {
        waiting: archiveCounts.waiting || 0,
        active: archiveCounts.active || 0,
        completed: archiveCounts.completed || 0,
        failed: archiveCounts.failed || 0,
      },
    };
  }
}

/**
 * In-memory fallback queue for automated tests or when Redis is absent
 */
export class InMemoryQueueManager implements IQueueManager {
  private renderJobs: RenderJobData[] = [];
  private archiveJobs: ArchiveJobData[] = [];

  public async addRenderJob(data: RenderJobData): Promise<string> {
    this.renderJobs.push(data);
    logger.info({ jobId: data.jobId, isLarge: data.isLargeDocument }, 'Enqueued render job (In-Memory)');

    if (env.NODE_ENV !== 'test' && env.USE_IN_MEMORY_FALLBACK) {
      setImmediate(async () => {
        try {
          const { processRenderJob } = await import('../workers/document-worker.js');
          await processRenderJob(data);
        } catch (err) {
          logger.error({ err, jobId: data.jobId }, 'In-Memory render job execution error');
        }
      });
    }

    return data.jobId;
  }

  public async addArchiveJob(data: ArchiveJobData): Promise<string> {
    this.archiveJobs.push(data);
    logger.info({ bulkJobId: data.bulkJobId }, 'Enqueued archive job (In-Memory)');

    if (env.NODE_ENV !== 'test' && env.USE_IN_MEMORY_FALLBACK) {
      setImmediate(async () => {
        try {
          const { archiveService } = await import('../services/archive-service.js');
          const { bulkEmitter, bulkService } = await import('../services/bulk-service.js');
          await archiveService.createArchive(data.bulkJobId, data.tenantId);
          const snapshot = await bulkService.getBulkStatus(data.bulkJobId);
          bulkEmitter.emit('progress', snapshot);
        } catch (err) {
          logger.error({ err, bulkJobId: data.bulkJobId }, 'In-Memory archive job execution error');
        }
      });
    }

    return `archive_${data.bulkJobId}`;
  }

  public async getQueueMetrics(): Promise<Record<string, { waiting: number; active: number; completed: number; failed: number }>> {
    return {
      [APP_CONSTANTS.QUEUES.NORMAL]: { waiting: this.renderJobs.length, active: 0, completed: 0, failed: 0 },
      [APP_CONSTANTS.QUEUES.LARGE]: { waiting: 0, active: 0, completed: 0, failed: 0 },
      [APP_CONSTANTS.QUEUES.ARCHIVE]: { waiting: this.archiveJobs.length, active: 0, completed: 0, failed: 0 },
    };
  }

  public getPendingRenderJobs(): RenderJobData[] {
    return [...this.renderJobs];
  }
}

let queueManagerInstance: IQueueManager | null = null;
let forceInMemoryQueue = false;

export function setForceInMemoryQueue(enable: boolean): void {
  forceInMemoryQueue = enable;
  queueManagerInstance = enable ? new InMemoryQueueManager() : null;
}

export function getQueueManager(): IQueueManager {
  if (!queueManagerInstance) {
    if (forceInMemoryQueue || env.NODE_ENV === 'test' || env.USE_IN_MEMORY_FALLBACK) {
      queueManagerInstance = new InMemoryQueueManager();
    } else {
      queueManagerInstance = new BullMQManager();
    }
  }
  return queueManagerInstance;
}
