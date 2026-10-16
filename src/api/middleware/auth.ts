import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { AuthenticationError } from '../../domain/errors.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // In development, allow bypass if configured
  if (env.DEV_AUTH_BYPASS) {
    return next();
  }

  // Health and readiness endpoints are unauthenticated
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;

  let providedKey: string | undefined;

  if (typeof apiKeyHeader === 'string') {
    providedKey = apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  }

  if (!providedKey || providedKey !== env.API_KEY) {
    throw new AuthenticationError('Invalid or missing API key');
  }

  next();
}
