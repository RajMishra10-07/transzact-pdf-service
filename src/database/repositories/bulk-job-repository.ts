import { BulkJob, BulkJobItem } from '../../domain/document.js';
import { BulkJobStatus, GenerationJobStatus } from '../../domain/job-state.js';
import { dbPool } from '../client.js';
import { generateUuid } from '../../utils/ids.js';

export interface IBulkJobRepository {
  createBulkJob(job: {
    id?: string;
    tenantId: string;
    totalDocuments: number;
  }): Promise<BulkJob>;

  createBulkJobItems(
    items: Array<{
      id?: string;
      bulkJobId: string;
      tenantId: string;
      documentId: string;
      generationJobId: string;
      orderIndex: number;
    }>
  ): Promise<BulkJobItem[]>;

  findBulkJobById(id: string): Promise<BulkJob | null>;
  findBulkJobItems(bulkJobId: string): Promise<BulkJobItem[]>;
  updateBulkJobItemStatus(
    bulkJobId: string,
    generationJobId: string,
    status: GenerationJobStatus,
    errorMessage?: string | null
  ): Promise<void>;
  updateBulkJobStatus(
    id: string,
    status: BulkJobStatus,
    archiveInfo?: { storageKey: string; sizeBytes: number; checksum: string }
  ): Promise<void>;
  recalculateBulkJobProgress(id: string): Promise<BulkJob>;
}

export class PgBulkJobRepository implements IBulkJobRepository {
  public async createBulkJob(job: { id?: string; tenantId: string; totalDocuments: number }): Promise<BulkJob> {
    const id = job.id || generateUuid();
    const query = `
      INSERT INTO bulk_jobs (
        id, tenant_id, status, total_documents, queued_documents,
        processing_documents, completed_documents, failed_documents
      ) VALUES ($1, $2, 'queued', $3, $3, 0, 0, 0)
      RETURNING *
    `;
    const res = await dbPool.query(query, [id, job.tenantId, job.totalDocuments]);
    return this.mapBulkRow(res.rows[0]);
  }

  public async createBulkJobItems(
    items: Array<{
      id?: string;
      bulkJobId: string;
      tenantId: string;
      documentId: string;
      generationJobId: string;
      orderIndex: number;
    }>
  ): Promise<BulkJobItem[]> {
    const results: BulkJobItem[] = [];
    for (const item of items) {
      const id = item.id || generateUuid();
      const query = `
        INSERT INTO bulk_job_items (
          id, bulk_job_id, tenant_id, document_id, generation_job_id, status, order_index
        ) VALUES ($1, $2, $3, $4, $5, 'queued', $6)
        RETURNING *
      `;
      const res = await dbPool.query(query, [
        id,
        item.bulkJobId,
        item.tenantId,
        item.documentId,
        item.generationJobId,
        item.orderIndex,
      ]);
      results.push(this.mapItemRow(res.rows[0]));
    }
    return results;
  }

  public async findBulkJobById(id: string): Promise<BulkJob | null> {
    const res = await dbPool.query('SELECT * FROM bulk_jobs WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapBulkRow(res.rows[0]);
  }

  public async findBulkJobItems(bulkJobId: string): Promise<BulkJobItem[]> {
    const res = await dbPool.query(
      'SELECT * FROM bulk_job_items WHERE bulk_job_id = $1 ORDER BY order_index ASC',
      [bulkJobId]
    );
    return res.rows.map(this.mapItemRow);
  }

  public async updateBulkJobItemStatus(
    bulkJobId: string,
    generationJobId: string,
    status: GenerationJobStatus,
    errorMessage?: string | null
  ): Promise<void> {
    await dbPool.query(
      `UPDATE bulk_job_items
       SET status = $1, error_message = $2, updated_at = NOW()
       WHERE bulk_job_id = $3 AND generation_job_id = $4`,
      [status, errorMessage || null, bulkJobId, generationJobId]
    );
  }

  public async updateBulkJobStatus(
    id: string,
    status: BulkJobStatus,
    archiveInfo?: { storageKey: string; sizeBytes: number; checksum: string }
  ): Promise<void> {
    let query = `UPDATE bulk_jobs SET status = $1, updated_at = NOW()`;
    const params: unknown[] = [status];

    if (archiveInfo) {
      query += `, archive_storage_key = $2, archive_size_bytes = $3, archive_checksum = $4, completed_at = NOW()`;
      params.push(archiveInfo.storageKey, archiveInfo.sizeBytes, archiveInfo.checksum);
    }

    query += ` WHERE id = $${params.length + 1}`;
    params.push(id);
    await dbPool.query(query, params);
  }

  /**
   * Idempotently recalculates progress counts and status from bulk_job_items.
   * Completely immune to concurrent increments and retry double-counting.
   */
  public async recalculateBulkJobProgress(id: string): Promise<BulkJob> {
    const query = `
      UPDATE bulk_jobs
      SET
        completed_documents = sub.completed,
        failed_documents = sub.failed,
        processing_documents = sub.processing,
        queued_documents = sub.queued,
        status = CASE
          WHEN (sub.completed + sub.failed) >= total_documents AND sub.failed = 0 THEN 'completed'
          WHEN (sub.completed + sub.failed) >= total_documents THEN 'partially_completed'
          ELSE 'processing'
        END,
        completed_at = CASE
          WHEN (sub.completed + sub.failed) >= total_documents AND completed_at IS NULL THEN NOW()
          ELSE completed_at
        END,
        updated_at = NOW()
      FROM (
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          COUNT(*) FILTER (WHERE status = 'processing') AS processing,
          COUNT(*) FILTER (WHERE status = 'queued') AS queued
        FROM bulk_job_items
        WHERE bulk_job_id = $1
      ) sub
      WHERE bulk_jobs.id = $1
      RETURNING bulk_jobs.*
    `;
    const res = await dbPool.query(query, [id]);
    return this.mapBulkRow(res.rows[0]);
  }

  private mapBulkRow(row: Record<string, unknown>): BulkJob {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      status: row.status as BulkJobStatus,
      totalDocuments: Number(row.total_documents),
      queuedDocuments: Number(row.queued_documents),
      processingDocuments: Number(row.processing_documents),
      completedDocuments: Number(row.completed_documents),
      failedDocuments: Number(row.failed_documents),
      archiveStorageKey: (row.archive_storage_key as string) || null,
      archiveSizeBytes: row.archive_size_bytes ? Number(row.archive_size_bytes) : null,
      archiveChecksum: (row.archive_checksum as string) || null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }

  private mapItemRow(row: Record<string, unknown>): BulkJobItem {
    return {
      id: row.id as string,
      bulkJobId: row.bulk_job_id as string,
      tenantId: row.tenant_id as string,
      documentId: row.document_id as string,
      generationJobId: row.generation_job_id as string,
      status: row.status as GenerationJobStatus,
      orderIndex: Number(row.order_index),
      errorMessage: (row.error_message as string) || null,
    };
  }
}

export class InMemoryBulkJobRepository implements IBulkJobRepository {
  private bulkJobs = new Map<string, BulkJob>();
  private bulkItems = new Map<string, BulkJobItem[]>();

