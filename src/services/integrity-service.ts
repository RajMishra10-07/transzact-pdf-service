import { computeBufferHash } from '../utils/hash.js';
import { getAuditRepository, getDocumentRepository } from '../database/repositories/repository-factory.js';
import { getStorageService } from '../storage/storage-factory.js';
import { IntegrityVerificationError, NotFoundError } from '../domain/errors.js';
import { logger } from '../utils/logger.js';
import { DocumentType } from '../domain/document.js';

export class IntegrityService {
  /**
   * Verifies that the physical PDF stored in object storage matches the recorded SHA-256 checksum in the database.
   */
  public async verifyDocumentIntegrity(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
    performedBy = 'system'
  ): Promise<{ isValid: boolean; storedHash: string; computedHash: string }> {
    const docRepo = getDocumentRepository();
    const doc = await docRepo.findDocumentByDocumentId(tenantId, documentType, documentId);
    if (!doc) {
      throw new NotFoundError(`Document not found: ${documentType}/${documentId}`);
    }

    const storage = getStorageService();
    const pdfBuffer = await storage.getBuffer(doc.storageKey);
    const computedHash = computeBufferHash(pdfBuffer);
    const isValid = computedHash.toLowerCase() === doc.sha256Checksum.toLowerCase();

    // Record audit event
    const auditRepo = getAuditRepository();
    await auditRepo.createAuditRecord({
      documentId,
      tenantId,
      action: 'verified',
      sha256Checksum: computedHash,
      performedBy,
    });

    if (!isValid) {
      logger.error(
        { tenantId, documentId, stored: doc.sha256Checksum, computed: computedHash },
        'Integrity verification failed! PDF bytes have been altered'
      );
      throw new IntegrityVerificationError();
    }

    return { isValid, storedHash: doc.sha256Checksum, computedHash };
  }

  /**
   * Records a generation audit log when a PDF is first rendered and stored.
   */
  public async recordGenerationAudit(
    documentId: string,
    tenantId: string,
    sha256Checksum: string,
    performedBy: string
  ): Promise<void> {
    const auditRepo = getAuditRepository();
    await auditRepo.createAuditRecord({
      documentId,
      tenantId,
      action: 'generated',
      sha256Checksum,
      performedBy,
    });
  }

  /**
   * Records a download audit log.
   */
  public async recordDownloadAudit(
    documentId: string,
    tenantId: string,
    sha256Checksum: string,
    performedBy: string,
    ipAddress?: string
  ): Promise<void> {
    const auditRepo = getAuditRepository();
    await auditRepo.createAuditRecord({
      documentId,
      tenantId,
      action: 'downloaded',
      sha256Checksum,
      performedBy,
      ipAddress,
    });
  }
}

export const integrityService = new IntegrityService();
