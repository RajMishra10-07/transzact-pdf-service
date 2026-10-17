# AI Corrections & Code Review Log

This log tracks every genuine defect, architectural misstep, or security vulnerability identified during development, who discovered it, and the precise remediation applied. This log feeds Section 5 of `APPROACH.md`.

Format:
- **Date**: YYYY-MM-DD
- **What Was Wrong**: Description of the defect or vulnerability
- **Discovered By**: Review / Candidate / User / Automated Test
- **Remediation**: Exact change made to fix the issue
- **Commit**: Git commit hash and message

---

## Chronological Log of Genuine Corrections

1. **Date**: 2026-10-16  
   **What Was Wrong**: AI suggested `page.pdf()` streams output directly to disk/S3 without RAM overhead.  
   **Discovered By**: Review (Puppeteer source inspection)  
   **Remediation**: Puppeteer `page.pdf()` actually buffers full document in memory as `Uint8Array`; updated capacity model and worker memory allocations accordingly while keeping ZIP archive creation truly streamed.  
   **Commit**: `38038b7` (feat: core pdf generation engine and dual-worker queues)

2. **Date**: 2026-10-16  
   **What Was Wrong**: Shared singleton `ioredis` instance was passed to multiple BullMQ queues and workers, causing connection blocks and runtime stalls.  
   **Discovered By**: Automated Test (`npm test`)  
   **Remediation**: Replaced shared client with `getRedisOptions()` connection factory so BullMQ workers maintain isolated Redis connections.  
   **Commit**: `38038b7` (feat: core pdf generation engine and dual-worker queues)

3. **Date**: 2026-10-16  
   **What Was Wrong**: Bulk batch job progress used naive `+1` arithmetic increments; when BullMQ retried transient worker errors, failure counters double-counted.  
   **Discovered By**: Review (Distributed systems edge case review)  
   **Remediation**: Implemented `recalculateBulkJobProgress()` which runs atomic SQL aggregation (`COUNT(*) FILTER (WHERE status = 'completed')`) directly on `bulk_job_items`.  
   **Commit**: `38038b7` (feat: core pdf generation engine and dual-worker queues)

4. **Date**: 2026-10-16  
   **What Was Wrong**: Deterministic failures (e.g. documents exceeding maximum 800 line items) were retried 3 times, thrashing Chromium CPU on impossible jobs.  
   **Discovered By**: Automated Test (`tests/e2e/large-document.test.ts`)  
   **Remediation**: Wrapped deterministic errors in BullMQ's `UnrecoverableError` so jobs fail immediately on attempt 1 without futile retries.  
   **Commit**: `38038b7` (feat: core pdf generation engine and dual-worker queues)

5. **Date**: 2026-10-16  
   **What Was Wrong**: Tenant middleware only validated `x-tenant-id` header; an attacker could pass a victim's `tenantId` in URL query params or JSON body to access or spoof jobs.  
   **Discovered By**: Security Review  
   **Remediation**: Added strict tripartite cross-validation comparing header, body, and query parameter, throwing HTTP 403 Forbidden on any mismatch.  
   **Commit**: `38038b7` (feat: core pdf generation engine and dual-worker queues)

6. **Date**: 2026-10-17  
   **What Was Wrong**: External `uuid` npm package was imported in `src/database/repositories/user-repository.ts` but was not listed in `package.json`, failing module resolution in isolated environments.  
   **Discovered By**: Automated Test (`npm test`)  
   **Remediation**: Replaced `uuid` import with native Node.js 20+ `crypto.randomUUID()` via `generateUuid()` in `src/utils/ids.ts`.  
   **Commit**: `4dd63b9` (feat(auth): add JWT authentication and role-based access control (RBAC))

7. **Date**: 2026-10-17  
   **What Was Wrong**: `src/database/repositories/user-repository.ts` attempted to import non-existent `pgClient` from `src/database/client.ts`.  
   **Discovered By**: Automated Compiler (`npm run build`)  
   **Remediation**: Updated import to `dbPool` and used `dbPool.query(...)` for connection-pooled PostgreSQL queries.  
   **Commit**: `4dd63b9` (feat(auth): add JWT authentication and role-based access control (RBAC))

8. **Date**: 2026-10-18  
   **What Was Wrong**: Public registration (`POST /api/v1/auth/signup`) allowed users to supply `role: "admin"` in the payload, creating a privilege escalation vulnerability where anyone could self-appoint as superuser.  
   **Discovered By**: User / Security Review  
   **Remediation**: Restricted `signupSchema` role enum strictly to `['operator', 'viewer']`, removed the admin option from the signup UI select, and added automated test asserting HTTP 400 rejection on admin signup attempts.  
   **Commit**: `e38cbe9` (fix(security): signup can no longer pick admin role)

9. **Date**: 2026-10-18  
   **What Was Wrong**: Synchronous rendering (`options.preferSync`) executed unthrottled inside the Express process, risking memory exhaustion and server crashes under concurrent load.  
   **Discovered By**: User / Architecture Review (Issue 1)  
   **Remediation**: Added `MAX_SYNC_RENDER_CONCURRENCY` (default 2) and an active render semaphore guard in `DocumentService`, gracefully falling back to BullMQ background queues (HTTP 202) when capacity is saturated.  
   **Commit**: `ea41607` (fix(perf): guard synchronous pdf rendering with concurrency limit and queue fallback)
