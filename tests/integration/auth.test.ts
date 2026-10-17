import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { setForceInMemoryRepositories } from '../../src/database/repositories/repository-factory.js';
import { setForceInMemoryQueue } from '../../src/queue/queues.js';
import { signJwt } from '../../src/utils/auth-crypto.js';

describe('Role-Based Access Control (RBAC) & JWT Authentication', () => {
  beforeEach(() => {
    setForceInMemoryRepositories(true);
    setForceInMemoryQueue(true);
  });

  describe('User Registration (Signup)', () => {
    it('should successfully register a new user with role viewer and default tenant', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'newviewer@acme.com',
          password: 'securePassword123!',
          name: 'Jane Viewer',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toMatchObject({
        email: 'newviewer@acme.com',
        name: 'Jane Viewer',
        role: 'viewer',
        tenantId: 'default-tenant',
      });
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('should reject registration with duplicate email with 409 Conflict', async () => {
      // First registration
      await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'duplicate@acme.com',
          password: 'password123',
          name: 'First User',
        });

      // Second registration with same email
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'duplicate@acme.com',
          password: 'anotherPassword123',
          name: 'Second User',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already exists');
    });

    it('should reject registration with invalid password or email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'not-an-email',
          password: '123', // < 6 chars
        });

      expect(res.status).toBe(400);
    });

    it('public signup should ignore role and tenantId inputs and always assign viewer', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'hacker@malicious.com',
          password: 'securePassword123!',
          name: 'Privilege Escalator',
          role: 'admin',
          tenantId: 'transzact-corp',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('viewer');
      expect(res.body.user.tenantId).toBe('default-tenant');
    });
  });

  describe('Admin User Creation (POST /api/v1/auth/users)', () => {
    it('should allow authenticated admin to create an operator with same tenantId', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@transzact.com', password: 'password123' });
      const adminToken = loginRes.body.token;

      const res = await request(app)
        .post('/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'createdoperator@transzact.com',
          password: 'password123',
          name: 'New Operator',
          role: 'operator',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({
        email: 'createdoperator@transzact.com',
        role: 'operator',
        tenantId: 'transzact-corp',
      });
    });

    it('should reject non-admin from creating users with 403 Forbidden', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'operator@transzact.com', password: 'password123' });
      const opToken = loginRes.body.token;

      const res = await request(app)
        .post('/api/v1/auth/users')
        .set('Authorization', `Bearer ${opToken}`)
        .send({
          email: 'unauthorized@transzact.com',
          password: 'password123',
          role: 'viewer',
        });

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated request to POST /api/v1/auth/users with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/users')
        .send({
          email: 'unauthenticated@transzact.com',
          password: 'password123',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('User Authentication (Login)', () => {
    it('should successfully login with seeded demo accounts', async () => {
      const roles = ['admin@transzact.com', 'operator@transzact.com', 'viewer@transzact.com'];

      for (const email of roles) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email,
            password: 'password123',
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
        expect(res.body.user.email).toBe(email);
      }
    });

    it('should reject login with wrong password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@transzact.com',
          password: 'incorrect-password',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Invalid email or password');
    });

    it('should reject login for non-existent user with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'ghost@nowhere.com',
          password: 'password123',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('Session Inspection (GET /api/v1/auth/me)', () => {
    it('should return user details when Bearer token is provided', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'operator@transzact.com',
          password: 'password123',
        });

      const token = loginRes.body.token;

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user).toMatchObject({
        email: 'operator@transzact.com',
        role: 'operator',
      });
    });

    it('should reject requests without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Role-Based Authorization Enforcement (RBAC)', () => {
    let adminToken: string;
    let operatorToken: string;
    let viewerToken: string;

    beforeEach(async () => {
      const adminLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@transzact.com',
        password: 'password123',
      });
      adminToken = adminLogin.body.token;

      const operatorLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'operator@transzact.com',
        password: 'password123',
      });
      operatorToken = operatorLogin.body.token;

      const viewerLogin = await request(app).post('/api/v1/auth/login').send({
        email: 'viewer@transzact.com',
        password: 'password123',
      });
      viewerToken = viewerLogin.body.token;
    });

    it('OPERATOR and ADMIN can trigger document generation', async () => {
      const payload = {
        documentType: 'invoice',
        documentId: 'INV-AUTH-OP-01',
        tenantId: 'transzact-corp',
        options: { preferSync: false },
        data: {
          invoiceNumber: 'INV-AUTH-OP-01',
          invoiceDate: '2026-10-17',
          dueDate: '2026-11-17',
          currency: 'INR',
          supplier: { name: 'Acme Supplies', gstin: '27AABCA1234F1Z6', addressLine1: 'Plot 10', city: 'Mumbai', state: 'MH', pincode: '400001' },
          customer: { name: 'Client Corp', addressLine1: 'Plot 20', city: 'Pune', state: 'MH', pincode: '411001' },
          items: [{ description: 'Item 1', quantity: 1, unit: 'PCS', unitPrice: 100, taxableAmount: 100, totalAmount: 118 }],
          subtotal: 100,
          totalTax: 18,
          grandTotal: 118,
        },
      };

      // Operator should succeed (202 accepted)
      const opRes = await request(app)
        .post('/api/v1/documents/generate')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send(payload);

      expect(opRes.status).toBe(202);

      // Admin should succeed (202 accepted)
      payload.documentId = 'INV-AUTH-ADMIN-01';
      payload.data.invoiceNumber = 'INV-AUTH-ADMIN-01';
      const adminRes = await request(app)
        .post('/api/v1/documents/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(adminRes.status).toBe(202);
    });

    it('VIEWER is FORBIDDEN (403) from generating documents', async () => {
      const payload = {
        documentType: 'invoice',
        documentId: 'INV-AUTH-VIEWER-01',
        tenantId: 'transzact-corp',
        options: { preferSync: false },
        data: {
          invoiceNumber: 'INV-AUTH-VIEWER-01',
          invoiceDate: '2026-10-17',
          dueDate: '2026-11-17',
          currency: 'INR',
          supplier: { name: 'Acme Supplies', gstin: '27AABCA1234F1Z6', addressLine1: 'Plot 10', city: 'Mumbai', state: 'MH', pincode: '400001' },
          buyer: { name: 'Client Corp', addressLine1: 'Plot 20', city: 'Pune', state: 'MH', pincode: '411001' },
          items: [{ description: 'Item 1', quantity: 1, unitPrice: 100, taxableAmount: 100, totalAmount: 118 }],
          subtotal: 100,
          totalTax: 18,
          grandTotal: 118,
        },
      };

      const res = await request(app)
        .post('/api/v1/documents/generate')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send(payload);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Access denied');
      expect(res.body.error.message).toContain('viewer');
    });

    it('VIEWER is FORBIDDEN (403) from triggering bulk generation', async () => {
      const res = await request(app)
        .post('/api/v1/documents/bulk')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          tenantId: 'transzact-corp',
          documents: [
            {
              documentType: 'invoice',
              documentId: 'INV-BULK-V-1',
              tenantId: 'transzact-corp',
              data: {
                invoiceNumber: 'INV-BULK-V-1',
                invoiceDate: '2026-10-17',
                dueDate: '2026-11-17',
                currency: 'INR',
                supplier: { name: 'A', gstin: '27AABCA1234F1Z6', addressLine1: '1', city: 'M', state: 'MH', pincode: '400001' },
                buyer: { name: 'B', addressLine1: '2', city: 'P', state: 'MH', pincode: '411001' },
                items: [{ description: 'x', quantity: 1, unitPrice: 10, taxableAmount: 10, totalAmount: 11.8 }],
                subtotal: 10,
                totalTax: 1.8,
                grandTotal: 11.8,
              },
            },
          ],
        });

      expect(res.status).toBe(403);
    });

    it('ADMIN can view tenant user list, but OPERATOR and VIEWER are blocked (403)', async () => {
      // Admin request
      const adminRes = await request(app)
        .get('/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(Array.isArray(adminRes.body.users)).toBe(true);

      // Operator request -> 403 Forbidden
      const opRes = await request(app)
        .get('/api/v1/auth/users')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(opRes.status).toBe(403);

      // Viewer request -> 403 Forbidden
      const viewerRes = await request(app)
        .get('/api/v1/auth/users')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRes.status).toBe(403);
    });

    it('rejects tampered or forged JWT tokens with 401', async () => {
      const forgedToken = adminToken.slice(0, -6) + 'abcdef';
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('signature');
    });

    it('rejects expired JWT tokens with 401', async () => {
      // Create a token expired 10 seconds ago
      const expiredToken = signJwt(
        {
          sub: 'expired-user-id',
          email: 'expired@transzact.com',
          role: 'admin',
          tenantId: 'transzact-corp',
        },
        -10
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('expired');
    });
  });
});
