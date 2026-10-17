import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pdfService } from './services/pdf-service.js';
import { bulkEmitter } from './services/bulk-service.js';
import { TemplateEngine } from './templates/engine.js';

TemplateEngine.initialize();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { port: env.PORT, host: env.HOST, env: env.NODE_ENV, storageDriver: env.STORAGE_DRIVER },
    'PDF Generation Microservice API running'
  );
});

async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Received shutdown signal, starting graceful HTTP shutdown');
  server.close(async () => {
    logger.info('HTTP server closed, cleaning up Chromium browser resources');
    await pdfService.closeBrowser();
    await bulkEmitter.close();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  });

  // Force terminate after 10 seconds if lingering
  setTimeout(() => {
    logger.error('Forcefully terminating process due to shutdown timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
