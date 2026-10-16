import { Job, Worker } from 'bullmq';
import { APP_CONSTANTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { RenderJobData } from '../queue/queues.js';
import { getRedisOptions } from '../queue/connection.js';
import { processRenderJob } from './document-worker.js';
import { logger } from '../utils/logger.js';
import { metricsService } from '../services/metrics-service.js';

export function startLargeDocumentWorker(): Worker<RenderJobData> {
  const worker = new Worker<RenderJobData>(
    APP_CONSTANTS.QUEUES.LARGE,
    async (job: Job<RenderJobData>) => {
      logger.info({ jobId: job.id }, 'Large Document Worker processing high-complexity PDF');
      await processRenderJob(job.data);
    },
    {
      connection: getRedisOptions(),
      concurrency: env.LARGE_WORKER_CONCURRENCY, // Strict concurrency (1) to safeguard RAM
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Large document worker completed job');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Large document worker failed job');
    metricsService.recordLargeDocFailure();
  });

  return worker;
}
