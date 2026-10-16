import { DocumentRecord, DocumentType, GenerationJob } from '../../domain/document.js';
import { GenerationJobStatus } from '../../domain/job-state.js';
import { dbPool } from '../client.js';
import { generateUuid } from '../../utils/ids.js';

export interface IDocumentRepository {
  createGenerationJob(job: {
    id?: string;
    tenantId: string;
    documentId: string;
    documentType: DocumentType;
    status: GenerationJobStatus;
    idempotencyKey?: string | null;
    inputHash: string;
    inputPayload: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
  }): Promise<GenerationJob>;

  findGenerationJobById(id: string): Promise<GenerationJob | null>;
  findGenerationJobByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<GenerationJob | null>;
  updateGenerationJobStatus(id: string, status: GenerationJobStatus, errorMessage?: string | null): Promise<void>;

  createDocument(doc: {
    id?: string;
    tenantId: string;
    documentId: string;
    jobId: string;
    documentType: DocumentType;
    templateVersion: string;
    storageKey: string;
    fileSizeBytes: number;
    sha256Checksum: string;
    renderDurationMs: number;
  }): Promise<DocumentRecord>;

  findDocumentByDocumentId(tenantId: string, documentType: DocumentType, documentId: string): Promise<DocumentRecord | null>;
  findDocumentById(id: string): Promise<DocumentRecord | null>;
}