  public async createBulkJob(job: { id?: string; tenantId: string; totalDocuments: number }): Promise<BulkJob> {
    const id = job.id || generateUuid();
    const newJob: BulkJob = {
      id,
      tenantId: job.tenantId,
      status: 'queued',
      totalDocuments: job.totalDocuments,
      queuedDocuments: job.totalDocuments,
      processingDocuments: 0,
      completedDocuments: 0,
      failedDocuments: 0,
      archiveStorageKey: null,
      archiveSizeBytes: null,
      archiveChecksum: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.bulkJobs.set(id, newJob);
    this.bulkItems.set(id, []);
    return newJob;
  }

  public async createBulkJobItems(
    items: Array<{
      id?: string;
      bulkJobId: string;
      tenantId: string;
      documentId: string;
      generationJobId: string;
      orderIndex: number;
    }>
  ): Promise<BulkJobItem[]> {
    const list: BulkJobItem[] = [];
    for (const item of items) {
      const id = item.id || generateUuid();
      const newItem: BulkJobItem = {
        id,
        bulkJobId: item.bulkJobId,
        tenantId: item.tenantId,
        documentId: item.documentId,
        generationJobId: item.generationJobId,
        status: 'queued',
        orderIndex: item.orderIndex,
        errorMessage: null,
      };
      list.push(newItem);
    }
    if (items.length > 0) {
      const bulkId = items[0].bulkJobId;
      const current = this.bulkItems.get(bulkId) || [];
      this.bulkItems.set(bulkId, [...current, ...list]);
    }
    return list;
  }

  public async findBulkJobById(id: string): Promise<BulkJob | null> {
    return this.bulkJobs.get(id) || null;
  }

  public async findBulkJobItems(bulkJobId: string): Promise<BulkJobItem[]> {
    return this.bulkItems.get(bulkJobId) || [];
  }

  public async updateBulkJobItemStatus(
    bulkJobId: string,
    generationJobId: string,
    status: GenerationJobStatus,
    errorMessage?: string | null
  ): Promise<void> {
    const items = this.bulkItems.get(bulkJobId) || [];
    const item = items.find((i) => i.generationJobId === generationJobId);
    if (item) {
      item.status = status;
      item.errorMessage = errorMessage || null;
    }
  }

  public async updateBulkJobStatus(
    id: string,
    status: BulkJobStatus,
    archiveInfo?: { storageKey: string; sizeBytes: number; checksum: string }
  ): Promise<void> {
    const job = this.bulkJobs.get(id);
    if (job) {
      job.status = status;
      job.updatedAt = new Date();
      if (archiveInfo) {
        job.archiveStorageKey = archiveInfo.storageKey;
        job.archiveSizeBytes = archiveInfo.sizeBytes;
        job.archiveChecksum = archiveInfo.checksum;
        job.completedAt = new Date();
      }
    }
  }

  public async recalculateBulkJobProgress(id: string): Promise<BulkJob> {
    const job = this.bulkJobs.get(id);
    if (!job) throw new Error(`Bulk job not found: ${id}`);

    const items = this.bulkItems.get(id) || [];
    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const processing = items.filter((i) => i.status === 'processing').length;
    const queued = items.filter((i) => i.status === 'queued').length;

    job.completedDocuments = completed;
    job.failedDocuments = failed;
    job.processingDocuments = processing;
    job.queuedDocuments = queued;

    const totalProcessed = completed + failed;
    if (totalProcessed >= job.totalDocuments && job.totalDocuments > 0) {
      job.status = failed === 0 ? 'completed' : 'partially_completed';
      if (!job.completedAt) job.completedAt = new Date();
    } else if (processing > 0 || completed > 0 || failed > 0) {
      job.status = 'processing';
    }
    job.updatedAt = new Date();
    return job;
  }
}
