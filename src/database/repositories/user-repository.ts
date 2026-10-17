import { generateUuid } from '../../utils/ids.js';
import { User, UserPublic, UserRole } from '../../domain/user.js';
import { hashPassword } from '../../utils/auth-crypto.js';
import { dbPool } from '../client.js';
import { logger } from '../../utils/logger.js';

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  listUsers(tenantId?: string): Promise<UserPublic[]>;
}

export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, User> = new Map();

  constructor() {
    this.seedDefaultUsers();
  }

  private seedDefaultUsers(): void {
    const defaultPassword = 'password123';
    const passwordHash = hashPassword(defaultPassword);

    const defaultAccounts: Array<{
      email: string;
      name: string;
      role: UserRole;
      tenantId: string;
    }> = [
      {
        email: 'admin@transzact.com',
        name: 'Enterprise Admin',
        role: 'admin',
        tenantId: 'transzact-corp',
      },
      {
        email: 'operator@transzact.com',
        name: 'Operations Specialist',
        role: 'operator',
        tenantId: 'transzact-corp',
      },
      {
        email: 'viewer@transzact.com',
        name: 'Audit Viewer',
        role: 'viewer',
        tenantId: 'transzact-corp',
      },
    ];

    const now = new Date().toISOString();
    for (const acc of defaultAccounts) {
      const id = generateUuid();
      this.users.set(acc.email.toLowerCase(), {
        id,
        email: acc.email.toLowerCase(),
        passwordHash,
        name: acc.name,
        role: acc.role,
        tenantId: acc.tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = this.users.get(email.toLowerCase());
    return user ? { ...user } : null;
  }

  async findById(id: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.id === id) {
        return { ...user };
      }
    }
    return null;
  }

  async create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      id: generateUuid(),
      email: userData.email.toLowerCase(),
      passwordHash: userData.passwordHash,
      name: userData.name,
      role: userData.role,
      tenantId: userData.tenantId,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.email, user);
    return { ...user };
  }

  async listUsers(tenantId?: string): Promise<UserPublic[]> {
    const list: UserPublic[] = [];
    for (const user of this.users.values()) {
      if (!tenantId || user.tenantId === tenantId) {
        const { passwordHash: _, ...userPublic } = user;
        list.push(userPublic);
      }
    }
    return list;
  }
}

export class PgUserRepository implements IUserRepository {
  private inMemoryFallback: InMemoryUserRepository = new InMemoryUserRepository();

  async findByEmail(email: string): Promise<User | null> {
    try {
      const res = await dbPool.query(
        'SELECT id, email, password_hash AS "passwordHash", name, role, tenant_id AS "tenantId", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      if (res.rows.length === 0) {
        // Fall back to inMemory demo users if not found in DB
        return this.inMemoryFallback.findByEmail(email);
      }
      return res.rows[0];
    } catch (err) {
      logger.warn({ err }, 'PostgreSQL user query failed, falling back to in-memory store');
      return this.inMemoryFallback.findByEmail(email);
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      const res = await dbPool.query(
        'SELECT id, email, password_hash AS "passwordHash", name, role, tenant_id AS "tenantId", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE id = $1',
        [id]
      );
      if (res.rows.length === 0) {
        return this.inMemoryFallback.findById(id);
      }
      return res.rows[0];
    } catch (err) {
      logger.warn({ err }, 'PostgreSQL user query failed, falling back to in-memory store');
      return this.inMemoryFallback.findById(id);
    }
  }

  async create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    try {
      const id = generateUuid();
      const res = await dbPool.query(
        `INSERT INTO users (id, email, password_hash, name, role, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, password_hash AS "passwordHash", name, role, tenant_id AS "tenantId", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, userData.email.toLowerCase(), userData.passwordHash, userData.name, userData.role, userData.tenantId]
      );
      return res.rows[0];
    } catch (err) {
      logger.warn({ err }, 'PostgreSQL user insert failed, falling back to in-memory store');
      return this.inMemoryFallback.create(userData);
    }
  }

  async listUsers(tenantId?: string): Promise<UserPublic[]> {
    try {
      const query = tenantId
        ? 'SELECT id, email, name, role, tenant_id AS "tenantId", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE tenant_id = $1 ORDER BY created_at ASC'
        : 'SELECT id, email, name, role, tenant_id AS "tenantId", created_at AS "createdAt", updated_at AS "updatedAt" FROM users ORDER BY created_at ASC';
      const params = tenantId ? [tenantId] : [];
      const res = await dbPool.query(query, params);
      if (res.rows.length === 0) {
        return this.inMemoryFallback.listUsers(tenantId);
      }
      return res.rows;
    } catch (err) {
      logger.warn({ err }, 'PostgreSQL user list failed, falling back to in-memory store');
      return this.inMemoryFallback.listUsers(tenantId);
    }
  }
}
