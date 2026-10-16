import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../domain/errors.js';

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, RateBucket>();

export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Exclude health endpoints from rate limiting
  if (['/health', '/ready', '/metrics'].includes(req.path)) {
    return next();
  }

  const clientKey = (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = env.RATE_LIMIT_MAX_REQUESTS;

  let bucket = buckets.get(clientKey);
  if (!bucket) {
    bucket = { tokens: maxRequests, lastRefill: now };
    buckets.set(clientKey, bucket);
  } else {
    // Refill tokens proportionally
    const elapsed = now - bucket.lastRefill;
    const refillAmount = Math.floor((elapsed / windowMs) * maxRequests);
    if (refillAmount > 0) {
      bucket.tokens = Math.min(maxRequests, bucket.tokens + refillAmount);
      bucket.lastRefill = now;
    }
  }

  if (bucket.tokens <= 0) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    return next(new AppError('Too many requests, please slow down', 429));
  }

  bucket.tokens--;
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', bucket.tokens);

  next();
}
