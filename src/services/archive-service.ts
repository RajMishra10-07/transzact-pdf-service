import archiver from 'archiver';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import { APP_CONSTANTS } from '../config/constants.js';
import { getBulkJobRepository, getDocumentRepository } from '../database/repositories/repository-factory.js';
import { getStorageService } from '../storage/storage-factory.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../domain/errors.js';

export interface BulkManifestItem {
  documentId: string;
  status: string;
  sha256Checksum?: string;
  fileSizeBytes?: number;
  storageKey?: string;
  errorMessage?: string | null;
}

export interface BulkManifest {
  bulkJobId: string;
  tenantId: string;
  generatedAt: string;
  totalDocuments: number;
  successfulDocuments: number;
  failedDocuments: number;
  documents: BulkManifestItem[];
}

export class ArchiveService {
  /**
   * Generates a manifest of all documents within a bulk job.
   */
  public async generateManifest(bulkJobId: string): Promise<BulkManifest> {
    const bulkRepo = getBulkJobRepository();
    const docRepo = getDocumentRepository();

    const bulkJob = await bulkRepo.findBulkJobById(bulkJobId);
    if (!bulkJob) {
      throw new NotFoundError(`Bulk job not found: ${bulkJobId}`);
    }

    const items = await bulkRepo.findBulkJobItems(bulkJobId);
    const manifestItems: BulkManifestItem[] = [];

    for (const item of items) {
      if (item.status === 'completed') {
        const doc =
          (await docRepo.findDocumentByDocumentId(item.tenantId, 'invoice', item.documentId)) ||
          (await docRepo.findDocumentByDocumentId(item.tenantId, 'purchase_order', item.documentId));
        manifestItems.push({
          documentId: item.documentId,
          status: 'completed',
          sha256Checksum: doc?.sha256Checksum,
          fileSizeBytes: doc?.fileSizeBytes,
          storageKey: doc?.storageKey,
        });
      } else {
        manifestItems.push({
          documentId: item.documentId,
          status: item.status,
          errorMessage: item.errorMessage,
        });
      }
    }

    return {
      bulkJobId,
      tenantId: bulkJob.tenantId,
      generatedAt: new Date().toISOString(),
      totalDocuments: bulkJob.totalDocuments,
      successfulDocuments: bulkJob.completedDocuments,
      failedDocuments: bulkJob.failedDocuments,
      documents: manifestItems,
    };
  }

  /**
   * Streams a ZIP archive combining all successful PDFs and a manifest.json.
   * Completely avoids accumulating PDFs or ZIP bytes in memory.
   */
  public async createArchive(
    bulkJobId: string,
    tenantId: string
  ): Promise<{ storageKey: string; sizeBytes: number; checksum: string }> {
    const bulkRepo = getBulkJobRepository();
    const docRepo = getDocumentRepository();
    const storage = getStorageService();

    logger.info({ bulkJobId, tenantId }, 'Starting pure streaming ZIP archive creation');
    const bulkJob = await bulkRepo.findBulkJobById(bulkJobId);
    if (!bulkJob) {
      throw new NotFoundError(`Bulk job not found: ${bulkJobId}`);
    }

    const manifest = await this.generateManifest(bulkJobId);
    const items = await bulkRepo.findBulkJobItems(bulkJobId);

    const archiveKey = APP_CONSTANTS.STORAGE_KEYS.ZIP(tenantId, bulkJobId);
    const manifestKey = APP_CONSTANTS.STORAGE_KEYS.MANIFEST(tenantId, bulkJobId);

    // Save standalone manifest.json
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    await storage.save(manifestKey, manifestBuffer, 'application/json');

    const archive = archiver('zip', { zlib: { level: 6 } });
    const passthrough = new PassThrough();
    const hash = crypto.createHash('sha256');
    let totalSizeBytes = 0;

    // Stream hasher: updates checksum on-the-fly without keeping data in RAM
    passthrough.on('data', (chunk) => {
      totalSizeBytes += chunk.length;
      hash.update(chunk);
    });

    archive.pipe(passthrough);

    // Pipe streaming passthrough directly to object storage
    const savePromise = storage.save(archiveKey, passthrough, 'application/zip');

    try {
      // Append manifest.json into ZIP root
      archive.append(manifestBuffer, { name: 'manifest.json' });

      // Append each completed PDF as a stream (never buffering entire PDF in RAM)
      for (const item of items) {
        if (item.status === 'completed') {
          const doc =
            (await docRepo.findDocumentByDocumentId(item.tenantId, 'invoice', item.documentId)) ||
            (await docRepo.findDocumentByDocumentId(item.tenantId, 'purchase_order', item.documentId));
          if (doc) {
            try {
              const pdfStream = await storage.getStream(doc.storageKey);
              const fileName = `${doc.documentType}_${doc.documentId}.pdf`;
              archive.append(pdfStream, { name: fileName });
            } catch (err) {
              logger.warn({ err, documentId: item.documentId }, 'Failed to stream PDF into archive');
            }
          }
        }
      }

      await archive.finalize();
      const saveResult = await savePromise;
      const zipChecksum = hash.digest('hex');

      // Update bulk job record
      const finalStatus = bulkJob.failedDocuments === 0 ? 'completed' : 'partially_completed';
      await bulkRepo.updateBulkJobStatus(bulkJobId, finalStatus, {
        storageKey: archiveKey,
        sizeBytes: saveResult.sizeBytes || totalSizeBytes,
        checksum: zipChecksum,
      });

      logger.info(
        { bulkJobId, sizeBytes: saveResult.sizeBytes || totalSizeBytes, checksum: zipChecksum },
        'Streaming ZIP archive successfully saved and checksummed'
      );

      return {
        storageKey: archiveKey,
        sizeBytes: saveResult.sizeBytes || totalSizeBytes,
        checksum: zipChecksum,
      };
    } catch (err) {
      logger.error({ err, bulkJobId }, 'ZIP archive creation failed; cleaning up incomplete storage file');
      // Clean up partial corrupt archive file from storage
      try {
        await storage.delete(archiveKey);
      } catch (cleanupErr) {
        logger.warn({ cleanupErr }, 'Failed to delete incomplete archive file');
      }
      throw err;
    }
  }
}

export const archiveService = new ArchiveService();
