import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  setForceInMemoryRepositories,
  getDocumentRepository,
} from '../../src/database/repositories/repository-factory.js';
import { setForceInMemoryQueue } from '../../src/queue/queues.js';
import { setStorageService } from '../../src/storage/storage-factory.js';
import { LocalStorageAdapter } from '../../src/storage/local-storage.js';

describe('HTTP API Endpoints Integration Tests', () => {
  const validApiKey = env.API_KEY;
  const testStorageDir = './data/test_api_storage';

  beforeEach(() => {
    setForceInMemoryRepositories(true);
    setForceInMemoryQueue(true);
    setStorageService(new LocalStorageAdapter(testStorageDir));
  });

  it('Health endpoint should return 200 without authentication', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('transzact-pdf-service');
  });

  it('Metrics endpoint should return 200 with operational metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.uptimeSeconds).toBeDefined();
    expect(res.body.memory).toBeDefined();
    expect(res.body.requests).toBeDefined();
  });

  it('Should reject unauthenticated requests to protected endpoints with 401', async () => {
    const res = await request(app)
      .post('/api/v1/documents/generate')
      .send({});
    expect(res.status).toBe(401);
  });

  it('Should reject invalid API key with 401', async () => {
    const res = await request(app)
      .post('/api/v1/documents/generate')
      .set('x-api-key', 'wrong-key')
      .send({});
    expect(res.status).toBe(401);
  });

  it('6. Should handle duplicate idempotency key idempotently', async () => {
    const invoicePayload = {
      documentType: 'invoice',
      documentId: 'INV-IDEMP-01',
      tenantId: 'tenant_alpha',
      idempotencyKey: 'idemp_key_unique_999',
      data: {
        invoiceNumber: 'INV-IDEMP-01',
        invoiceDate: '2026-10-15',
        supplier: {
          name: 'Acme Supplies',
          addressLine1: 'Road 1',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        customer: {
          name: 'Beta Global',
          addressLine1: 'Road 2',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
        items: [
          {
            description: 'Item A',
            quantity: 1,
            unit: 'PCS',
            unitPrice: 100,
            taxableAmount: 100,
            totalAmount: 118,
          },
        ],
        subtotal: 100,
        grandTotal: 118,
      },
    };

    // First Request
    const res1 = await request(app)
      .post('/api/v1/documents/generate')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha')
      .send(invoicePayload);

    expect(res1.status).toBe(202);
    const initialJobId = res1.body.jobId;

    // Second Request with identical idempotencyKey
    const res2 = await request(app)
      .post('/api/v1/documents/generate')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha')
      .send(invoicePayload);

    expect(res2.status).toBe(202);
    expect(res2.body.jobId).toBe(initialJobId); // Deduplicated to existing job
  });

  it('7. Should enforce tenant isolation', async () => {
    const docRepo = getDocumentRepository();
    // Create a job owned by tenant_beta
    const job = await docRepo.createGenerationJob({
      tenantId: 'tenant_beta',
      documentId: 'INV-BETA-01',
      documentType: 'invoice',
      status: 'queued',
      inputHash: 'hash123',
      inputPayload: { invoiceNumber: 'INV-BETA-01' },
    });

    // Request the job with header of tenant_alpha
    const res = await request(app)
      .get(`/api/v1/jobs/${job.id}`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha'); // Mismatched tenant

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('belongs to a different tenant');
  });

  it('8. Should retrieve job status correctly', async () => {
    const docRepo = getDocumentRepository();
    const job = await docRepo.createGenerationJob({
      tenantId: 'tenant_gamma',
      documentId: 'INV-GAMMA-01',
      documentType: 'invoice',
      status: 'queued',
      inputHash: 'hashgamma',
      inputPayload: { invoiceNumber: 'INV-GAMMA-01' },
    });

    const res = await request(app)
      .get(`/api/v1/jobs/${job.id}`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_gamma');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(job.id);
    expect(res.body.status).toBe('queued');
    expect(res.body.documentId).toBe('INV-GAMMA-01');
  });

  it('9. Should allow downloading stored files via /api/v1/storage/download', async () => {
    const storage = new LocalStorageAdapter(testStorageDir);
    setStorageService(storage);

    const key = 'tenants/tenant_storage_test/invoice/INV-STORE-01.pdf';
    await storage.save(key, Buffer.from('%PDF-1.4 Mock Stored PDF', 'utf8'), 'application/pdf');

    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(key)}`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_storage_test')
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toBe('application/pdf');
    const content = res.body instanceof Buffer ? res.body.toString('utf8') : res.text;
    expect(content).toContain('%PDF-1.4 Mock Stored PDF');
  });

  it('10. Should limit synchronous render concurrency and fall back gracefully to queue', async () => {
    // When MAX_SYNC_RENDER_CONCURRENCY is simulated as reached (e.g. activeSyncRenders = 2)
    const originalMax = env.MAX_SYNC_RENDER_CONCURRENCY;
    (env as { MAX_SYNC_RENDER_CONCURRENCY: number }).MAX_SYNC_RENDER_CONCURRENCY = 0; // Force immediate fallback

    try {
      const invoicePayload = {
        documentType: 'invoice',
        documentId: 'INV-SYNC-LIMIT-01',
        tenantId: 'tenant_sync_test',
        options: { preferSync: true },
        data: {
          invoiceNumber: 'INV-SYNC-LIMIT-01',
          invoiceDate: '2026-10-18',
          supplier: {
            name: 'Acme Corp',
            addressLine1: 'Plot 1',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
          },
          customer: {
            name: 'Customer Beta',
            addressLine1: 'Plot 2',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
          items: [
            {
              description: 'Item 1',
              quantity: 2,
              unit: 'PCS',
              unitPrice: 500,
              taxableAmount: 1000,
              totalAmount: 1180,
            },
          ],
          subtotal: 1000,
          grandTotal: 1180,
        },
      };

      const res = await request(app)
        .post('/api/v1/documents/generate')
        .set('x-api-key', validApiKey)
        .set('x-tenant-id', 'tenant_sync_test')
        .send(invoicePayload);

      // Should return 202 Accepted with isSync: false instead of crashing
      expect(res.status).toBe(202);
      expect(res.body.isSync).toBe(false);
      expect(res.body.status).toBe('queued');
      expect(res.body.statusUrl).toBeDefined();
    } finally {
      (env as { MAX_SYNC_RENDER_CONCURRENCY: number }).MAX_SYNC_RENDER_CONCURRENCY = originalMax;
    }
  });
});
