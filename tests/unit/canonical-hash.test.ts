import { describe, it, expect } from 'vitest';
import { canonicalizeJson, computeInputHash, computeBufferHash } from '../../src/utils/hash.js';

describe('Canonical JSON and Hashing (Snapshot Immutability)', () => {
  it('should deterministically sort object keys deeply', () => {
    const objA = {
      b: 2,
      a: 1,
      nested: { y: 'last', x: 'first' },
      arr: [{ d: 4, c: 3 }],
    };

    const objB = {
      nested: { x: 'first', y: 'last' },
      a: 1,
      arr: [{ c: 3, d: 4 }],
      b: 2,
    };

    const canonicalA = canonicalizeJson(objA);
    const canonicalB = canonicalizeJson(objB);

    expect(canonicalA).toBe(canonicalB);
  });

  it('should produce identical SHA-256 hashes for logically identical payloads regardless of key order', () => {
    const payload1 = {
      tenantId: 'tenant_123',
      documentId: 'INV-001',
      items: [{ name: 'Widget A', price: 100 }, { name: 'Widget B', price: 200 }],
    };

    const payload2 = {
      documentId: 'INV-001',
      tenantId: 'tenant_123',
      items: [{ name: 'Widget A', price: 100 }, { price: 200, name: 'Widget B' }],
    };

    const hash1 = computeInputHash(payload1);
    const hash2 = computeInputHash(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // Valid SHA-256 hex string
  });

  it('should produce different SHA-256 hashes when payload data differs', () => {
    const hash1 = computeInputHash({ amount: 100 });
    const hash2 = computeInputHash({ amount: 101 });
    expect(hash1).not.toBe(hash2);
  });

  it('should compute valid SHA-256 hash for raw Buffer', () => {
    const buffer = Buffer.from('Test PDF Binary Content', 'utf8');
    const hash = computeBufferHash(buffer);
    expect(hash).toHaveLength(64);
  });
});
