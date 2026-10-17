import crypto from 'crypto';
import { env } from '../config/env.js';
import { AuthenticationError } from '../domain/errors.js';
import { UserRole } from '../domain/user.js';

export interface JwtClaims {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
  name?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) {
      return false;
    }
    const [salt, expectedHash] = parts;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    if (derivedKey.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, expectedBuffer);
  } catch {
    return false;
  }
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}

export function signJwt(claims: JwtClaims, expiresInSeconds = env.JWT_EXPIRES_IN_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload: JwtClaims = {
    ...claims,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
}

export function verifyJwt(token: string): JwtClaims {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('Missing authentication token');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('Malformed JWT token structure');
  }

  const [headerEncoded, payloadEncoded, signatureProvided] = parts;
  const data = `${headerEncoded}.${payloadEncoded}`;

  const expectedSignature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(data)
    .digest('base64url');

  const providedBuffer = Buffer.from(signatureProvided);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AuthenticationError('Invalid JWT token signature');
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch {
    throw new AuthenticationError('Invalid JWT token payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < now) {
    throw new AuthenticationError('JWT token has expired. Please log in again.');
  }

  return claims;
}

/**
 * Generates an HMAC-SHA256 signature for path + expiry (default 5 minutes / 300s).
 */
export function generateSignedUrl(
  path: string,
  expiresInSeconds = 300,
  extraParams?: Record<string, string>
): { url: string; signature: string; expires: number } {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const [basePath, existingQuery] = path.split('?');
  const cleanPath = basePath.startsWith('/') ? basePath : `/${basePath}`;
  const data = `${cleanPath}${expires}`;
  const signature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(data)
    .digest('hex');

  const queryParams = new URLSearchParams(existingQuery || '');
  queryParams.set('expires', expires.toString());
  queryParams.set('signature', signature);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== null) {
        queryParams.set(k, v);
      }
    }
  }

  const url = `${cleanPath}?${queryParams.toString()}`;
  return { url, signature, expires };
}

/**
 * Validates HMAC-SHA256 signature for path + expiry.
 */
export function verifySignedUrl(
  path: string,
  expires: string | number,
  signature: string
): boolean {
  if (!expires || !signature) {
    return false;
  }
  const expNum = typeof expires === 'string' ? parseInt(expires, 10) : expires;
  if (isNaN(expNum)) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (expNum < now) {
    return false; // Expired
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const expected1 = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${cleanPath}${expNum}`)
    .digest('hex');

  const expected2 = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${cleanPath}:${expNum}`)
    .digest('hex');

  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer1 = Buffer.from(expected1, 'utf8');
  const expectedBuffer2 = Buffer.from(expected2, 'utf8');

  const matches1 =
    providedBuffer.length === expectedBuffer1.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer1);

  const matches2 =
    providedBuffer.length === expectedBuffer2.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer2);

  return matches1 || matches2;
}

