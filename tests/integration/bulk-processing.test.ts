import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  setForceInMemoryRepositories,
  getBulkJobRepository,
  getDocumentRepository,
} from '../../src/database/repositories/repository-factory.js';
import { setForceInMemoryQueue } from '../../src/queue/queues.js';
import { setStorageService } from '../../src/storage/storage-factory.js';
import { LocalStorageAdapter } from '../../src/storage/local-storage.js';
import { archiveService } from '../../src/services/archive-service.js';
import { computeBufferHash } from '../../src/utils/hash.js';

describe('Bulk PDF Processing, Aggregation & Resilient Downloads', () => {
  const validApiKey = env.API_KEY;
  const testStorageDir = './data/test_bulk_storage';

  beforeEach(() => {
    setForceInMemoryRepositories(true);
    setForceInMemoryQueue(true);
    setStorageService(new LocalStorageAdapter(testStorageDir));
  });

  it('13 & 14. Should handle partial bulk failures and accurately compute progress', async () => {
    const bulkRepo = getBulkJobRepository();

    // Create a bulk job with 3 documents
    const bulkJob = await bulkRepo.createBulkJob({
      id: 'bulk_partial_01',
      tenantId: 'tenant_alpha',
      totalDocuments: 3,
    });

    expect(bulkJob.status).toBe('queued');
    expect(bulkJob.totalDocuments).toBe(3);

    // Create 3 items
    await bulkRepo.createBulkJobItems([
      { id: 'item_1', bulkJobId: 'bulk_partial_01', tenantId: 'tenant_alpha', documentId: 'D1', generationJobId: 'job_1', orderIndex: 0 },
      { id: 'item_2', bulkJobId: 'bulk_partial_01', tenantId: 'tenant_alpha', documentId: 'D2', generationJobId: 'job_2', orderIndex: 1 },
      { id: 'item_3', bulkJobId: 'bulk_partial_01', tenantId: 'tenant_alpha', documentId: 'D3', generationJobId: 'job_3', orderIndex: 2 },
    ]);

    // Document 1 completes
    await bulkRepo.updateBulkJobItemStatus('bulk_partial_01', 'job_1', 'completed');
    let status = await bulkRepo.recalculateBulkJobProgress('bulk_partial_01');
    expect(status.status).toBe('processing');
    expect(status.completedDocuments).toBe(1);

    // Document 2 fails
    await bulkRepo.updateBulkJobItemStatus('bulk_partial_01', 'job_2', 'failed');
    status = await bulkRepo.recalculateBulkJobProgress('bulk_partial_01');
    expect(status.status).toBe('processing');
    expect(status.failedDocuments).toBe(1);

    // Document 3 completes
    await bulkRepo.updateBulkJobItemStatus('bulk_partial_01', 'job_3', 'completed');
    status = await bulkRepo.recalculateBulkJobProgress('bulk_partial_01');

    // All 3 processed: status should reach 'partially_completed'
    expect(status.status).toBe('partially_completed');
    expect(status.completedDocuments).toBe(2);
    expect(status.failedDocuments).toBe(1);
  });

  it('15. Should create streaming ZIP archive with manifest.json and successful PDFs', async () => {
    const bulkRepo = getBulkJobRepository();
    const docRepo = getDocumentRepository();
    const storage = new LocalStorageAdapter(testStorageDir);
    setStorageService(storage);

    const bulkJobId = 'bulk_test_archive_01';
    const tenantId = 'tenant_xyz';

    await bulkRepo.createBulkJob({
      id: bulkJobId,
      tenantId,
      totalDocuments: 2,
    });

    // Seed PDF 1
    const pdf1Bytes = Buffer.from('%PDF-1.4 Mock PDF Invoice 101', 'utf8');
    const pdf1Checksum = computeBufferHash(pdf1Bytes);
    const key1 = `tenants/${tenantId}/documents/invoice/INV-101.pdf`;
    await storage.save(key1, pdf1Bytes, 'application/pdf');

    const genJob1 = await docRepo.createGenerationJob({
      tenantId,
      documentId: 'INV-101',
      documentType: 'invoice',
      status: 'completed',
      inputHash: 'hash1',
      inputPayload: { invoiceNumber: 'INV-101' },
    });

    await docRepo.createDocument({
      tenantId,
      documentId: 'INV-101',
      jobId: genJob1.id,
      documentType: 'invoice',
      templateVersion: '1.0.0',
      storageKey: key1,
      fileSizeBytes: pdf1Bytes.length,
      sha256Checksum: pdf1Checksum,
      renderDurationMs: 1500,
    });

    // Seed PDF 2 (Failed)
    const genJob2 = await docRepo.createGenerationJob({
      tenantId,
      documentId: 'INV-102',
      documentType: 'invoice',
      status: 'failed',
      inputHash: 'hash2',
      inputPayload: { invoiceNumber: 'INV-102' },
    });

    await bulkRepo.createBulkJobItems([
      {
        bulkJobId,
        tenantId,
        documentId: 'INV-101',
        generationJobId: genJob1.id,
        orderIndex: 0,
      },
      {
        bulkJobId,
        tenantId,
        documentId: 'INV-102',
        generationJobId: genJob2.id,
        orderIndex: 1,
      },
    ]);

    await bulkRepo.updateBulkJobItemStatus(bulkJobId, genJob1.id, 'completed');
    await bulkRepo.updateBulkJobItemStatus(bulkJobId, genJob2.id, 'failed', 'Memory threshold exceeded');
    await bulkRepo.recalculateBulkJobProgress(bulkJobId);

    // Create Archive
    const archiveResult = await archiveService.createArchive(bulkJobId, tenantId);
    expect(archiveResult.storageKey).toBe(`tenants/${tenantId}/bulk/${bulkJobId}/archive.zip`);
    expect(archiveResult.sizeBytes).toBeGreaterThan(0);
    expect(archiveResult.checksum).toHaveLength(64);

    // Verify manifest
    const manifest = await archiveService.generateManifest(bulkJobId);
    expect(manifest.bulkJobId).toBe(bulkJobId);
    expect(manifest.successfulDocuments).toBe(1);
    expect(manifest.failedDocuments).toBe(1);
    expect(manifest.documents.length).toBe(2);

    const doc1 = manifest.documents.find((d) => d.documentId === 'INV-101');
    expect(doc1?.status).toBe('completed');
    expect(doc1?.sha256Checksum).toBe(pdf1Checksum);

    const doc2 = manifest.documents.find((d) => d.documentId === 'INV-102');
    expect(doc2?.status).toBe('failed');
    expect(doc2?.errorMessage).toBe('Memory threshold exceeded');
  });

  it('20. Should allow repeated ZIP download without regenerating PDFs', async () => {
    const bulkRepo = getBulkJobRepository();
    const storage = new LocalStorageAdapter(testStorageDir);
    setStorageService(storage);

    const bulkJobId = 'bulk_repeat_dl_01';
    const tenantId = 'tenant_dl';
    const archiveKey = `tenants/${tenantId}/bulk/${bulkJobId}/archive.zip`;
    const zipBytes = Buffer.from('PK-MOCK-ZIP-CONTENT-FOR-TEST', 'utf8');

    await storage.save(archiveKey, zipBytes, 'application/zip');

    await bulkRepo.createBulkJob({
      id: bulkJobId,
      tenantId,
      totalDocuments: 1,
    });
    await bulkRepo.updateBulkJobStatus(bulkJobId, 'completed', {
      storageKey: archiveKey,
      sizeBytes: zipBytes.length,
      checksum: computeBufferHash(zipBytes),
    });

    // First download
    const res1 = await request(app)
      .get(`/api/v1/bulk/${bulkJobId}/download`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', tenantId)
      .buffer(true);

    expect(res1.status).toBe(200);
    expect(res1.header['content-type']).toBe('application/zip');

    // Second download (should succeed identically from storage without queueing)
    const res2 = await request(app)
      .get(`/api/v1/bulk/${bulkJobId}/download`)
      .set('x-api-key', validApiKey)
      .set('x-tenant-id', tenantId)
      .buffer(true);

    expect(res2.status).toBe(200);
    const content = res2.body instanceof Buffer ? res2.body.toString('utf8') : res2.text;
    expect(content).toBe('PK-MOCK-ZIP-CONTENT-FOR-TEST');
  });
});
