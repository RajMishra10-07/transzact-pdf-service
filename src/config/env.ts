import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Authentication
  DEV_AUTH_BYPASS: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  API_KEY: z.string().default('erp-service-secret-key-change-in-production'),
  JWT_SECRET: z.string().default('transzact-super-secure-jwt-secret-key-change-in-production-2026'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().default(86400),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(1200),

  // Worker Concurrency & Memory Limits
  NORMAL_WORKER_CONCURRENCY: z.coerce.number().default(3),
  LARGE_WORKER_CONCURRENCY: z.coerce.number().default(1),
  ARCHIVE_WORKER_CONCURRENCY: z.coerce.number().default(2),
  LARGE_DOCUMENT_THRESHOLD: z.coerce.number().default(150),
  RENDER_TIMEOUT_MS: z.coerce.number().default(15000),
  SYNC_RENDER_TIMEOUT_MS: z.coerce.number().default(4500),
  MAX_SYNC_RENDER_CONCURRENCY: z.coerce.number().default(2),
  MAX_BROWSER_LIFETIME_RENDERS: z.coerce.number().default(50),
  MAX_BROWSER_MEMORY_MB: z.coerce.number().default(750),

  // Storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./data/storage'),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().default('minioadmin'),
  AWS_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  AWS_S3_BUCKET: z.string().default('transzact-pdf-documents'),
  AWS_S3_ENDPOINT: z.string().optional(),
  AWS_S3_FORCE_PATH_STYLE: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),

  // Database
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/transzact_pdf'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Bulk limits
  MAX_BULK_DOCUMENTS: z.coerce.number().default(100),
  MAX_PAYLOAD_SIZE_MB: z.coerce.number().default(10),

  // Standalone / Offline In-Memory Fallback
  USE_IN_MEMORY_FALLBACK: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
