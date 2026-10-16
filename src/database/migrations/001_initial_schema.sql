-- Initial schema for TranZact PDF Microservice

CREATE TABLE IF NOT EXISTS generation_jobs (
    id UUID PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    document_id VARCHAR(100) NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(200),
    input_hash CHAR(64) NOT NULL,
    input_payload JSONB NOT NULL,
    priority INT DEFAULT 0,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_jobs_tenant_idempotency
ON generation_jobs (tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gen_jobs_status ON generation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_tenant_doc ON generation_jobs (tenant_id, document_type, document_id);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    document_id VARCHAR(100) NOT NULL,
    job_id UUID REFERENCES generation_jobs(id),
    document_type VARCHAR(50) NOT NULL,
    template_version VARCHAR(20) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    sha256_checksum CHAR(64) NOT NULL,
    render_duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_tenant_type_docid
ON documents (tenant_id, document_type, document_id);

CREATE TABLE IF NOT EXISTS bulk_jobs (
    id UUID PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    total_documents INT NOT NULL,
    queued_documents INT NOT NULL,
    processing_documents INT NOT NULL,
    completed_documents INT NOT NULL,
    failed_documents INT NOT NULL,
    archive_storage_key VARCHAR(500),
    archive_size_bytes BIGINT,
    archive_checksum CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bulk_jobs_tenant_status ON bulk_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS bulk_job_items (
    id UUID PRIMARY KEY,
    bulk_job_id UUID NOT NULL REFERENCES bulk_jobs(id) ON DELETE CASCADE,
    tenant_id VARCHAR(100) NOT NULL,
    document_id VARCHAR(100) NOT NULL,
    generation_job_id UUID NOT NULL REFERENCES generation_jobs(id),
    status VARCHAR(50) NOT NULL,
    order_index INT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulk_items_bulk_job_id ON bulk_job_items (bulk_job_id);

CREATE TABLE IF NOT EXISTS document_audit_records (
    id BIGSERIAL PRIMARY KEY,
    document_id VARCHAR(100) NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    sha256_checksum CHAR(64) NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_doc_tenant ON document_audit_records (tenant_id, document_id);
