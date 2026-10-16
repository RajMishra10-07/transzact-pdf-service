import { Job, Worker } from 'bullmq';
import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { ArchiveJobData } from '../queue/queues.js';
import { getRedisOptions } from '../queue/connection.js';
import { archiveService } from '../services/archive-service.js';
import { bulkEmitter, bulkService } from '../services/bulk-service.js';
import { metricsService } from '../services/metrics-service.js';
import { logger } from '../utils/logger.js';

export function startArchiveWorker(): Worker<ArchiveJobData> {
  const worker = new Worker<ArchiveJobData>(
    APP_CONSTANTS.QUEUES.ARCHIVE,
    async (job: Job<ArchiveJobData>) => {
      const startTime = Date.now();
      const { bulkJobId, tenantId } = job.data;
      logger.info({ bulkJobId, tenantId }, 'Archive Worker starting ZIP package aggregation');

      const result = await archiveService.createArchive(bulkJobId, tenantId);
      const durationMs = Date.now() - startTime;
      metricsService.recordBulkCompletion(durationMs);

      // Emit terminal progress update via SSE
      const snapshot = await bulkService.getBulkStatus(bulkJobId);
      bulkEmitter.emit('progress', snapshot);

      return result;
    },
    {
      connection: getRedisOptions(),
      concurrency: env.ARCHIVE_WORKER_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Archive worker completed ZIP aggregation');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Archive worker failed ZIP aggregation');
  });

  return worker;
}
