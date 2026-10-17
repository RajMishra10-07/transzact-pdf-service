import { z } from 'zod';

export const userRoleSchema = z.enum(['admin', 'operator', 'viewer']);
export const publicSignupRoleSchema = z.enum(['operator', 'viewer']);

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
  role: publicSignupRoleSchema.default('operator'),
  tenantId: z
    .string()
    .min(1, 'Tenant ID cannot be empty')
    .max(64)
    .trim()
    .default('default-tenant'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .transform((val) => val.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

