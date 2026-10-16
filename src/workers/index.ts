import { Worker } from 'bullmq';
import { startNormalDocumentWorker } from './document-worker.js';
import { startLargeDocumentWorker } from './large-document-worker.js';
import { startArchiveWorker } from './archive-worker.js';
import { logger } from '../utils/logger.js';
import { metricsService } from '../services/metrics-service.js';
import { pdfService } from '../services/pdf-service.js';
import { env } from '../config/env.js';

logger.info('Starting PDF Generation & Archive Workers...');

const activeWorkers: Worker[] = [];

if (env.NORMAL_WORKER_CONCURRENCY > 0) {
  logger.info({ concurrency: env.NORMAL_WORKER_CONCURRENCY }, 'Starting Normal Document Worker');
  activeWorkers.push(startNormalDocumentWorker());
}

if (env.LARGE_WORKER_CONCURRENCY > 0) {
  logger.info({ concurrency: env.LARGE_WORKER_CONCURRENCY }, 'Starting Large Document Worker');
  activeWorkers.push(startLargeDocumentWorker());
}

if (env.ARCHIVE_WORKER_CONCURRENCY > 0) {
  logger.info({ concurrency: env.ARCHIVE_WORKER_CONCURRENCY }, 'Starting Archive Worker');
  activeWorkers.push(startArchiveWorker());
}

metricsService.setActiveWorkers(activeWorkers.length);

async function shutdown() {
  logger.info('Gracefully shutting down workers...');
  metricsService.setActiveWorkers(0);
  await Promise.all(activeWorkers.map((worker) => worker.close()));
  await pdfService.closeBrowser();
  logger.info('All workers terminated');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
