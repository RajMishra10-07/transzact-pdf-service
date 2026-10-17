import { Request, Response } from 'express';
import { signupSchema, loginSchema } from '../schemas/auth-schemas.js';
import { getUserRepository } from '../../database/repositories/repository-factory.js';
import { hashPassword, verifyPassword, signJwt } from '../../utils/auth-crypto.js';
import { AuthenticationError, ConflictError } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';

export class AuthController {
  static async signup(req: Request, res: Response): Promise<void> {
    const input = signupSchema.parse(req.body);
    const userRepo = getUserRepository();

    const existingUser = await userRepo.findByEmail(input.email);
    if (existingUser) {
      throw new ConflictError(`User with email '${input.email}' already exists`);
    }

    const passwordHash = hashPassword(input.password);
    const createdUser = await userRepo.create({
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
      tenantId: input.tenantId,
    });

    const token = signJwt({
      sub: createdUser.id,
      email: createdUser.email,
      role: createdUser.role,
      tenantId: createdUser.tenantId,
      name: createdUser.name,
    });

    logger.info({ userId: createdUser.id, email: createdUser.email, role: createdUser.role }, 'User registered successfully');

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
        tenantId: createdUser.tenantId,
        createdAt: createdUser.createdAt,
      },
    });
  }

  static async login(req: Request, res: Response): Promise<void> {
    const input = loginSchema.parse(req.body);
    const userRepo = getUserRepository();

    const user = await userRepo.findByEmail(input.email);
    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }

    const isValid = verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new AuthenticationError('Invalid email or password');
    }

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      name: user.name,
    });

    logger.info({ userId: user.id, email: user.email, role: user.role }, 'User logged in successfully');

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        createdAt: user.createdAt,
      },
    });
  }

  static async getMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new AuthenticationError('Not authenticated');
    }

    res.status(200).json({
      success: true,
      user: req.user,
    });
  }

  static async listUsers(req: Request, res: Response): Promise<void> {
    const userRepo = getUserRepository();
    const users = await userRepo.listUsers(req.user?.tenantId);
    res.status(200).json({
      success: true,
      users,
    });
  }
}
