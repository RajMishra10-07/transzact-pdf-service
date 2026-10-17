import fs from 'fs';
import path from 'path';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { IStorageService, StorageObjectMetadata } from './storage-interface.js';
import { NotFoundError, ForbiddenError } from '../domain/errors.js';
import { computeBufferHash } from '../utils/hash.js';

const streamPipeline = promisify(pipeline);

export class LocalStorageAdapter implements IStorageService {
  private basePath: string;

  constructor(basePath = './data/storage') {
    this.basePath = path.resolve(basePath);
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private resolveKey(key: string): string {
    const normalizedKey = key.replace(/^[/\\]+/, '');
    if (normalizedKey.includes('..')) {
      throw new ForbiddenError('Path traversal detected in storage key');
    }
    const resolvedPath = path.resolve(this.basePath, normalizedKey);
    if (!resolvedPath.startsWith(this.basePath)) {
      throw new ForbiddenError('Path traversal outside base directory detected');
    }
    return resolvedPath;
  }

  public async save(
    key: string,
    data: Buffer | Readable,
    contentType = 'application/octet-stream'
  ): Promise<{ key: string; sizeBytes: number }> {
    const fullPath = this.resolveKey(key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (Buffer.isBuffer(data)) {
      await fs.promises.writeFile(fullPath, data);
      return { key, sizeBytes: data.length };
    } else {
      const writeStream = fs.createWriteStream(fullPath);
      await streamPipeline(data, writeStream);
      const stat = await fs.promises.stat(fullPath);
      return { key, sizeBytes: stat.size };
    }
  }

  public async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const fullPath = this.resolveKey(key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError(`Storage object not found: ${key}`);
    }

    if (range) {
      return fs.createReadStream(fullPath, { start: range.start, end: range.end });
    }
    return fs.createReadStream(fullPath);
  }

  public async getBuffer(key: string): Promise<Buffer> {
    const fullPath = this.resolveKey(key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError(`Storage object not found: ${key}`);
    }
    return fs.promises.readFile(fullPath);
  }

  public async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const fullPath = this.resolveKey(key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError(`Storage object not found: ${key}`);
    }
    // For local storage, returns an internal API-accessible path
    return `/api/v1/storage/download?key=${encodeURIComponent(key)}`;
  }

  public async getMetadata(key: string): Promise<StorageObjectMetadata> {
    const fullPath = this.resolveKey(key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError(`Storage object not found: ${key}`);
    }
    const stat = await fs.promises.stat(fullPath);

    return {
      key,
      sizeBytes: stat.size,
      contentType: key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
      lastModified: stat.mtime,
    };
  }

  public async exists(key: string): Promise<boolean> {
    const fullPath = this.resolveKey(key);
    return fs.existsSync(fullPath);
  }

  public async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }
}
