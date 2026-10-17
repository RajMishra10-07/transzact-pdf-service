import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { AuthenticationError } from '../../domain/errors.js';
import { AuthUser } from '../../domain/user.js';
import { verifyJwt, verifySignedUrl } from '../../utils/auth-crypto.js';

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

  // Strictly forbid credentials in query parameters (?token=, ?apiKey=, ?x-api-key=)
  if (req.query.token !== undefined || req.query.apiKey !== undefined || req.query['x-api-key'] !== undefined) {
    throw new AuthenticationError(
      'Authentication via query parameters (?token, ?apiKey) is strictly forbidden. Use Authorization or x-api-key headers, or an HMAC-signed URL.'
    );
  }

  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;

  // 1. Check for JWT Bearer Token in Authorization header ONLY
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const jwtToken = authHeader.substring(7).trim();

    // If it matches the M2M API_KEY directly, accept as system admin
    if (jwtToken === env.API_KEY) {
      const tenantId = (req.headers['x-tenant-id'] as string) || 'transzact-corp';
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

  // 2. Check for Machine-to-Machine API Key in x-api-key header ONLY
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    if (apiKeyHeader.trim() === env.API_KEY) {
      const tenantId = (req.headers['x-tenant-id'] as string) || 'transzact-corp';
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

  // 3. Check for Short-Lived HMAC-Signed URL (for browser preview, download & SSE streams)
  const signature = (req.query.signature as string) || (req.query.sig as string);
  const expires = (req.query.expires as string) || (req.query.exp as string);

  if (signature && expires) {
    const fullPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
    const rawPath = req.originalUrl ? req.originalUrl.split('?')[0] : fullPath;
    const isValidSig =
      verifySignedUrl(fullPath, expires, signature) ||
      verifySignedUrl(rawPath, expires, signature) ||
      verifySignedUrl(req.path, expires, signature);

    if (isValidSig) {
      const tenantId =
        (req.query.tenantId as string) ||
        (req.headers['x-tenant-id'] as string) ||
        'transzact-corp';

      req.user = {
        id: 'signed-url-client',
        email: 'signed-url@transzact.internal',
        role: 'viewer', // Read-only access for downloads and event streams
        tenantId,
        name: 'Signed URL Client',
      };
      if (!req.tenantId) {
        req.tenantId = tenantId;
      }
      return next();
    } else {
      throw new AuthenticationError('Invalid or expired signed URL');
    }
  }

  throw new AuthenticationError(
    'Authentication required: please provide a valid JWT Bearer token or API key in headers, or an HMAC-signed URL'
  );
}

