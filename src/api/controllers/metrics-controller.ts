import { Request, Response } from 'express';
import { metricsService } from '../../services/metrics-service.js';

export class MetricsController {
  public static async getMetrics(req: Request, res: Response): Promise<void> {
    const snapshot = await metricsService.getMetricsSnapshot();
    res.status(200).json(snapshot);
  }
}
