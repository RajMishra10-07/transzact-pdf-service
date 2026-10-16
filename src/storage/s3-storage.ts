import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { IStorageService, StorageObjectMetadata } from './storage-interface.js';
import { NotFoundError } from '../domain/errors.js';
import { computeBufferHash } from '../utils/hash.js';

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export class S3StorageAdapter implements IStorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  public async save(
    key: string,
    data: Buffer | Readable,
    contentType = 'application/octet-stream'
  ): Promise<{ key: string; sizeBytes: number }> {
    let body: Buffer | Uint8Array;
    let sizeBytes = 0;

    if (Buffer.isBuffer(data)) {
      body = data;
      sizeBytes = data.length;
    } else {
      // Buffer the readable stream to calculate size and upload
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = Buffer.concat(chunks);
      sizeBytes = body.length;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);
    return { key, sizeBytes };
  }

  public async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const rangeHeader = range ? `bytes=${range.start}-${range.end}` : undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Range: rangeHeader,
    });

    try {
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new NotFoundError(`Empty body returned for S3 object: ${key}`);
      }
      return response.Body as Readable;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundError(`S3 object not found: ${key}`);
      }
      throw err;
    }
  }

  public async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  public async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  public async getMetadata(key: string): Promise<StorageObjectMetadata> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);

      return {
        key,
        sizeBytes: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified,
      };
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound' || (err as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundError(`S3 object not found: ${key}`);
      }
      throw err;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  public async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }
}
