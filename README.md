# TranZact PDF Microservice

> Production-oriented, memory-isolated, tamper-evident PDF generation microservice for ERP applications.

Built with **Node.js**, **TypeScript**, **Express**, **Puppeteer**, **PostgreSQL**, **Redis & BullMQ**, and **AWS S3 / Local Storage**.

---

## 🌟 Key Architecture Highlights

- **Dual-Mode Rendering**: Synchronous 4.5s deadline with automatic graceful fallback to asynchronous queue.
- **Strict Memory Isolation**: Dedicated worker queue for complex documents (150–800 line items) with concurrency 1, eliminating Chromium out-of-memory crashes.
- **Snapshot Immutability**: Canonical JSON sorting and SHA-256 `input_hash` guarantees data consistency even when ERP database records change mid-generation.
- **Tamper-Evident Security**: Post-render SHA-256 byte hashing, append-only audit tracking in PostgreSQL, and on-download verification.
- **Resilient Bulk Downloads**: Asynchronous batch orchestration (up to 100 documents), partial failure resilience, streaming ZIP archive generation, and HTTP Range (206) resumable downloads.
- **Budget Conscious**: Operates at ₹2,844/month (77% below the ₹12,500/month budget).

---

## 📂 Project Structure

```
transzact-project/
├── .env.example              # Environment variables template
├── Dockerfile                # Production multi-stage Docker container
├── docker-compose.yml        # Orchestration (PostgreSQL, Redis, MinIO, API, Workers)
├── package.json              # Dependencies and execution scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Vitest testing configuration
├── APPROACH.md               # 8-section technical defense document
├── README.md                 # Setup, API usage, and operational guide
├── architecture-diagram.svg  # System architecture diagram
│
├── src/
│   ├── app.ts                # Express setup, Helmet security, rate limiter
│   ├── server.ts             # HTTP server entrypoint & graceful shutdown
│   ├── config/               # Zod-validated environment config & constants
│   ├── domain/               # Domain interfaces, state machines, errors
│   ├── utils/                # Pino logger, canonical JSON hash, UUID generator
│   ├── storage/              # Storage abstraction (Local filesystem & AWS S3)
│   ├── templates/            # Handlebars GST Invoice & Purchase Order templates
│   ├── database/             # PostgreSQL pool, migrations, and repositories
│   ├── queue/                # Redis connection & BullMQ queues
│   ├── services/             # PDF, Document, Bulk, Archive, Integrity, Metrics
│   ├── workers/              # Normal, Large, and Archive BullMQ workers
│   └── api/                  # Controllers, routes, middlewares, Zod schemas
│
├── tests/
│   ├── unit/                 # Zod validation, canonical hash, state machine, integrity
│   ├── integration/          # API endpoints, bulk processing, storage, SSE
│   └── e2e/                  # Real Chromium Puppeteer rendering & 500-item memory safety
│
├── docs/
│   ├── architecture.md       # In-depth architectural design
│   ├── api.md                # REST & SSE API specification
│   ├── capacity-planning.md  # Capacity math, queue depth, memory footprints
│   ├── cost-estimation.md    # Line-by-line AWS cost analysis
│   └── operations.md         # Monitoring, alerting, and failure runbooks
│
└── data/
    └── samples/              # Sample JSON payloads for invoices, POs, and bulk
```

---

## 🚀 Quickstart & Local Setup

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0
- (Optional for full container stack) Docker & Docker Compose

### 1. Installation
```bash
git clone <repo-url>
cd transzact-project
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 3. Run Automated Tests
Execute the comprehensive test suite (all 41 unit, integration, security regression, and real Chromium E2E tests across 11 test suites):
```bash
npm test
```

### 4. Build TypeScript
```bash
npm run build
```

---

## 🐳 Running with Docker Compose (Recommended)

To spin up the complete production-like stack (PostgreSQL 16, Redis 7, MinIO S3 storage, API service, and dedicated workers):

```bash
docker compose up --build -d
```

Verify services are running:
```bash
docker compose ps
```

Access services:
- **API Microservice**: `http://localhost:4000`
- **MinIO Console**: `http://localhost:9001` (User: `minioadmin`, Pass: `minioadminpassword`)
- **PostgreSQL**: `localhost:5432` (`transzact_pdf`)
- **Redis**: `localhost:6379`

