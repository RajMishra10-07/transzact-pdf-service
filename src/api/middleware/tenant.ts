import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../domain/errors.js';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Endpoints that don't need tenant validation
  if (['/health', '/ready', '/metrics'].includes(req.path)) {
    return next();
  }

  const headerTenant = req.headers['x-tenant-id'];
  const bodyTenant = req.body?.tenantId;
  const queryTenant = req.query?.tenantId;

  const headerTenantStr = typeof headerTenant === 'string' ? headerTenant.trim() : undefined;
  const bodyTenantStr = typeof bodyTenant === 'string' ? bodyTenant.trim() : undefined;
  const queryTenantStr = typeof queryTenant === 'string' ? queryTenant.trim() : undefined;

  // Strict cross-check: header vs body
  if (headerTenantStr && bodyTenantStr && headerTenantStr !== bodyTenantStr) {
    throw new ForbiddenError(
      `Tenant ID mismatch: header (${headerTenantStr}) does not match payload body (${bodyTenantStr})`
    );
  }

  // Strict cross-check: header vs query
  if (headerTenantStr && queryTenantStr && headerTenantStr !== queryTenantStr) {
    throw new ForbiddenError(
      `Tenant ID mismatch: header (${headerTenantStr}) does not match query parameter (${queryTenantStr})`
    );
  }

  const resolvedTenant = headerTenantStr || bodyTenantStr || queryTenantStr;
  req.tenantId = resolvedTenant;
  next();
}
