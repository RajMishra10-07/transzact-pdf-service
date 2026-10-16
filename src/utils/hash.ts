import crypto from 'crypto';

/**
 * Deterministically sorts object keys deeply to produce a canonical JSON string.
 * This guarantees that two identical logical JSON payloads yield the exact same SHA-256 hash.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalizeJson(item)).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map((key) => {
    return JSON.stringify(key) + ':' + canonicalizeJson(record[key]);
  });

  return '{' + entries.join(',') + '}';
}

/**
 * Calculates SHA-256 hash of a canonicalized JSON payload.
 */
export function computeInputHash(payload: unknown): string {
  const canonicalString = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Calculates SHA-256 hash of raw bytes (e.g. generated PDF buffer or stream).
 */
export function computeBufferHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