To view logs:
```bash
docker compose logs -f api
docker compose logs -f worker-normal
```

To tear down:
```bash
docker compose down -v
```

---

## 💻 Running Standalone in Local Development

If running natively on host (using local filesystem storage adapter):

1. **Start the API Server**:
   ```bash
   npm run dev
   ```
2. **Start the Background Workers** (in a separate terminal):
   ```bash
   npm run dev:worker
   ```

---

## 📡 API Usage & Example Commands

### 1. Health & Readiness
```bash
# Liveness check
curl -X GET http://localhost:4000/health

# Readiness check (Postgres & Redis connectivity)
curl -X GET http://localhost:4000/ready

# Operational metrics
curl -X GET http://localhost:4000/metrics
```

### 2. Generate Single Invoice (Synchronous Option)
```bash
curl -X POST http://localhost:4000/api/v1/documents/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  -d @data/samples/sample_invoice.json
```

### 3. Generate Single Purchase Order
```bash
curl -X POST http://localhost:4000/api/v1/documents/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  -d @data/samples/sample_po.json
```

### 4. Download Generated PDF (with SHA-256 Verification)
```bash
curl -X GET "http://localhost:4000/api/v1/documents/INV-2026-001/download?documentType=invoice&tenantId=tenant-acme" \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  --output invoice_downloaded.pdf
```

### 5. Submit Bulk PDF Generation Batch (Up to 100 Docs)
```bash
curl -X POST http://localhost:4000/api/v1/documents/bulk \
  -H "Content-Type: application/json" \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  -d @data/samples/sample_bulk.json
```

### 6. Monitor Live Progress via Server-Sent Events (SSE)
```bash
curl -N -X GET http://localhost:4000/api/v1/bulk/<BULK_JOB_ID>/events \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme"
```

### 7. Poll Bulk Status
```bash
curl -X GET http://localhost:4000/api/v1/bulk/<BULK_JOB_ID>/status \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme"
```

### 8. Download Completed Bulk ZIP Archive (with Resumable Range Support)
```bash
# Standard download
curl -X GET http://localhost:4000/api/v1/bulk/<BULK_JOB_ID>/download \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  --output bulk_archive.zip

# Resuming an interrupted download from byte 1024 onwards
curl -X GET http://localhost:4000/api/v1/bulk/<BULK_JOB_ID>/download \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme" \
  -H "Range: bytes=1024-" \
  --output resumed_archive.zip
```

### 9. Retrieve Bulk Manifest
```bash
curl -X GET http://localhost:4000/api/v1/bulk/<BULK_JOB_ID>/manifest \
  -H "x-api-key: erp-service-secret-key-change-in-production" \
  -H "x-tenant-id: tenant-acme"
```

---

## 🧪 Testing Summary

The project includes unit, integration, and real Chromium end-to-end tests:
- **Unit Tests**:
  - Request validation schemas (Zod)
  - Canonical JSON key ordering and SHA-256 snapshot hashing
  - Job state machine transitions
  - PDF tamper-evident byte alteration detection and audit logging
- **Integration Tests**:
  - API endpoint authentication and tenant isolation
  - Idempotent request deduplication
  - Partial bulk batch failures (failed PDFs do not invalidate completed ones)
  - Resilient repeated ZIP downloads
  - Storage abstraction (Local filesystem & S3) with HTTP Range support
  - Server-Sent Events (SSE) snapshots and heartbeats
- **End-to-End Tests**:
  - Real headless Chromium rendering of GST Invoices
  - Real headless Chromium rendering of Purchase Orders
  - Real 500-item document rendering memory stress test
  - Safe error handling for documents exceeding complexity limits (> 800 items)

Run all tests:
```bash
npm test
```

---

## 🔒 Security Best Practices
- **No SSRF / External Requests**: Puppeteer intercepts all network calls and blocks non-data URIs.
- **Log Sanitization**: Pino redacts passwords, tokens, API keys, and bank account numbers.
- **Template Escaping**: Handlebars auto-escapes all HTML values, preventing script execution.
- **Tenant Isolation**: Every database query and download request enforces tenant scoping.
- **Input Snapshot Immutability**: Rendering executes against immutable persisted payloads, immune to subsequent ERP database updates.
