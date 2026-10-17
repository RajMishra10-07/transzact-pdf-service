import { z } from 'zod';

export const userRoleSchema = z.enum(['admin', 'operator', 'viewer']);
// Public signup schema: Users cannot choose their role or tenantId
export const signupSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((val) => val.trim().toLowerCase()),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(128, 'Password must not exceed 128 characters'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100)
    .trim()
    .default('ERP User'),
});

// Admin-only user creation schema: Allows authenticated admin to create user with a role
export const createUserSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((val) => val.trim().toLowerCase()),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(128, 'Password must not exceed 128 characters'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100)
    .trim()
    .default('ERP User'),
  role: userRoleSchema.default('operator'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .transform((val) => val.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

