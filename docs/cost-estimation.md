# Infrastructure Cost Estimation

## 1. Executive Summary & Budget Comparison

- **Monthly Budget Cap**: ₹12,500 (~$149.00 USD at ₹84.00/USD).
- **Workload Target**: 30,000 generated documents/month + 300 bulk ZIP archives.
- **Estimated Monthly Cost (Dedicated Architecture)**: **₹2,844/month** (including 18% GST).
- **Budget Variance / Surplus**: **+₹9,656/month remaining (77.2% buffer)**.

---

## 2. Infrastructure Sizing & Pricing Assumptions

- **AWS Region**: `ap-south-1` (Mumbai, India).
- **Hours per Month**: 730 hours.
- **Currency Conversion**: \$1.00 USD = ₹84.00 INR.
- **Taxation**: 18% Indian GST applied to all cloud services.
- **Pricing References**: Published AWS Asia Pacific (Mumbai) on-demand rate card.

---

## 3. Line-by-Line Cost Breakdown

### A. Compute: API & PDF Worker Service
- **Instance Type**: Dedicated Amazon EC2 `t4g.medium` (ARM Graviton2, 2 vCPUs, 4.0 GB RAM).
- **On-Demand Hourly Rate**: \$0.0336 / hour.
- **Monthly Run Time**: 730 hours.
- **Monthly Compute Cost**:
  $$730 \times \$0.0336 = \mathbf{\$24.53\text{ / month}} \quad (\text{₹}2,060.52)$$

*(Alternative Zero-Compute Option: Deploy as Docker container on the existing EC2 `r6i.large` running Django, utilizing available spare CPU/RAM at ₹0.00 incremental compute fee).*

### B. Object Storage (Amazon S3 Standard)
- **Document Storage Volume**: 30,000 PDFs × 300 KB = 9.0 GB.
- **ZIP Archives Storage Volume**: 300 batches × 5 MB = 1.5 GB.
- **Cumulative Active Storage**: 10.5 GB.
- **Storage Rate (ap-south-1)**: \$0.025 / GB / month.
- **Storage Cost**:
  $$10.5\text{ GB} \times \$0.025 = \mathbf{\$0.26\text{ / month}} \quad (\text{₹}21.84)$$
- **API Request Operations**:
  - `PUT`, `POST` (30,000 document uploads + 300 archives): 30,300 requests × \$0.005 / 1,000 = \$0.15.
  - `GET` (45,000 downloads): 45,000 requests × \$0.0004 / 1,000 = \$0.02.
  - Request Total: **\$0.17 / month** (₹14.28).

### C. Network Data Transfer (Bandwidth Egress)
- **Outbound Data Volume**: 45,000 downloads × 300 KB = 13.5 GB.
- **AWS Free Tier Policy**: First 100 GB/month of Internet Data Transfer OUT is free worldwide across all AWS services.
- **Billed Transfer**: 0 GB.
- *(Conservatively accounting without free tier at \$0.09/GB = \$1.22 / month or ₹102.48).*

### D. Relational Database (PostgreSQL on RDS)
- **Existing Setup**: Amazon RDS `db.r6i.large` already provisioned for Django monolith.
- **Incremental Workload**: 30,000 rows in `generation_jobs` and `documents` occupies ~45 MB disk space per month with indexes.
- **Storage Incremental Fee**: 0.05 GB × \$0.115/GB-month = **\$0.01 / month** (₹0.84).

### E. Redis Cache & Job Queue
- **Existing Setup**: Redis cluster already active for Django background tasks.
- **Queue Memory Footprint**: Max 1,000 active queue metadata entries × 1 KB = < 1.0 MB RAM. Zero binary PDFs stored in Redis.
- **Incremental Fee**: **\$0.00 / month**.

### F. Observability, Logging & Metrics (Amazon CloudWatch)
- **Log Volume Ingested**: ~3.5 GB/month (structured JSON logs with Pino, health checks excluded).
- **Ingestion Rate**: \$0.50 / GB.
- **Archival Storage (30-day retention)**: 3.5 GB × \$0.03/GB = \$0.11.
- **Total CloudWatch Cost**: **\$1.86 / month** (₹156.24).

---

## 4. Total Monthly Cost Summary

| Service Component | Monthly Cost (USD) | Monthly Cost (INR) | % of Total |
|---|---|---|---|
| EC2 `t4g.medium` (API + Workers) | \$24.53 | ₹2,060.52 | 85.5% |
| Amazon S3 Storage (10.5 GB) | \$0.26 | ₹21.84 | 0.9% |
| Amazon S3 API Requests (PUT/GET) | \$0.17 | ₹14.28 | 0.6% |
| Bandwidth / Data Transfer Out | \$0.00 (Free Tier) | ₹0.00 | 0.0% |
| RDS PostgreSQL Storage Growth | \$0.01 | ₹0.84 | 0.1% |
| Redis Queue Capacity | \$0.00 | ₹0.00 | 0.0% |
| CloudWatch Structured Logs | \$1.86 | ₹156.24 | 6.5% |
| **Subtotal (Base Infrastructure)** | **\$26.83** | **₹2,253.72** | **93.5%** |
| Operational Reserve / Spikes (7%) | \$1.87 | ₹157.08 | 6.5% |
| **Total Before Tax** | **\$28.70** | **₹2,410.80** | **100.0%** |
| Indian GST (18%) | \$5.17 | ₹433.94 | - |
| **Total Estimated Invoiced Cost** | **\$33.87** | **₹2,844.74** | - |

---

## 5. Budget Defensibility & Headroom Analysis

- **Allowed Budget**: ₹12,500.00
- **Total Estimated Cost**: ₹2,844.74
- **Financial Headroom**: **₹9,655.26 / month (339% headroom factor)**.

### Risk & Uncertainty Assessment:
1. **Workload Surge**: Even if document volume triples to 90,000 documents/month, S3 storage increases by ₹44, bandwidth increases by ₹200, and compute remains fixed on `t4g.medium` (queue absorbs burst drain time). Total remains < ₹3,500/month.
2. **Compute Scaling**: If sustained traffic requires upgrading to `t4g.large` (4 vCPU, 8 GB RAM at \$49.06/month), total cost rises to ₹4,900/month, still **₹7,600 below budget**.
