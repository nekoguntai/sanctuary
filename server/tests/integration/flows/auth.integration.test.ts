/**
 * Authentication Integration Tests
 *
 * Tests the complete authentication flow:
 * - User registration (via first admin)
 * - Login
 * - Token verification
 * - Password change
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import request from 'supertest';
import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { getTestUser, getTestAdmin, createTestUser, loginTestUser } from '../setup/helpers';
import { PrismaClient } from '@prisma/client';
import { Express } from 'express';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Authentication Integration', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Mock external services before importing routes
    jest.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: jest.fn().mockResolvedValue({
        connect: jest.fn().mockResolvedValue(undefined),
        isConnected: jest.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: jest.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: jest.fn().mockResolvedValue([]),
      }),
    }));

    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('Login Flow', () => {
    it('should login with valid credentials', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.token).toBeDefined();
      expect(typeof response.body.token).toBe('string');
      expect(response.body.user).toBeDefined();
      expect(response.body.user.username).toBe(testUser.username);
      expect(response.body.user.password).toBeUndefined();
    });

    it('should reject invalid password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent_user_12345',
          password: 'SomePassword123!',
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Token Verification', () => {
    it('should access protected endpoint with valid token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.username).toBe(testUser.username);
    });

    it('should reject expired or invalid token', async () => {
      const invalidToken = 'invalid.token.here';

      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);
    });

    it('should reject request without token', async () => {
      await request(app)
        .get('/api/v1/auth/me')
        .expect(401);
    });
  });

  describe('Password Change', () => {
    it('should change password with correct current password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const newPassword = 'NewSecurePassword456!';

      await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: testUser.password,
          newPassword,
        })
        .expect(200);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: newPassword,
        })
        .expect(200);

      expect(loginResponse.body.token).toBeDefined();
    });

    it('should reject password change with wrong current password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'WrongCurrentPassword!',
          newPassword: 'NewPassword456!',
        })
        .expect(401);
    });
  });

  describe('Admin User Management', () => {
    it('should allow admin to create new user', async () => {
      const testAdmin = getTestAdmin();
      await createTestUser(prisma, { ...testAdmin, isAdmin: true });
      const adminToken = await loginTestUser(app, testAdmin);

      const newUsername = `newuser_${Date.now()}`;
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: newUsername,
          password: 'NewUserPassword123!',
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.username).toBe(newUsername);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: newUsername,
          password: 'NewUserPassword123!',
        })
        .expect(200);

      expect(loginResponse.body.token).toBeDefined();
    });

    it('should not allow non-admin to create user', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const userToken = await loginTestUser(app, testUser);

      await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          username: `anotheruser_${Date.now()}`,
          password: 'Password123!',
        })
        .expect(403);
    });
  });

  describe('Token Refresh', () => {
    it('should return valid token on login', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.token).toBeDefined();
      expect(response.body.token.split('.').length).toBe(3);
    });
  });
});
