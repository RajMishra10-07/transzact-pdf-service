# Architecture & System Design Documentation

## 1. Overview & Problem Scope

The TranZact PDF Microservice is a production-oriented, fault-tolerant PDF rendering engine designed specifically to decouple expensive document generation from an existing Django monolith ERP application.

### Key Goals & Constraints
- Support high peak throughput: ~1,000 single PDF requests/minute and 5–10 bulk requests/minute (up to 100 documents each).
- Robust memory isolation preventing Puppeteer out-of-memory (OOM) failures for complex documents (500+ line items).
- Snapshot immutability ensuring data consistency when underlying ERP database state changes during multi-document generation.
- Tamper-evident cryptographic verification via SHA-256 checksums and append-only audit tracking.
- Client download resilience against unstable network connections via resumable HTTP Range requests and pre-aggregated ZIP archives.
- Strict cloud infrastructure budget capped below ₹12,500/month for ~30,000 documents.

---

## 2. High-Level Component Topology

```
+-------------------------------------------------------------------------+
|                        Django Monolith ERP                              |
|   (Emits JSON payloads via authenticated REST calls or initiates SSE)   |
+------------------------------------+------------------------------------+
                                     |
                                     | HTTP REST / SSE
                                     v
+-------------------------------------------------------------------------+
|                        Express.js API Layer                             |
|  - Helmet security headers & token-bucket rate limiter                  |
|  - API Key & Django shared-secret authentication                       |
|  - Tenant isolation enforcement                                         |
|  - Zod request schema validation                                        |
|  - Canonical deep-key sorting & SHA-256 input snapshot hashing          |
+-------------------+---------------------------------+-------------------+
                    |                                 |
         Persist Snapshot Metadata           Enqueue Rendering Job
                    v                                 v
+-----------------------------------+   +---------------------------------+
|     PostgreSQL 16 Metadata        |   |       Redis 7 & BullMQ          |
|  - generation_jobs                |   |  - Queue: pdf-render-normal     |
|  - documents                      |   |  - Queue: pdf-render-large      |
|  - bulk_jobs & bulk_job_items     |   |  - Queue: bulk-archive-creation |
|  - document_audit_records         |   +----------------+----------------+
+-----------------------------------+                    |
                                                         | Job Dispatch
                                                         v
                                    +--------------------+----------------+
                                    |     Dedicated Worker Processes      |
                                    |  +-------------------------------+  |
                                    |  | Normal Worker (Concurrency: 3)|  |
                                    |  | Large Worker  (Concurrency: 1)|  |
                                    |  | Archive Worker(Concurrency: 2)|  |
                                    |  +---------------+---------------+  |
                                    +------------------+------------------+
                                                       |
                                            Puppeteer Lifecycle Pool
                                            - Browser recycling after 50 docs
                                            - Guaranteed page.close() cleanup
                                            - Intercepted external traffic
                                                       |
                                                       v
                                    +-------------------------------------+
                                    |      Object Storage Layer           |
                                    |  - Local filesystem or AWS S3       |
                                    |  - Pre-signed URLs & HTTP Range     |
                                    +-------------------------------------+
```

---

## 3. Core Architectural Subsystems

### 3.1. Dual-Mode Single Document Rendering (Sync vs Async)
- **Synchronous Rendering with Fallback**:
  - If the client supplies `options.preferSync: true` AND the document is not flagged as large (< 150 items), the API attempts immediate rendering within a strict 4,500 ms deadline.
  - If rendering completes within 4.5 seconds, the PDF binary and metadata are returned directly (HTTP 200).
  - If rendering times out or fails, the service **does not crash or return a 500 error**. Instead, it seamlessly demotes the job to the asynchronous BullMQ queue and returns HTTP 202 with `jobId` and `statusUrl`.
- **Asynchronous Rendering**:
  - The standard path for large documents or default single requests. Returns HTTP 202 immediately. Clients poll `GET /api/v1/jobs/:jobId` or check document status.

### 3.2. Memory Isolation & Puppeteer Lifecycle Management
- **The Problem**: Chromium allocates significant memory during layout and font rasterization (~400 MB per page). Documents with 500+ line items require extensive DOM computation and can trigger Node or Chromium crashes.
- **The Solution**:
  1. **Dual Queue Routing**: Payloads are inspected at ingestion. Payloads with >= 150 items are routed to `pdf-render-large`; smaller documents go to `pdf-render-normal`.
  2. **Worker Concurrency Capping**: Normal workers run with concurrency 3; large document workers run with concurrency 1.
  3. **Browser Process Recycling**: A single Chromium instance is maintained per worker, but automatically recycled after 50 renders (`MAX_BROWSER_LIFETIME_RENDERS`) or if RSS memory exceeds 750 MB.
  4. **Strict Cleanup**: Every page creation executes inside `try ... finally` blocks guaranteeing `await page.close()`. In case of unhandled timeouts, the browser process is killed and a fresh one launched.
  5. **Network Interception**: Puppeteer intercepts all outbound requests and aborts external URLs, preventing Server-Side Request Forgery (SSRF) and external latency bottlenecks.

### 3.3. Snapshot Immutability & Consistency
- **The Problem**: Invoices or purchase orders in the ERP database might change while a batch of 100 documents is being rendered, leading to inconsistent invoices.
- **The Solution**:
  - The PDF microservice never queries the ERP database dynamically during rendering.
  - The caller provides complete document payloads in the request.
  - The microservice deeply sorts object keys (`canonicalizeJson`) and computes a SHA-256 `input_hash`.
  - The snapshot and hash are persisted in PostgreSQL `generation_jobs`.
  - Workers render exclusively from the stored snapshot.

### 3.4. Tamper-Evident SHA-256 Verification & Audit Trails
- Immediately following PDF rendering, SHA-256 is computed over the raw PDF byte buffer.
- The checksum is written to `documents.sha256_checksum` and an append-only `document_audit_records` table.
- On download (`GET /api/v1/documents/:id/download`), the service fetches the PDF from storage, re-computes the checksum in real time, and asserts parity before serving.
- Tampering Detection vs Prevention:
  - SHA-256 detects byte modification.
  - AWS S3 Object Lock (WORM - Write Once Read Many) prevents modification.
  - Digital signatures (X.509 PKI) prove issuer identity.

### 3.5. Bulk Aggregation & Resilient Downloads
- When all 1-100 items in a bulk batch reach a terminal state (`completed` or `failed`), the `bulk-archive-creation` worker aggregates the batch into a single ZIP file.
- The ZIP creation uses Node.js streaming `archiver` piped directly to storage, avoiding loading 100 PDFs into RAM simultaneously.
- A machine-readable `manifest.json` is bundled inside the root of the ZIP and exposed via `/manifest`.
- Resumable downloads are supported via standard HTTP Range headers (`bytes=start-end`), allowing clients on unstable mobile connections to resume interrupted downloads.
