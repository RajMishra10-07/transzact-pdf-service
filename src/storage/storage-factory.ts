import { env } from '../config/env.js';
import { IStorageService } from './storage-interface.js';
import { LocalStorageAdapter } from './local-storage.js';
import { S3StorageAdapter } from './s3-storage.js';
import { logger } from '../utils/logger.js';

let storageInstance: IStorageService | null = null;

export function getStorageService(): IStorageService {
  if (storageInstance) {
    return storageInstance;
  }

  if (env.STORAGE_DRIVER === 's3') {
    logger.info({ bucket: env.AWS_S3_BUCKET, region: env.AWS_REGION }, 'Initializing S3 Storage Adapter');
    storageInstance = new S3StorageAdapter({
      region: env.AWS_REGION,
      bucket: env.AWS_S3_BUCKET,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      endpoint: env.AWS_S3_ENDPOINT,
      forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE,
    });
  } else {
    logger.info({ basePath: env.LOCAL_STORAGE_PATH }, 'Initializing Local Storage Adapter');
    storageInstance = new LocalStorageAdapter(env.LOCAL_STORAGE_PATH);
  }

  return storageInstance;
}

export function setStorageService(customService: IStorageService): void {
  storageInstance = customService;
}
