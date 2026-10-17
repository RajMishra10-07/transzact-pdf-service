import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { env, envSchema, INSECURE_DEFAULT_API_KEY, INSECURE_DEFAULT_JWT_SECRET } from '../../src/config/env.js';
import {
  setForceInMemoryRepositories,
  getDocumentRepository,
} from '../../src/database/repositories/repository-factory.js';
import { setForceInMemoryQueue, InMemoryQueueManager } from '../../src/queue/queues.js';
import { APP_CONSTANTS } from '../../src/config/constants.js';
import { setStorageService, getStorageService } from '../../src/storage/storage-factory.js';
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

  it('Defect 8: Production startup refuses if JWT_SECRET or API_KEY is missing, default, or under 32 chars', () => {
    const baseProductionEnv = {
      NODE_ENV: 'production' as const,
      PORT: 4000,
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/erp_pdf_service',
      REDIS_URL: 'redis://localhost:6379',
      STORAGE_BACKEND: 'local' as const,
      JWT_SECRET: 'a-sufficiently-long-production-jwt-secret-min-32-chars',
      API_KEY: 'a-sufficiently-long-production-api-key-min-32-chars',
    };

    // Valid production config should parse successfully
    const validResult = envSchema.safeParse(baseProductionEnv);
    expect(validResult.success).toBe(true);

    // Missing JWT_SECRET
    const missingJwt = envSchema.safeParse({ ...baseProductionEnv, JWT_SECRET: '' });
    expect(missingJwt.success).toBe(false);
    if (!missingJwt.success) {
      expect(missingJwt.error.errors.some(e => e.message.includes('JWT_SECRET is missing'))).toBe(true);
    }

    // Default placeholder JWT_SECRET
    const defaultJwt = envSchema.safeParse({ ...baseProductionEnv, JWT_SECRET: INSECURE_DEFAULT_JWT_SECRET });
    expect(defaultJwt.success).toBe(false);
    if (!defaultJwt.success) {
      expect(defaultJwt.error.errors.some(e => e.message.includes('JWT_SECRET cannot equal the public default value'))).toBe(true);
    }

    // Short JWT_SECRET (< 32 chars)
    const shortJwt = envSchema.safeParse({ ...baseProductionEnv, JWT_SECRET: 'too-short-jwt-secret' });
    expect(shortJwt.success).toBe(false);
    if (!shortJwt.success) {
      expect(shortJwt.error.errors.some(e => e.message.includes('JWT_SECRET must be at least 32 characters'))).toBe(true);
    }

    // Missing API_KEY
    const missingApiKey = envSchema.safeParse({ ...baseProductionEnv, API_KEY: '' });
    expect(missingApiKey.success).toBe(false);
    if (!missingApiKey.success) {
      expect(missingApiKey.error.errors.some(e => e.message.includes('API_KEY is missing'))).toBe(true);
    }

    // Default placeholder API_KEY
    const defaultApiKey = envSchema.safeParse({ ...baseProductionEnv, API_KEY: INSECURE_DEFAULT_API_KEY });
    expect(defaultApiKey.success).toBe(false);
    if (!defaultApiKey.success) {
      expect(defaultApiKey.error.errors.some(e => e.message.includes('API_KEY cannot equal the public default value'))).toBe(true);
    }

    // Short API_KEY (< 32 chars)
    const shortApiKey = envSchema.safeParse({ ...baseProductionEnv, API_KEY: 'too-short-api-key' });
    expect(shortApiKey.success).toBe(false);
    if (!shortApiKey.success) {
      expect(shortApiKey.error.errors.some(e => e.message.includes('API_KEY must be at least 32 characters'))).toBe(true);
    }

    // Defaults ARE allowed in development
    const devResult = envSchema.safeParse({
      NODE_ENV: 'development' as const,
      JWT_SECRET: INSECURE_DEFAULT_JWT_SECRET,
      API_KEY: INSECURE_DEFAULT_API_KEY,
    });
    expect(devResult.success).toBe(true);
  });

  it('Defect 9: Single-job latency SLA is preserved by prioritizing single requests (Priority 1) ahead of bulk items (Priority 10)', async () => {
    const queueManager = new InMemoryQueueManager();

    // Enqueue 5 bulk jobs (bulkJobId defined)
    for (let i = 1; i <= 5; i++) {
      await queueManager.addRenderJob({
        jobId: `bulk_item_${i}`,
        tenantId: 'tenant_alpha',
        documentId: `INV-BULK-${i}`,
        documentType: 'invoice',
        inputPayload: { id: i },
        bulkJobId: 'bulk_batch_001',
      });
    }

    // Now an urgent single document request arrives (bulkJobId is undefined)
    await queueManager.addRenderJob({
      jobId: 'urgent_single_job_999',
      tenantId: 'tenant_alpha',
      documentId: 'INV-URGENT-999',
      documentType: 'invoice',
      inputPayload: { id: 999 },
    });

    const pendingJobs = queueManager.getPendingRenderJobs();
    expect(pendingJobs.length).toBe(6);

    // The urgent single job should jump to index 0 with priority 1 (HIGH)
    expect(pendingJobs[0].jobId).toBe('urgent_single_job_999');
    expect(pendingJobs[0].priority).toBe(APP_CONSTANTS.JOB_PRIORITIES.HIGH);

    // Subsequent jobs are the bulk batch with priority 10 (LOW)
    expect(pendingJobs[1].jobId).toBe('bulk_item_1');
    expect(pendingJobs[1].priority).toBe(APP_CONSTANTS.JOB_PRIORITIES.LOW);
  });

  it('Defect 10: Storage download strictly requires tenant context, blocks path traversal and leading slash, and isolates tenants', async () => {
    const storage = getStorageService();
    await storage.save('tenants/tenant_alpha/sample.pdf', Buffer.from('%PDF-1.4 test sample'), 'application/pdf');

    // 1. Missing tenant context -> 403
    const resNoTenant = await request(app)
      .get('/api/v1/storage/download?key=tenants/tenant_alpha/sample.pdf')
      .set('x-api-key', validApiKey);
    expect(resNoTenant.status).toBe(403);
    expect(resNoTenant.body.error.message).toContain('Tenant ID is required');

    // 2. Path traversal with .. -> 403
    const resTraversal = await request(app)
      .get('/api/v1/storage/download?key=tenants/tenant_alpha/../secret.env')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha');
    expect(resTraversal.status).toBe(403);
    expect(resTraversal.body.error.message).toContain('path traversal');

    // 3. Absolute path with leading slash -> 403
    const resLeadingSlash = await request(app)
      .get('/api/v1/storage/download?key=/etc/passwd')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha');
    expect(resLeadingSlash.status).toBe(403);
    expect(resLeadingSlash.body.error.message).toContain('path traversal sequences ("..") and leading slashes');

    // 4. Access key belonging to different tenant -> 403
    const resWrongTenant = await request(app)
      .get('/api/v1/storage/download?key=tenants/tenant_victim/invoice.pdf')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_attacker');
    expect(resWrongTenant.status).toBe(403);
    expect(resWrongTenant.body.error.message).toContain('Access to storage key belongs to a different tenant');

    // 5. Authorized download within tenant boundary -> 200
    const resValid = await request(app)
      .get('/api/v1/storage/download?key=tenants/tenant_alpha/sample.pdf')
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', 'tenant_alpha')
      .buffer(true);
    expect(resValid.status).toBe(200);
    const content = resValid.body instanceof Buffer ? resValid.body.toString('utf8') : resValid.text;
    expect(content).toBe('%PDF-1.4 test sample');
  });
});

