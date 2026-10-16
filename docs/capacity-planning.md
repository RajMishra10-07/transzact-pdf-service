# Capacity Planning & System Math

## 1. Workload Analysis & Traffic Patterns

The system is evaluated against two primary traffic dimensions:
1. **Peak Burst Workload**:
   - Single documents: 1,000 requests/minute.
   - Bulk requests: 5–10 requests/minute (up to 100 documents each).
2. **Monthly Baseline Budget Workload**:
   - 30,000 total documents generated per month.

---

## 2. Traffic Math & Concurrency Reality

### 2.1. Single-Document Traffic Analysis
- **Arrival Rate**:
  $$\lambda = \frac{1,000\text{ requests}}{60\text{ seconds}} \approx 16.67\text{ requests/second}$$
- **Mean Rendering Service Time**:
  $$W = 2.5\text{ seconds/document}$$
- **Theoretical Concurrency (Little's Law: $L = \lambda W$)**:
  $$L = 16.67 \times 2.5 = 41.67\text{ concurrent rendering operations}$$

#### Why 42 Concurrent Instances Cannot Be Run on Budget
If the system attempted to fulfill every burst request immediately without queueing:
- **Memory Required**: $42 \times 400\text{ MB} = 16,800\text{ MB} \approx 16.8\text{ GB RAM}$.
- **CPU Required**: Chromium page layout and rasterization is CPU-bound. 42 concurrent headless renderers would require at least 16 to 32 dedicated vCPUs to prevent thrashing and timeout cascades.
- **Cost**: A dedicated 16-vCPU, 32 GB RAM cloud instance (e.g. AWS c6i.4xlarge) costs over \$495/month (~₹41,500/month), exceeding the ₹12,500 budget by **330%**!

#### Architectural Solution: Queue Buffering & Controlled Drain
Instead of unconstrained concurrency, our microservice enforces **controlled worker concurrency**:
- Normal Worker Concurrency: $C_{\text{normal}} = 3$
- Large Worker Concurrency: $C_{\text{large}} = 1$
- Total Parallel Chromium Pages: $C_{\text{total}} = 4$

At $C = 4$ and service time $S = 2.0\text{ seconds/doc}$, sustained throughput is:
$$\mu = \frac{4\text{ workers}}{2.0\text{ seconds}} = 2.0\text{ documents/second} = 120\text{ documents/minute}$$

### 2.2. Queue Growth During Burst & Drain Time
When a 1-minute peak burst of 1,000 requests arrives ($\lambda = 1,000$, $\mu = 120$):
- **Incoming Work**: 1,000 jobs.
- **Processed in Minute 1**: 120 jobs.
- **Peak Queue Depth**: $1,000 - 120 = 880\text{ jobs}$.
- **Queue Drain Time**:
  $$T_{\text{drain}} = \frac{880\text{ jobs}}{2.0\text{ jobs/sec}} = 440\text{ seconds} \approx 7.3\text{ minutes}$$

The Redis queue buffers incoming jobs safely in memory (each metadata job in Redis consumes < 1 KB; 880 jobs consume < 1 MB). The API immediately acknowledges requests with HTTP 202 Accepted, allowing the Django application to proceed without blocking.

### 2.3. Bulk Traffic Math
- **Arrival Rate**: 5–10 bulk batches/minute.
- **Batch Size Distribution**:
  - Average Batch Size: 20 documents.
  - Worst-Case Batch Size: 100 documents.
- **Total Bulk Document Volume**:
  - Average: $5 \times 20 = 100\text{ documents/minute}$.
  - Worst Case: $10 \times 100 = 1,000\text{ documents/minute}$.
- In a 100-document batch, each document is queued as an independent unit. The archive worker stitches the ZIP streaming archive only after all 100 items reach terminal states (`completed` or `failed`).

---

## 3. Memory & Resource Footprint

### 3.1. Peak Memory Breakdown per Node
| Component | Formula / Assumption | Peak Memory (MB) |
|---|---|---|
| Active Chromium Renderers (Normal) | 3 concurrent pages × 400 MB | 1,200 MB |
| Active Chromium Renderer (Large) | 1 concurrent page × 500 MB | 500 MB |
| Node.js Worker Runtime | BullMQ, PDF buffer allocations | 180 MB |
| Node.js API Service | Express, rate-limiting, Zod parsing | 120 MB |
| Operating System & Buffers | Linux kernel, page tables, disk cache | 450 MB |
| **Total Projected Peak RAM** | | **2,450 MB (~2.45 GB)** |

### 3.2. Instance Sizing Recommendation
A **4 GB RAM instance** (such as AWS EC2 `t4g.medium` or container allocated 3.5 GB on the existing `r6i.large`) provides **1.55 GB of headroom (38%)**, safely guarding against Puppeteer spikes without triggering kernel OOM-killer.

---

## 4. Storage & Bandwidth Projections (30,000 Docs/Month)

### 4.1. Monthly Storage Ingestion
- **Document Volume**: 30,000 PDFs/month.
- **Average PDF Size**: 300 KB (measured between 72 KB for simple invoices to 1.5 MB for 500-item documents).
- **Monthly PDF Storage**:
  $$\text{Storage}_{\text{PDF}} = 30,000 \times 0.30\text{ MB} = 9,000\text{ MB} = 9.0\text{ GB/month}$$
- **ZIP Archives**:
  - Assuming 30% of documents generated via bulk batches (average 30 docs/ZIP):
    $$\text{Batches} = \frac{9,000\text{ docs}}{30\text{ docs/batch}} = 300\text{ ZIP archives/month}$$
  - Average ZIP size (compressed): ~5 MB.
  - Archive Storage: $300 \times 5\text{ MB} = 1.5\text{ GB/month}$.
- **Total Monthly Active Storage**: $9.0\text{ GB} + 1.5\text{ GB} = \mathbf{10.5\text{ GB/month}}$.

### 4.2. Network Bandwidth
- Downloads per document: Assumed 1.5 downloads per document (customer + internal accounting).
- Outbound Data Transfer:
  $$\text{Egress} = 30,000 \times 1.5 \times 0.30\text{ MB} = 13.5\text{ GB/month}$$

---

## 5. Latency & SLA Reality

### Single Document Latency SLA
- **Empty Queue Condition**:
  - Rendering latency: 1.2 to 2.5 seconds.
  - Storage upload & hashing: 80 to 150 ms.
  - Total end-to-end latency: **1.3 to 2.7 seconds**.
  - Fits comfortably within the 5-second expectation.
- **Bursted Queue Condition**:
  - When queue depth is 500 jobs, waiting time is $\frac{500}{2} = 250\text{ seconds}$.
  - Under burst conditions, synchronous generation times out at 4.5s, falls back to async, and returns HTTP 202. The client polls the status URL or listens to webhook/SSE.
