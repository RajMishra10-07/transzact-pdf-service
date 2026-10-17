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
import { documentService } from '../../src/services/document-service.js';
import { ConflictError, LargeDocumentMemoryError } from '../../src/domain/errors.js';
import { processRenderJob } from '../../src/workers/document-worker.js';
import { UnrecoverableError } from 'bullmq';

describe('Security & Concurrency Defect Regression Tests', () => {
  const validApiKey = env.API_KEY;
  const testStorageDir = './data/test_regression_storage';

  beforeEach(() => {
    setForceInMemoryRepositories(true);
    setForceInMemoryQueue(true);
    setStorageService(new LocalStorageAdapter(testStorageDir));
  });

  it('Defect 1: Tenant ID Spoofing via query parameter must be strictly rejected with 403', async () => {
    // Attacker authenticated as tenant_attacker tries to access tenant_victim data
    const res = await request(app)
      .get('/api/v1/documents/INV-VICTIM-001/download?tenantId=tenant_victim')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_attacker');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Tenant ID mismatch');
  });

  it('Defect 2: Idempotency Key Reuse with DIFFERENT Payload must throw 409 Conflict', async () => {
    const docRepo = getDocumentRepository();

    const initialRequest = {
      documentType: 'invoice' as const,
      documentId: 'INV-IDEMP-CONFLICT-01',
      tenantId: 'tenant_omega',
      idempotencyKey: 'shared_idemp_key_123',
      data: {
        invoiceNumber: 'INV-ORIGINAL',
        invoiceDate: '2026-10-16',
        supplier: {
          name: 'Supplier A',
          addressLine1: 'Road 1',
          city: 'City',
          state: 'State',
          pincode: '123456',
        },
        customer: {
          name: 'Customer A',
          addressLine1: 'Road 2',
          city: 'City',
          state: 'State',
          pincode: '123456',
        },
        items: [{ description: 'Item 1', quantity: 1, unit: 'PCS', unitPrice: 100, taxableAmount: 100, totalAmount: 100 }],
        subtotal: 100,
        grandTotal: 100,
      },
    };

    // First request succeeds and creates job
    const res1 = await documentService.generateDocument(initialRequest);
    expect(res1.status).toBe('queued');

    // Second request with SAME idempotencyKey but DIFFERENT items/data
    const conflictingRequest = {
      ...initialRequest,
      data: {
        ...initialRequest.data,
        subtotal: 99999,
        grandTotal: 99999, // Tampered data
      },
    };

    // Must throw ConflictError (409)
    await expect(documentService.generateDocument(conflictingRequest)).rejects.toThrow(ConflictError);
  });

  it('Defect 3: Deterministic failure (e.g. > 800 items) must throw UnrecoverableError to prevent BullMQ retries', async () => {
    const jobData = {
      jobId: 'job_excessive_fail',
      tenantId: 'tenant_omega',
      documentId: 'INV-EXCESSIVE-ITEMS',
      documentType: 'invoice' as const,
      inputPayload: {
        invoiceNumber: 'INV-EXCESSIVE',
        invoiceDate: '2026-10-16',
        supplier: { name: 'S', addressLine1: 'A', city: 'C', state: 'S', pincode: '123456' },
        customer: { name: 'C', addressLine1: 'A', city: 'C', state: 'S', pincode: '123456' },
        items: Array.from({ length: 850 }, (_, i) => ({
          description: `Item ${i}`,
          quantity: 1,
          unit: 'PCS',
          unitPrice: 10,
          taxableAmount: 10,
          totalAmount: 10,
        })),
        subtotal: 8500,
        grandTotal: 8500,
      },
    };

    const docRepo = getDocumentRepository();
    await docRepo.createGenerationJob({
      id: 'job_excessive_fail',
      tenantId: 'tenant_omega',
      documentId: 'INV-EXCESSIVE-ITEMS',
      documentType: 'invoice',
      status: 'queued',
      inputHash: 'hash_excessive',
      inputPayload: jobData.inputPayload,
    });

    // Process job should throw UnrecoverableError so BullMQ aborts retries
    await expect(processRenderJob(jobData)).rejects.toThrow(UnrecoverableError);

    // Verify job in database is marked failed
    const jobRecord = await docRepo.findGenerationJobById('job_excessive_fail');
    expect(jobRecord?.status).toBe('failed');
    expect(jobRecord?.errorMessage).toContain('exceeding maximum safe limit of 800 items');
  });

  it('Defect 4: HTML Injection in input fields must be auto-escaped by template engine', async () => {
    const { TemplateEngine } = await import('../../src/templates/engine.js');
    TemplateEngine.initialize();

    const maliciousData = {
      invoiceNumber: '<script>alert("XSS-INVOICE")</script>',
      invoiceDate: '2026-10-16',
      supplier: {
        name: '<b>Injected Supplier</b>',
        addressLine1: '<iframe src="file:///etc/passwd">',
        city: 'City',
        state: 'State',
        pincode: '123456',
      },
      customer: {
        name: '<img src=x onerror=alert(1)>',
        addressLine1: 'Road 2',
        city: 'City',
        state: 'State',
        pincode: '123456',
      },
      items: [{ description: '<script>evil()</script>', quantity: 1, unit: 'PCS', unitPrice: 10, taxableAmount: 10, totalAmount: 10 }],
      subtotal: 10,
      grandTotal: 10,
    };

    const renderedHtml = TemplateEngine.render('invoice', maliciousData);

    // Verify unescaped dangerous tags do NOT exist in raw output
    expect(renderedHtml).not.toContain('<script>alert("XSS-INVOICE")</script>');
    expect(renderedHtml).not.toContain('<iframe src="file:///etc/passwd">');
    expect(renderedHtml).not.toContain('<img src=x onerror=alert(1)>');

    // Verify they are safely escaped as entities
    expect(renderedHtml).toContain('&lt;script&gt;alert(&quot;XSS-INVOICE&quot;)&lt;/script&gt;');
    expect(renderedHtml).toContain('&lt;iframe src&#x3D;&quot;file:///etc/passwd&quot;&gt;');
    expect(renderedHtml).toContain('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
  });

  it('Defect 5: Stranded jobs from crashed workers (> 60s) must be recovered and marked failed', async () => {
    const docRepo = getDocumentRepository();
    const staleTime = new Date(Date.now() - 75000); // 75 seconds ago

    const job = await docRepo.createGenerationJob({
      id: 'job_crashed_worker_01',
      tenantId: 'tenant_gamma',
      documentId: 'INV-CRASHED-01',
      documentType: 'invoice',
      status: 'queued',
      inputHash: 'hash_crashed',
      inputPayload: { foo: 'bar' },
    });

    // Worker started job 75 seconds ago and crashed
    await docRepo.updateGenerationJobStatus('job_crashed_worker_01', 'processing');
    const inMemJob = await docRepo.findGenerationJobById('job_crashed_worker_01');
    if (inMemJob) {
      inMemJob.startedAt = staleTime;
    }

    // Querying the job via documentService should trigger stranded job recovery
    const recoveredJob = await documentService.getJob('job_crashed_worker_01');
    expect(recoveredJob.status).toBe('failed');
    expect(recoveredJob.errorMessage).toContain('Worker process terminated or crashed');
  });

  it('Defect 6: Non-admin user from Tenant A cannot access Tenant B resources (Cross-Tenant 403)', async () => {
    // Generate valid JWT for an operator belonging strictly to tenant_attacker
    const { signJwt } = await import('../../src/utils/auth-crypto.js');
    const attackerToken = signJwt({
      sub: 'attacker_user_id',
      email: 'attacker@evilcorp.com',
      role: 'operator',
      tenantId: 'tenant_attacker',
      name: 'Attacker Operator',
    });

    // Attacker attempts to download an invoice belonging to tenant_victim
    const res = await request(app)
      .get('/api/v1/documents/INV-VICTIM-999/download')
      .set('Authorization', `Bearer ${attackerToken}`)
      .set('x-tenant-id', 'tenant_victim');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Cross-tenant access forbidden');
  });

  it('Defect 7: Public unauthenticated signup cannot choose role or tenantId (always viewer and default-tenant)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: 'uninvited_intruder@gmail.com',
        password: 'password123',
        name: 'Intruder',
        role: 'admin',
        tenantId: 'transzact-corp', // Protected enterprise tenant
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('viewer');
    expect(res.body.user.tenantId).toBe('default-tenant');
  });
});
