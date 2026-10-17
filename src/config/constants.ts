export const APP_CONSTANTS = {
  APP_NAME: 'transzact-pdf-service',
  VERSION: '1.0.0',
  DEFAULT_PORT: 4000,
  DEFAULT_LARGE_DOC_THRESHOLD: 150,
  DEFAULT_RENDER_TIMEOUT_MS: 15000,
  DEFAULT_SYNC_RENDER_TIMEOUT_MS: 4500,
  DEFAULT_MAX_SYNC_RENDER_CONCURRENCY: 2,
  MAX_BULK_DOCS: 100,
  DEFAULT_MAX_BROWSER_RENDERS: 50,
  DEFAULT_MAX_BROWSER_MEMORY_MB: 750,
  QUEUES: {
    NORMAL: 'pdf-render-normal',
    LARGE: 'pdf-render-large',
    ARCHIVE: 'bulk-archive-creation',
  },
  REDIS_CHANNELS: {
    BULK_PROGRESS: 'transzact:bulk-progress',
  },
  STORAGE_KEYS: {
    PDF: (tenantId: string, docType: string, docId: string, version = 1) =>
      `tenants/${tenantId}/documents/${docType}/${docId}-v${version}.pdf`,
    ZIP: (tenantId: string, bulkJobId: string) =>
      `tenants/${tenantId}/bulk/${bulkJobId}/archive.zip`,
    MANIFEST: (tenantId: string, bulkJobId: string) =>
      `tenants/${tenantId}/bulk/${bulkJobId}/manifest.json`,
  },
  JOB_STATES: {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    PARTIALLY_COMPLETED: 'partially_completed',
    FAILED: 'failed',
  } as const,
};
