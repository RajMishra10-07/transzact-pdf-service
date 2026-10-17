import { Request, Response } from 'express';
import { signupSchema, loginSchema, createUserSchema } from '../schemas/auth-schemas.js';
import { getUserRepository } from '../../database/repositories/repository-factory.js';
import { hashPassword, verifyPassword, signJwt, generateSignedUrl } from '../../utils/auth-crypto.js';
import { AuthenticationError, ConflictError, ForbiddenError } from '../../domain/errors.js';
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
      role: 'viewer', // Public signup always gets role 'viewer'
      tenantId: 'default-tenant', // Public signup cannot pick enterprise tenant
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

  static async createUser(req: Request, res: Response): Promise<void> {
    const input = createUserSchema.parse(req.body);
    const userRepo = getUserRepository();

    const existingUser = await userRepo.findByEmail(input.email);
    if (existingUser) {
      throw new ConflictError(`User with email '${input.email}' already exists`);
    }

    // New user's tenantId must equal the admin's own tenantId
    const adminTenantId = req.user?.tenantId || 'transzact-corp';
    const passwordHash = hashPassword(input.password);
    const createdUser = await userRepo.create({
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
      tenantId: adminTenantId,
    });

    logger.info(
      { userId: createdUser.id, email: createdUser.email, role: createdUser.role, tenantId: createdUser.tenantId, createdBy: req.user?.id },
      'Admin created new user'
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
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

  static async signUrl(req: Request, res: Response): Promise<void> {
    const rawPath = (req.body?.path as string) || (req.query?.path as string);
    if (!rawPath || typeof rawPath !== 'string') {
      res.status(400).json({ error: { message: 'Missing required "path" parameter to sign' } });
      return;
    }

    const tenantId = req.user?.tenantId || (req.headers['x-tenant-id'] as string);
    const extraParams: Record<string, string> = {};
    if (tenantId) {
      extraParams.tenantId = tenantId;
    }

    const signed = generateSignedUrl(rawPath, 300, extraParams);
    res.status(200).json({
      success: true,
      url: signed.url,
      path: rawPath,
      signature: signed.signature,
      expires: signed.expires,
      expiresInSeconds: 300,
    });
  }
}

