import { getQueueManager } from '../queue/queues.js';

export class MetricsService {
  private requestCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private retryCount = 0;
  private largeDocumentFailures = 0;
  private renderDurations: number[] = [];
  private requestLatencies: number[] = [];
  private bulkDurations: number[] = [];
  private storageFailures = 0;
  private activeWorkers = 0;

  public recordRequest(latencyMs: number, success: boolean): void {
    this.requestCount++;
    if (success) {
      this.successCount++;
    } else {
      this.failureCount++;
    }
    this.requestLatencies.push(latencyMs);
    if (this.requestLatencies.length > 500) {
      this.requestLatencies.shift();
    }
  }

  public recordRender(durationMs: number): void {
    this.renderDurations.push(durationMs);
    if (this.renderDurations.length > 500) {
      this.renderDurations.shift();
    }
  }

  public recordRetry(): void {
    this.retryCount++;
  }

  public recordLargeDocFailure(): void {
    this.largeDocumentFailures++;
  }

  public recordStorageFailure(): void {
    this.storageFailures++;
  }

  public recordBulkCompletion(durationMs: number): void {
    this.bulkDurations.push(durationMs);
    if (this.bulkDurations.length > 100) {
      this.bulkDurations.shift();
    }
  }

  public setActiveWorkers(count: number): void {
    this.activeWorkers = count;
  }

  public async getMetricsSnapshot() {
    const mem = process.memoryUsage();
    let queueMetrics = {};
    try {
      queueMetrics = await getQueueManager().getQueueMetrics();
    } catch {
      queueMetrics = { status: 'queue_unavailable' };
    }

    const avg = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.floor(sorted.length * 0.95);
      return sorted[index];
    };

    return {
      uptimeSeconds: Math.floor(process.uptime()),
      requests: {
        total: this.requestCount,
        success: this.successCount,
        failure: this.failureCount,
        avgLatencyMs: Math.round(avg(this.requestLatencies)),
        p95LatencyMs: Math.round(p95(this.requestLatencies)),
      },
      pdfRendering: {
        avgDurationMs: Math.round(avg(this.renderDurations)),
        p95DurationMs: Math.round(p95(this.renderDurations)),
        retryCount: this.retryCount,
        largeDocumentFailures: this.largeDocumentFailures,
      },
      memory: {
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        externalMb: Math.round(mem.external / (1024 * 1024)),
      },
      bulkJobs: {
        completedBatches: this.bulkDurations.length,
        avgDurationMs: Math.round(avg(this.bulkDurations)),
      },
      workers: {
        active: this.activeWorkers,
      },
      queues: queueMetrics,
      storage: {
        failures: this.storageFailures,
      },
    };
  }
}

export const metricsService = new MetricsService();
