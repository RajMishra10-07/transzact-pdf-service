import { Request, Response } from 'express';
import { checkDatabaseHealth } from '../../database/client.js';
import { checkRedisHealth } from '../../queue/connection.js';

export class HealthController {
  public static async getHealth(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'healthy',
      service: 'transzact-pdf-service',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  public static async getReady(req: Request, res: Response): Promise<void> {
    const [dbHealthy, redisHealthy] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    const isReady = dbHealthy && redisHealthy;
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'not_ready',
      dependencies: {
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  }
}
