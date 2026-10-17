import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../../domain/user.js';
import { AuthenticationError, ForbiddenError } from '../../domain/errors.js';

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required to access this resource');
    }

    // Admins always have superuser access across all endpoints
    if (req.user.role === 'admin') {
      return next();
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    throw new ForbiddenError(
      `Access denied: required role(s) [${allowedRoles.join(', ')}], but your current role is '${req.user.role}'`
    );
  };
}
