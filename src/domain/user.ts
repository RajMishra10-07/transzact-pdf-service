export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export type UserPublic = Omit<User, 'passwordHash'>;

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  name?: string;
}
