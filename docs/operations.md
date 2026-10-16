# Operations, Monitoring & Runbooks

## 1. Observability Architecture

The microservice embeds structured logging with Pino and provides standard health and telemetry interfaces.

### 1.1. Correlation IDs & Request Tracing
Every incoming HTTP request is assigned a unique UUID `X-Correlation-ID` (either accepted from the caller or generated). The correlation ID is propagated across all log entries, BullMQ job payloads, and error responses.

### 1.2. Log Redaction & Security Compliance
To prevent compliance breaches and data leakage in centralized logging (e.g. CloudWatch / Datadog), the Pino logger automatically redacts sensitive attributes:
- `req.headers.authorization`
- `req.headers["x-api-key"]`
- `bankDetails.accountNumber`
- Customer PAN and token secrets.
Raw customer invoice payloads are never written to log files.

---

## 2. Health & Metrics Probes

### Kubernetes / Docker Compose Healthchecks:
- **Liveness Probe**:
  - `GET /health`
  - Period: 10s, Timeout: 3s, Failure Threshold: 3.
  - Indicates whether the Node.js event loop is responsive.
- **Readiness Probe**:
  - `GET /ready`
  - Period: 10s, Timeout: 5s, Failure Threshold: 2.
  - Verifies live connectivity to PostgreSQL and Redis. If Redis is down, Kubernetes will stop routing traffic to the instance without restarting the container.

### Operational Metrics Endpoint (`GET /metrics`):
```json
{
  "uptimeSeconds": 3600,
  "requests": {
    "total": 1250,
    "success": 1240,
    "failure": 10,
    "avgLatencyMs": 42,
    "p95LatencyMs": 85
  },
  "pdfRendering": {
    "avgDurationMs": 1450,
    "p95DurationMs": 2800,
    "retryCount": 4,
    "largeDocumentFailures": 0
  },
  "memory": {
    "rssMb": 680,
    "heapTotalMb": 180,
    "heapUsedMb": 115,
    "externalMb": 45
  },
  "queues": {
    "pdf-render-normal": { "waiting": 12, "active": 3, "completed": 1200, "failed": 2 },
    "pdf-render-large": { "waiting": 0, "active": 1, "completed": 35, "failed": 0 },
    "bulk-archive-creation": { "waiting": 1, "active": 1, "completed": 25, "failed": 0 }
  }
}
```

---

## 3. Recommended Production Alerts

| Alert Name | Metric / Trigger | Severity | Action Required |
|---|---|---|---|
| `HighQueueDepth` | Queue waiting jobs > 500 for > 5 mins | P2 - Warning | Inspect worker concurrency or scale up worker instances. |
| `ElevatedPdfFailureRate` | Failure rate > 5% over 10-minute window | P1 - Critical | Check Chromium crashes, font errors, or malformed ERP payloads. |
| `WorkerMemoryExhaustion` | Worker process RSS > 850 MB | P2 - Warning | Chromium lifecycle recycling threshold triggered; monitor for process leak. |
| `DatabaseUnreachable` | `/ready` database check fails > 2 probes | P1 - Critical | Verify RDS connection pool, network security groups, and credentials. |
| `RedisUnreachable` | `/ready` redis check fails > 2 probes | P1 - Critical | Check Redis cluster memory limit and network connectivity. |
| `IntegrityChecksumMismatch` | `IntegrityVerificationError` thrown | P1 - Security | Document physically altered in S3 storage! Trigger security audit. |

---

## 4. Disaster Recovery & Failure Runbooks

### 4.1. Worker Process Crash Recovery
- **Scenario**: A complex document or sudden kernel memory limit kills the Node/Chromium worker with `SIGKILL`.
- **System Behavior**:
  - The job in BullMQ has a lock that automatically expires. BullMQ detects the stalled job and re-assigns it to an active worker.
  - The job's attempt count increments (`attempts = attempts + 1`).
  - If attempts exceed 3, the job moves to the BullMQ failed state, and the PostgreSQL record is marked `failed` with the last known error message.
  - The bulk batch continues processing remaining items; the bulk job completes as `partially_completed`.

### 4.2. Temporary Storage Outage
- If S3 returns 500 errors during PDF save:
  - Worker catches the storage error and allows BullMQ to retry with exponential backoff (2s, 4s, 8s).
  - The uncommitted PDF buffer is discarded until storage connectivity recovers.
