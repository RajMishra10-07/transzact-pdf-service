import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  setForceInMemoryRepositories,
  getBulkJobRepository,
} from '../../src/database/repositories/repository-factory.js';
import { BulkProgressEmitter } from '../../src/services/bulk-service.js';
import { APP_CONSTANTS } from '../../src/config/constants.js';

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

  it('2. Should distribute progress events across isolated worker processes via Redis Pub/Sub', async () => {
    const publishedMessages: Array<{ channel: string; message: string }> = [];
    let messageHandler: ((channel: string, message: string) => void) | null = null;

    const mockPublisher = {
      status: 'ready',
      publish: async (channel: string, message: string) => {
        publishedMessages.push({ channel, message });
        return 1;
      },
      quit: async () => {},
    };

    const mockSubscriber = {
      status: 'ready',
      subscribe: async (channel: string) => {},
      on: (event: string, handler: any) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      },
      unsubscribe: async () => {},
      quit: async () => {},
    };

    const emitter = new BulkProgressEmitter();
    emitter.setMockClients(mockPublisher, mockSubscriber);
    await emitter.ensureSubscribed();

    const receivedUpdates: any[] = [];
    emitter.on('progress', (update) => {
      receivedUpdates.push(update);
    });

    const mockSnapshot = {
      bulkJobId: 'bulk_cross_process_01',
      tenantId: 'tenant_alpha',
      status: 'processing',
      totalDocuments: 10,
      queuedDocuments: 5,
      processingDocuments: 3,
      completedDocuments: 2,
      failedDocuments: 0,
      percentageComplete: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 1. Worker process emits progress locally and publishes to Redis
    await emitter.publishProgress(mockSnapshot);

    // Verify it was published to Redis channel
    expect(publishedMessages.length).toBe(1);
    expect(publishedMessages[0].channel).toBe(APP_CONSTANTS.REDIS_CHANNELS.BULK_PROGRESS);
    const parsedPub = JSON.parse(publishedMessages[0].message);
    expect(parsedPub.senderId).toBe(emitter.getInstanceId());
    expect(parsedPub.snapshot.bulkJobId).toBe('bulk_cross_process_01');

    // 2. Incoming message from external worker container (different senderId)
    const externalWorkerMessage = JSON.stringify({
      senderId: 'worker_container_containerId_abc',
      snapshot: { ...mockSnapshot, completedDocuments: 5, percentageComplete: 50 },
    });
    messageHandler!(APP_CONSTANTS.REDIS_CHANNELS.BULK_PROGRESS, externalWorkerMessage);

    expect(receivedUpdates.some((u) => u.completedDocuments === 5 && u.percentageComplete === 50)).toBe(true);

    // 3. Incoming message from the same process (prevent duplicate local broadcast)
    const countBefore = receivedUpdates.length;
    const sameSenderMessage = JSON.stringify({
      senderId: emitter.getInstanceId(),
      snapshot: mockSnapshot,
    });
    messageHandler!(APP_CONSTANTS.REDIS_CHANNELS.BULK_PROGRESS, sameSenderMessage);
    expect(receivedUpdates.length).toBe(countBefore);

    await emitter.close();
  });
});
