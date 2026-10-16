import { describe, it, expect, beforeEach } from 'vitest';
import {
  setForceInMemoryRepositories,
  getDocumentRepository,
  getAuditRepository,
} from '../../src/database/repositories/repository-factory.js';
import { setStorageService } from '../../src/storage/storage-factory.js';
import { LocalStorageAdapter } from '../../src/storage/local-storage.js';
import { integrityService } from '../../src/services/integrity-service.js';
import { computeBufferHash } from '../../src/utils/hash.js';
import { IntegrityVerificationError } from '../../src/domain/errors.js';
import fs from 'fs';
import path from 'path';

describe('16. PDF Tamper-Evident SHA-256 Integrity Verification', () => {
  const testStorageDir = './data/test_integrity_storage';

  beforeEach(() => {
    setForceInMemoryRepositories(true);
    setStorageService(new LocalStorageAdapter(testStorageDir));
  });

  it('should verify integrity successfully when stored PDF bytes match recorded hash', async () => {
    const docRepo = getDocumentRepository();
    const storage = new LocalStorageAdapter(testStorageDir);
    setStorageService(storage);

    const pdfContent = Buffer.from('%PDF-1.4 Authentic Generated Invoice Content', 'utf8');
    const validChecksum = computeBufferHash(pdfContent);
    const storageKey = 'tenants/tenant_alpha/documents/invoice/INV-001.pdf';

    await storage.save(storageKey, pdfContent, 'application/pdf');

    await docRepo.createDocument({
      tenantId: 'tenant_alpha',
      documentId: 'INV-001',
      jobId: 'job_001',
      documentType: 'invoice',
      templateVersion: '1.0.0',
      storageKey,
      fileSizeBytes: pdfContent.length,
      sha256Checksum: validChecksum,
      renderDurationMs: 2200,
    });

    const result = await integrityService.verifyDocumentIntegrity('tenant_alpha', 'invoice', 'INV-001');
    expect(result.isValid).toBe(true);
    expect(result.computedHash).toBe(validChecksum);
  });

  it('should detect tampering and throw IntegrityVerificationError if PDF bytes are modified', async () => {
    const docRepo = getDocumentRepository();
    const storage = new LocalStorageAdapter(testStorageDir);
    setStorageService(storage);

    const originalContent = Buffer.from('%PDF-1.4 Original Content', 'utf8');
    const originalChecksum = computeBufferHash(originalContent);
    const storageKey = 'tenants/tenant_alpha/documents/invoice/INV-TAMPER.pdf';

    await storage.save(storageKey, originalContent, 'application/pdf');

    await docRepo.createDocument({
      tenantId: 'tenant_alpha',
      documentId: 'INV-TAMPER',
      jobId: 'job_tamper',
      documentType: 'invoice',
      templateVersion: '1.0.0',
      storageKey,
      fileSizeBytes: originalContent.length,
      sha256Checksum: originalChecksum,
      renderDurationMs: 2100,
    });

    // Tamper with the physical file in storage (change 1 character)
    const tamperedContent = Buffer.from('%PDF-1.4 Tampered Content', 'utf8');
    await storage.save(storageKey, tamperedContent, 'application/pdf');

    await expect(
      integrityService.verifyDocumentIntegrity('tenant_alpha', 'invoice', 'INV-TAMPER')
    ).rejects.toThrow(IntegrityVerificationError);
  });

  it('should record append-only audit entries upon verification and downloads', async () => {
    const auditRepo = getAuditRepository();
    await integrityService.recordGenerationAudit('INV-AUDIT', 'tenant_alpha', 'checksum123', 'admin');
    await integrityService.recordDownloadAudit('INV-AUDIT', 'tenant_alpha', 'checksum123', 'client', '127.0.0.1');

    const records = await auditRepo.findAuditRecords('tenant_alpha', 'INV-AUDIT');
    expect(records.length).toBe(2);
    expect(records[0].action).toBe('downloaded');
    expect(records[1].action).toBe('generated');
  });
});
