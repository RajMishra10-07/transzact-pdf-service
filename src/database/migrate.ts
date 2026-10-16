import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbPool } from './client.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  const migrationPath = path.join(__dirname, 'migrations', '001_initial_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('Database migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Database migration failed');
    throw err;
  } finally {
    client.release();
  }
}

// Auto-run when executed directly via CLI
if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
