import { Redis, RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function getRedisOptions(): RedisOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times) {
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
    lazyConnect: true,
  };
}

export function createRedisClient(): Redis {
  const client = new Redis(getRedisOptions());

  client.on('error', (err) => {
    logger.warn({ err }, 'Redis connection error');
  });

  return client;
}

// Dedicated client for general health checks
let healthClient: Redis | null = null;

export function getHealthRedisClient(): Redis {
  if (!healthClient) {
    healthClient = createRedisClient();
  }
  return healthClient;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getHealthRedisClient();
    if (client.status !== 'ready') {
      await client.connect().catch(() => {});
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.warn({ err }, 'Redis health check failed');
    return false;
  }
}
