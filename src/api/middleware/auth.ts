import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { AuthenticationError } from '../../domain/errors.js';
import { AuthUser } from '../../domain/user.js';
import { verifyJwt } from '../../utils/auth-crypto.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // In development, allow bypass if explicitly enabled
  if (env.DEV_AUTH_BYPASS) {
    req.user = {
      id: 'dev-bypass-user',
      email: 'dev@transzact.local',
      role: 'admin',
      tenantId: 'transzact-corp',
      name: 'Developer Superuser',
    };
    return next();
  }

  // Health and readiness endpoints are unauthenticated
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  // Auth endpoints (login and signup) are unauthenticated
  if (req.path === '/auth/login' || req.path === '/auth/signup' || req.path.endsWith('/login') || req.path.endsWith('/signup')) {
    return next();
  }

  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  const queryApiKey = (req.query.apiKey as string) || (req.query['x-api-key'] as string);
  const queryToken = req.query.token as string | undefined;

  // 1. Check for JWT Bearer Token (Header or Query ?token=)
  let jwtToken: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    jwtToken = authHeader.substring(7).trim();
  } else if (typeof queryToken === 'string' && queryToken.trim()) {
    jwtToken = queryToken.trim();
  }

  // If a JWT or Bearer string is provided:
  if (jwtToken) {
    // If it matches the M2M API_KEY directly, accept as system admin
    if (jwtToken === env.API_KEY) {
      const tenantId =
        (req.headers['x-tenant-id'] as string) ||
        (req.query.tenantId as string) ||
        'transzact-corp';

      req.user = {
        id: 'm2m-service-client',
        email: 'erp-m2m@transzact.internal',
        role: 'admin',
        tenantId,
        name: 'ERP Internal System',
      };
      if (!req.tenantId) {
        req.tenantId = tenantId;
      }
      return next();
    }

    try {
      const claims = verifyJwt(jwtToken);
      req.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        tenantId: claims.tenantId,
        name: claims.name,
      };
      if (!req.tenantId) {
        req.tenantId = claims.tenantId;
      }
      return next();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError('Invalid authentication token');
    }
  }

  // 2. Check for Machine-to-Machine API Key (Header or Query)
  const apiKeyCandidate = typeof apiKeyHeader === 'string' ? apiKeyHeader : queryApiKey;
  if (apiKeyCandidate) {
    if (apiKeyCandidate === env.API_KEY) {
      const tenantId =
        (req.headers['x-tenant-id'] as string) ||
        (req.query.tenantId as string) ||
        'transzact-corp';

      req.user = {
        id: 'm2m-service-client',
        email: 'erp-m2m@transzact.internal',
        role: 'admin',
        tenantId,
        name: 'ERP Internal System',
      };
      if (!req.tenantId) {
        req.tenantId = tenantId;
      }
      return next();
    } else {
      throw new AuthenticationError('Invalid API key provided');
    }
  }

  throw new AuthenticationError('Authentication required: please provide a valid JWT Bearer token or API key');
}
