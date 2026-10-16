import { Readable } from 'stream';

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType: string;
  lastModified?: Date;
  sha256?: string;
}

export interface IStorageService {
  save(key: string, data: Buffer | Readable, contentType?: string): Promise<{ key: string; sizeBytes: number }>;
  getStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getMetadata(key: string): Promise<StorageObjectMetadata>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
