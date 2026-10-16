import crypto from 'crypto';

export function generateUuid(): string {
  return crypto.randomUUID();
}

export function generateId(prefix = 'doc'): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
