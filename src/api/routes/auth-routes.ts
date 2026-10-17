import { Router } from 'express';
import { AuthController } from '../controllers/auth-controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler } from '../../utils/async-handler.js';

export const authRouter = Router();

// Public Authentication Endpoints
authRouter.post('/auth/signup', asyncHandler(AuthController.signup));
authRouter.post('/auth/login', asyncHandler(AuthController.login));

// Authenticated Endpoints
authRouter.get('/auth/me', authMiddleware, asyncHandler(AuthController.getMe));
authRouter.get(
  '/auth/users',
  authMiddleware,
  requireRole('admin'),
  asyncHandler(AuthController.listUsers)
);