export class PgDocumentRepository implements IDocumentRepository {
  public async createGenerationJob(job: {
    id?: string;
    tenantId: string;
    documentId: string;
    documentType: DocumentType;
    status: GenerationJobStatus;
    idempotencyKey?: string | null;
    inputHash: string;
    inputPayload: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
  }): Promise<GenerationJob> {
    const id = job.id || generateUuid();
    const query = `
      INSERT INTO generation_jobs (
        id, tenant_id, document_id, document_type, status, idempotency_key,
        input_hash, input_payload, priority, max_attempts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    try {
      const res = await dbPool.query(query, [
        id,
        job.tenantId,
        job.documentId,
        job.documentType,
        job.status,
        job.idempotencyKey || null,
        job.inputHash,
        JSON.stringify(job.inputPayload),
        job.priority || 0,
        job.maxAttempts || 3,
      ]);
      return this.mapJobRow(res.rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505' && job.idempotencyKey) {
        const existing = await this.findGenerationJobByIdempotencyKey(job.tenantId, job.idempotencyKey);
        if (existing) return existing;
      }
      throw err;
    }
  }

  public async findGenerationJobById(id: string): Promise<GenerationJob | null> {
    const res = await dbPool.query('SELECT * FROM generation_jobs WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapJobRow(res.rows[0]);
  }

  public async findGenerationJobByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<GenerationJob | null> {
    const res = await dbPool.query(
      'SELECT * FROM generation_jobs WHERE tenant_id = $1 AND idempotency_key = $2',
      [tenantId, idempotencyKey]
    );
    if (res.rows.length === 0) return null;
    return this.mapJobRow(res.rows[0]);
  }

  public async updateGenerationJobStatus(id: string, status: GenerationJobStatus, errorMessage?: string | null): Promise<void> {
    const isCompleted = status === 'completed';
    const isStarted = status === 'processing';
    let query = `UPDATE generation_jobs SET status = $1, error_message = $2, updated_at = NOW()`;
    const params: unknown[] = [status, errorMessage || null];

    if (isStarted) {
      query += `, started_at = NOW()`;
    }
    if (isCompleted || status === 'failed') {
      query += `, completed_at = NOW()`;
    }

    query += ` WHERE id = $${params.length + 1}`;
    params.push(id);
    await dbPool.query(query, params);
  }

  public async createDocument(doc: {
    id?: string;
    tenantId: string;
    documentId: string;
    jobId: string;
    documentType: DocumentType;
    templateVersion: string;
    storageKey: string;
    fileSizeBytes: number;
    sha256Checksum: string;
    renderDurationMs: number;
  }): Promise<DocumentRecord> {
    const id = doc.id || generateUuid();
    const query = `
      INSERT INTO documents (
        id, tenant_id, document_id, job_id, document_type, template_version,
        storage_key, file_size_bytes, sha256_checksum, render_duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, document_type, document_id)
      DO UPDATE SET
        job_id = EXCLUDED.job_id,
        storage_key = EXCLUDED.storage_key,
        file_size_bytes = EXCLUDED.file_size_bytes,
        sha256_checksum = EXCLUDED.sha256_checksum,
        render_duration_ms = EXCLUDED.render_duration_ms,
        created_at = NOW()
      RETURNING *
    `;
    const res = await dbPool.query(query, [
      id,
      doc.tenantId,
      doc.documentId,
      doc.jobId,
      doc.documentType,
      doc.templateVersion,
      doc.storageKey,
      doc.fileSizeBytes,
      doc.sha256Checksum,
      doc.renderDurationMs,
    ]);
    return this.mapDocRow(res.rows[0]);
  }

  public async findDocumentByDocumentId(
    tenantId: string,
    documentType: DocumentType,
    documentId: string
  ): Promise<DocumentRecord | null> {
    const res = await dbPool.query(
      'SELECT * FROM documents WHERE tenant_id = $1 AND document_type = $2 AND document_id = $3',
      [tenantId, documentType, documentId]
    );
    if (res.rows.length === 0) return null;
    return this.mapDocRow(res.rows[0]);
  }

  public async findDocumentById(id: string): Promise<DocumentRecord | null> {
    const res = await dbPool.query('SELECT * FROM documents WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapDocRow(res.rows[0]);
  }

  // Row mappers
  private mapJobRow(row: Record<string, unknown>): GenerationJob {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      documentId: row.document_id as string,
      documentType: row.document_type as DocumentType,
      status: row.status as GenerationJobStatus,
      idempotencyKey: (row.idempotency_key as string) || null,
      inputHash: row.input_hash as string,
      inputPayload: typeof row.input_payload === 'string' ? JSON.parse(row.input_payload) : (row.input_payload as Record<string, unknown>),
      priority: Number(row.priority || 0),
      attempts: Number(row.attempts || 0),
      maxAttempts: Number(row.max_attempts || 3),
      errorMessage: (row.error_message as string) || null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      startedAt: row.started_at ? new Date(row.started_at as string) : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }

  private mapDocRow(row: Record<string, unknown>): DocumentRecord {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      documentId: row.document_id as string,
      jobId: row.job_id as string,
      documentType: row.document_type as DocumentType,
      templateVersion: row.template_version as string,
      storageKey: row.storage_key as string,
      fileSizeBytes: Number(row.file_size_bytes),
      sha256Checksum: row.sha256_checksum as string,
      renderDurationMs: Number(row.render_duration_ms),
      createdAt: new Date(row.created_at as string),
    };
  }
}

/**
 * In-memory repository implementation for automated Vitest testing or standalone mock runs
 */
export class InMemoryDocumentRepository implements IDocumentRepository {
  private jobs = new Map<string, GenerationJob>();
  private documents = new Map<string, DocumentRecord>();

  public async createGenerationJob(job: {
    id?: string;
    tenantId: string;
    documentId: string;
    documentType: DocumentType;
    status: GenerationJobStatus;
    idempotencyKey?: string | null;
    inputHash: string;
    inputPayload: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
  }): Promise<GenerationJob> {
    if (job.idempotencyKey) {
      const existing = await this.findGenerationJobByIdempotencyKey(job.tenantId, job.idempotencyKey);
      if (existing) return existing;
    }

    const id = job.id || generateUuid();
    const newJob: GenerationJob = {
      id,
      tenantId: job.tenantId,
      documentId: job.documentId,
      documentType: job.documentType,
      status: job.status,
      idempotencyKey: job.idempotencyKey || null,
      inputHash: job.inputHash,
      inputPayload: job.inputPayload,
      priority: job.priority || 0,
      attempts: 0,
      maxAttempts: job.maxAttempts || 3,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobs.set(id, newJob);
    return newJob;
  }

  public async findGenerationJobById(id: string): Promise<GenerationJob | null> {
    return this.jobs.get(id) || null;
  }

  public async findGenerationJobByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<GenerationJob | null> {
    for (const job of this.jobs.values()) {
      if (job.tenantId === tenantId && job.idempotencyKey === idempotencyKey) {
        return job;
      }
    }
    return null;
  }

  public async updateGenerationJobStatus(id: string, status: GenerationJobStatus, errorMessage?: string | null): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      job.errorMessage = errorMessage || null;
      job.updatedAt = new Date();
      if (status === 'processing') job.startedAt = new Date();
      if (status === 'completed' || status === 'failed') job.completedAt = new Date();
    }
  }

  public async createDocument(doc: {
    id?: string;
    tenantId: string;
    documentId: string;
    jobId: string;
    documentType: DocumentType;
    templateVersion: string;
    storageKey: string;
    fileSizeBytes: number;
    sha256Checksum: string;
    renderDurationMs: number;
  }): Promise<DocumentRecord> {
    const id = doc.id || generateUuid();
    const newDoc: DocumentRecord = {
      id,
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      jobId: doc.jobId,
      documentType: doc.documentType,
      templateVersion: doc.templateVersion,
      storageKey: doc.storageKey,
      fileSizeBytes: doc.fileSizeBytes,
      sha256Checksum: doc.sha256Checksum,
      renderDurationMs: doc.renderDurationMs,
      createdAt: new Date(),
    };
    const key = `${doc.tenantId}:${doc.documentType}:${doc.documentId}`;
    this.documents.set(key, newDoc);
    this.documents.set(id, newDoc);
    return newDoc;
  }

  public async findDocumentByDocumentId(tenantId: string, documentType: DocumentType, documentId: string): Promise<DocumentRecord | null> {
    const key = `${tenantId}:${documentType}:${documentId}`;
    return this.documents.get(key) || null;
  }

  public async findDocumentById(id: string): Promise<DocumentRecord | null> {
    return this.documents.get(id) || null;
  }
}
