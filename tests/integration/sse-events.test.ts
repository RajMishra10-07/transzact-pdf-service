import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  setForceInMemoryRepositories,
  getBulkJobRepository,
} from '../../src/database/repositories/repository-factory.js';

describe('19. Server-Sent Events (SSE) Live Progress Updates', () => {
  const validApiKey = env.API_KEY;

  beforeEach(() => {
    setForceInMemoryRepositories(true);
  });

  it('19. Should send initial snapshot immediately over SSE stream and close on completed status', async () => {
    const bulkRepo = getBulkJobRepository();
    const bulkJobId = 'bulk_sse_snapshot_01';
    const tenantId = 'tenant_sse';

    await bulkRepo.createBulkJob({
      id: bulkJobId,
      tenantId,
      totalDocuments: 5,
    });
    // Mark completed so stream flushes snapshot and completes
    await bulkRepo.updateBulkJobStatus(bulkJobId, 'completed');

    const res = await request(app)
      .get(`/api/v1/bulk/${bulkJobId}/events`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toBe('text/event-stream');
    expect(res.text).toContain('event: snapshot');
    expect(res.text).toContain('"bulkJobId":"bulk_sse_snapshot_01"');
    expect(res.text).toContain('event: done');
  });
});
