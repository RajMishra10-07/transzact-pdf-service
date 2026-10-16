import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageAdapter } from '../../src/storage/local-storage.js';
import { NotFoundError } from '../../src/domain/errors.js';
import fs from 'fs';
import path from 'path';

describe('17. Storage Abstraction & Missing File Handling', () => {
  const testStorageDir = './data/test_storage_driver';
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    storage = new LocalStorageAdapter(testStorageDir);
  });

  afterEach(async () => {
    if (fs.existsSync(testStorageDir)) {
      await fs.promises.rm(testStorageDir, { recursive: true, force: true });
    }
  });

  it('should save and retrieve buffer correctly', async () => {
    const key = 'test/doc.pdf';
    const content = Buffer.from('Binary PDF content', 'utf8');

    const saveRes = await storage.save(key, content, 'application/pdf');
    expect(saveRes.sizeBytes).toBe(content.length);

    const retrieved = await storage.getBuffer(key);
    expect(retrieved.toString('utf8')).toBe('Binary PDF content');
  });

  it('17. should throw NotFoundError when accessing a missing file', async () => {
    const missingKey = 'non_existent_path/missing.pdf';
    await expect(storage.getBuffer(missingKey)).rejects.toThrow(NotFoundError);
    await expect(storage.getStream(missingKey)).rejects.toThrow(NotFoundError);
    await expect(storage.getMetadata(missingKey)).rejects.toThrow(NotFoundError);
  });

  it('should support range queries for resumable byte downloads', async () => {
    const key = 'test/range.dat';
    const fullContent = Buffer.from('0123456789ABCDEF', 'utf8'); // 16 bytes
    await storage.save(key, fullContent);

    // Request bytes 4-9 ('456789')
    const rangeStream = await storage.getStream(key, { start: 4, end: 9 });
    const chunks: Buffer[] = [];
    for await (const chunk of rangeStream) {
      chunks.push(chunk);
    }
    const rangeResult = Buffer.concat(chunks).toString('utf8');
    expect(rangeResult).toBe('456789');
  });
});
