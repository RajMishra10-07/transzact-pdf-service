# API Reference Documentation

The TranZact PDF Microservice provides a RESTful HTTP API with Server-Sent Events (SSE) for progress notifications. All endpoints (except `/health` and `/ready`) require authentication and tenant headers.

## Base URL
- Local Development: `http://localhost:4000`
- Production Ingress: `https://pdf.erp.internal`

## Authentication & Headers
| Header | Required | Description |
|---|---|---|
| `x-api-key` or `Authorization: Bearer <key>` | Yes | API authentication key. |
| `x-tenant-id` | Yes (for operations) | Tenant identifier for multi-tenant isolation. |
| `x-correlation-id` | Optional | Client correlation ID (generated automatically if omitted). |

---

## 1. Health & Readiness

### `GET /health`
Returns service uptime and general health. Unauthenticated.

#### Response (200 OK)
```json
{
  "status": "healthy",
  "service": "transzact-pdf-service",
  "uptime": 1245.5,
  "timestamp": "2026-10-16T10:00:00.000Z"
}
```

### `GET /ready`
Validates connectivity to PostgreSQL and Redis. Returns 503 if dependencies are unreachable.

#### Response (200 OK)
```json
{
  "status": "ready",
  "dependencies": {
    "database": "connected",
    "redis": "connected"
  },
  "timestamp": "2026-10-16T10:00:00.000Z"
}
```

### `GET /metrics`
Exposes operational metrics including request latency, active workers, queue depth, and memory consumption.

---

## 2. Single Document PDF Generation

### `POST /api/v1/documents/generate`
Generates a single PDF invoice or purchase order.

#### Request Body
```json
{
  "documentType": "invoice",
  "documentId": "INV-2026-001",
  "tenantId": "tenant-acme",
  "idempotencyKey": "req_unique_hash_12345",
  "data": {
    "invoiceNumber": "INV-2026-001",
    "invoiceDate": "2026-10-16",
    "supplier": {
      "name": "Acme Supplies",
      "addressLine1": "12 Industrial Road",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001",
      "gstin": "27AABCA1234F1Z6"
    },
    "customer": {
      "name": "Beta Manufacturing",
      "addressLine1": "45 MIDC Phase 2",
      "city": "Pune",
      "state": "Maharashtra",
      "pincode": "411001",
      "gstin": "27BBBBB1111B2Z6"
    },
    "currency": "INR",
    "items": [
      {
        "description": "Industrial Bearing Assembly",
        "hsnSacCode": "8482",
        "quantity": 10,
        "unit": "PCS",
        "unitPrice": 1500,
        "taxableAmount": 15000,
        "cgstRate": 9,
        "cgstAmount": 1350,
        "sgstRate": 9,
        "sgstAmount": 1350,
        "totalAmount": 17700
      }
    ],
    "subtotal": 15000,
    "totalCgst": 1350,
    "totalSgst": 1350,
    "grandTotal": 17700
  },
  "options": {
    "format": "A4",
    "orientation": "portrait",
    "preferSync": false
  }
}
```

#### Synchronous Response (200 OK - when preferSync: true and completed within 4.5s)
```json
{
  "isSync": true,
  "jobId": "f7a62b88-1234-4567-89ab-cdef01234567",
  "documentId": "INV-2026-001",
  "status": "completed",
  "downloadUrl": "/api/v1/documents/INV-2026-001/download?documentType=invoice&tenantId=tenant-acme",
  "fileSizeBytes": 72457,
  "sha256Checksum": "08b53298811d73a4fae3c155694c9f1309f98ca7a5e840d249fbe4a872aa05fa",
  "statusUrl": "/api/v1/jobs/f7a62b88-1234-4567-89ab-cdef01234567"
}
```

#### Asynchronous Response (202 Accepted - standard path or fallback)
```json
{
  "isSync": false,
  "jobId": "f7a62b88-1234-4567-89ab-cdef01234567",
  "documentId": "INV-2026-001",
  "status": "queued",
  "statusUrl": "/api/v1/jobs/f7a62b88-1234-4567-89ab-cdef01234567"
}
```

### `GET /api/v1/jobs/:jobId`
Returns generation job status, attempt count, and error details if failed.

### `GET /api/v1/documents/:documentId/status?documentType=invoice&tenantId=tenant-acme`
Returns metadata and download link for a completed document.

### `GET /api/v1/documents/:documentId/download?documentType=invoice&tenantId=tenant-acme`
Downloads the generated PDF with SHA-256 integrity verification.
- Supports `Range: bytes=0-1024` for resumable partial downloads (HTTP 206 Partial Content).
- Returns `X-Document-SHA256` header containing the cryptographically verified hash.

---

## 3. Bulk Document PDF Generation

### `POST /api/v1/documents/bulk`
Submits a batch of 1 to 100 documents for background rendering.

#### Request Body
```json
{
  "tenantId": "tenant-acme",
  "documents": [
    {
      "documentType": "invoice",
      "documentId": "INV-BATCH-001",
      "tenantId": "tenant-acme",
      "data": { ... }
    },
    {
      "documentType": "purchase_order",
      "documentId": "PO-BATCH-002",
      "tenantId": "tenant-acme",
      "data": { ... }
    }
  ]
}
```

#### Response (202 Accepted)
```json
{
  "bulkJobId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "totalDocuments": 2,
  "queuedDocuments": 2,
  "statusUrl": "/api/v1/bulk/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/status",
  "progressUrl": "/api/v1/bulk/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/events",
  "manifestUrl": "/api/v1/bulk/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/manifest",
  "estimatedCompletionSeconds": 10
}
```

### `GET /api/v1/bulk/:bulkJobId/status`
Returns real-time progress counters and percentage completion.

#### Response (200 OK)
```json
{
  "bulkJobId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "tenantId": "tenant-acme",
  "status": "processing",
  "totalDocuments": 100,
  "queuedDocuments": 45,
  "processingDocuments": 3,
  "completedDocuments": 50,
  "failedDocuments": 2,
  "percentageComplete": 52,
  "createdAt": "2026-10-16T10:15:00.000Z",
  "updatedAt": "2026-10-16T10:16:30.000Z",
  "downloadUrl": null
}
```

### `GET /api/v1/bulk/:bulkJobId/events`
Server-Sent Events (SSE) endpoint providing live updates.
- Sends `event: snapshot` immediately upon connection.
- Sends `: heartbeat` comment every 15 seconds.
- Sends `event: progress` on every state change.
- Sends `event: done` when reaching terminal state (`completed`, `partially_completed`, `failed`).

### `GET /api/v1/bulk/:bulkJobId/download`
Downloads the aggregated ZIP file containing all successful PDFs and `manifest.json`.
- Returns HTTP 409 Conflict if archive packaging has not yet completed.
- Supports HTTP Range headers (`bytes=start-end`) for resuming broken downloads on unstable client connections.

### `GET /api/v1/bulk/:bulkJobId/manifest`
Returns machine-readable JSON manifest detailing every document ID, terminal status, SHA-256 checksum, size, and failure reason.
