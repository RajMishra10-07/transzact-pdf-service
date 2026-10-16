import { DocumentAuditRecord } from '../../domain/document.js';
import { dbPool } from '../client.js';

export interface IDocumentAuditRepository {
  createAuditRecord(record: {
    documentId: string;
    tenantId: string;
    action: 'generated' | 'downloaded' | 'verified' | 'archived';
    sha256Checksum: string;
    performedBy: string;
    ipAddress?: string | null;
  }): Promise<DocumentAuditRecord>;

  findAuditRecords(tenantId: string, documentId: string): Promise<DocumentAuditRecord[]>;
}

export class PgDocumentAuditRepository implements IDocumentAuditRepository {
  public async createAuditRecord(record: {
    documentId: string;
    tenantId: string;
    action: 'generated' | 'downloaded' | 'verified' | 'archived';
    sha256Checksum: string;
    performedBy: string;
    ipAddress?: string | null;
  }): Promise<DocumentAuditRecord> {
    const query = `
      INSERT INTO document_audit_records (
        document_id, tenant_id, action, sha256_checksum, performed_by, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const res = await dbPool.query(query, [
      record.documentId,
      record.tenantId,
      record.action,
      record.sha256Checksum,
      record.performedBy,
      record.ipAddress || null,
    ]);
    return this.mapAuditRow(res.rows[0]);
  }

  public async findAuditRecords(tenantId: string, documentId: string): Promise<DocumentAuditRecord[]> {
    const res = await dbPool.query(
      'SELECT * FROM document_audit_records WHERE tenant_id = $1 AND document_id = $2 ORDER BY id DESC',
      [tenantId, documentId]
    );
    return res.rows.map(this.mapAuditRow);
  }

  private mapAuditRow(row: Record<string, unknown>): DocumentAuditRecord {
    return {
      id: Number(row.id),
      documentId: row.document_id as string,
      tenantId: row.tenant_id as string,
      action: row.action as 'generated' | 'downloaded' | 'verified' | 'archived',
      sha256Checksum: row.sha256_checksum as string,
      performedBy: row.performed_by as string,
      ipAddress: (row.ip_address as string) || null,
      createdAt: new Date(row.created_at as string),
    };
  }
}

export class InMemoryDocumentAuditRepository implements IDocumentAuditRepository {
  private records: DocumentAuditRecord[] = [];
  private currentId = 1;

  public async createAuditRecord(record: {
    documentId: string;
    tenantId: string;
    action: 'generated' | 'downloaded' | 'verified' | 'archived';
    sha256Checksum: string;
    performedBy: string;
    ipAddress?: string | null;
  }): Promise<DocumentAuditRecord> {
    const newRecord: DocumentAuditRecord = {
      id: this.currentId++,
      documentId: record.documentId,
      tenantId: record.tenantId,
      action: record.action,
      sha256Checksum: record.sha256Checksum,
      performedBy: record.performedBy,
      ipAddress: record.ipAddress || null,
      createdAt: new Date(),
    };
    this.records.push(newRecord);
    return newRecord;
  }

  public async findAuditRecords(tenantId: string, documentId: string): Promise<DocumentAuditRecord[]> {
    return this.records
      .filter((r) => r.tenantId === tenantId && r.documentId === documentId)
      .sort((a, b) => b.id - a.id);
  }
}
