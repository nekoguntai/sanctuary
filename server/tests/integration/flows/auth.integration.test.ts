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
        .post('/api/v1/auth/me/change-password')
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
        .post('/api/v1/auth/me/change-password')
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

    it('should return refresh token on login', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.refreshToken.split('.').length).toBe(3);
    });

    it('should refresh access token using refresh token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const refreshToken = loginResponse.body.refreshToken;

      const refreshResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, rotate: true })
        .expect(200);

      expect(refreshResponse.body.token).toBeDefined();
      expect(refreshResponse.body.refreshToken).toBeDefined();
      // New refresh token should be different (rotation)
      expect(refreshResponse.body.refreshToken).not.toBe(refreshToken);
    });
  });

  describe('Logout', () => {
    it('should logout and invalidate access token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token, refreshToken } = loginResponse.body;

      // Logout
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken })
        .expect(200);

      // Access token should now be invalid
      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('should logout and invalidate refresh token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token, refreshToken } = loginResponse.body;

      // Logout with refresh token
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken })
        .expect(200);

      // Refresh token should now be invalid
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('Logout All Sessions', () => {
    it('should logout from all devices', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Login twice to simulate two sessions
      const login1 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const login2 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Logout all from first session
      const logoutResponse = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${login1.body.token}`)
        .expect(200);

      expect(logoutResponse.body.sessionsRevoked).toBeGreaterThanOrEqual(2);

      // Both refresh tokens should now be invalid
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login1.body.refreshToken })
        .expect(401);

      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login2.body.refreshToken })
        .expect(401);
    });
  });

  describe('Session Management', () => {
    it('should list active sessions', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Login to create a session
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const response = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${loginResponse.body.token}`)
        .expect(200);

      expect(response.body.sessions).toBeDefined();
      expect(Array.isArray(response.body.sessions)).toBe(true);
      expect(response.body.sessions.length).toBeGreaterThanOrEqual(1);

      // Check session structure
      const session = response.body.sessions[0];
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.lastUsedAt).toBeDefined();
    });

    it('should mark current session', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const response = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${loginResponse.body.token}`)
        .set('X-Refresh-Token', loginResponse.body.refreshToken)
        .expect(200);

      const currentSession = response.body.sessions.find((s: any) => s.isCurrent);
      expect(currentSession).toBeDefined();
    });

    it('should revoke specific session', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Create two sessions
      const login1 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const login2 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Get sessions from first login
      const sessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${login1.body.token}`)
        .expect(200);

      expect(sessionsResponse.body.sessions.length).toBe(2);

      // Find the session that's not current and revoke it
      const otherSession = sessionsResponse.body.sessions.find((s: any) => !s.isCurrent);
      expect(otherSession).toBeDefined();

      await request(app)
        .delete(`/api/v1/auth/sessions/${otherSession.id}`)
        .set('Authorization', `Bearer ${login1.body.token}`)
        .expect(200);

      // Verify the session was revoked
      const newSessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${login1.body.token}`)
        .expect(200);

      expect(newSessionsResponse.body.sessions.length).toBe(1);
    });

    it('should not allow revoking another user session', async () => {
      const testUser = getTestUser();
      const testAdmin = getTestAdmin();
      await createTestUser(prisma, testUser);
      await createTestUser(prisma, { ...testAdmin, isAdmin: true });

      // Login as both users
      const userLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testAdmin.username,
          password: testAdmin.password,
        })
        .expect(200);

      // Get user's sessions
      const sessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${userLogin.body.token}`)
        .expect(200);

      const userSessionId = sessionsResponse.body.sessions[0].id;

      // Try to revoke user's session as admin (should fail - each user manages their own sessions)
      await request(app)
        .delete(`/api/v1/auth/sessions/${userSessionId}`)
        .set('Authorization', `Bearer ${adminLogin.body.token}`)
        .expect(404);
    });
  });
});
