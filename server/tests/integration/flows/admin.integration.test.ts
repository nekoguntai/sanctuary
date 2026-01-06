/**
 * Admin API Integration Tests
 *
 * Tests admin-only endpoints for user and group management.
 * Uses real database transactions with rollback for isolation.
 */

import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createTestApp, resetTestApp } from '../setup/testServer';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  canRunIntegrationTests,
} from '../setup/testDatabase';

// Skip tests if no database available
const describeIfDb = canRunIntegrationTests() ? describe : describe.skip;

describeIfDb('Admin API Integration', () => {
  let app: Express;
  let prisma: PrismaClient;

  // Helper to generate unique usernames
  function uniqueUsername(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // Helper to create admin user and get token
  async function createAdminAndLogin(): Promise<{ adminId: string; token: string }> {
    const username = uniqueUsername('admin');
    const password = 'AdminPass123!';
    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        isAdmin: true,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);

    return { adminId: admin.id, token: response.body.token };
  }

  // Helper to create regular user and get token
  async function createUserAndLogin(): Promise<{ userId: string; token: string; username: string }> {
    const username = uniqueUsername('user');
    const password = 'UserPass123!';
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        isAdmin: false,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);

    return { userId: user.id, token: response.body.token, username };
  }

  function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = createTestApp();
    prisma = await setupTestDatabase();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  // =============================================
  // USER MANAGEMENT
  // =============================================

  describe('User Management', () => {
    describe('GET /api/v1/admin/users', () => {
      it('should return all users for admin', async () => {
        const { token } = await createAdminAndLogin();

        // Create some test users
        await prisma.user.createMany({
          data: [
            { username: uniqueUsername('test1'), password: 'hash1' },
            { username: uniqueUsername('test2'), password: 'hash2' },
          ],
        });

        const response = await request(app)
          .get('/api/v1/admin/users')
          .set(authHeader(token))
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(3); // admin + 2 test users
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0]).toHaveProperty('username');
        expect(response.body[0]).not.toHaveProperty('password'); // Should not expose password
      });

      it('should deny access to non-admin users', async () => {
        const { token } = await createUserAndLogin();

        await request(app)
          .get('/api/v1/admin/users')
          .set(authHeader(token))
          .expect(403);
      });

      it('should deny access without authentication', async () => {
        await request(app)
          .get('/api/v1/admin/users')
          .expect(401);
      });
    });

    describe('POST /api/v1/admin/users', () => {
      it('should create a new user as admin', async () => {
        const { token } = await createAdminAndLogin();
        const newUsername = uniqueUsername('newuser');

        const response = await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'NewUserPass123!',
            email: `${newUsername}@example.com`,
            isAdmin: false,
          })
          .expect(201);

        expect(response.body.username).toBe(newUsername);
        expect(response.body.isAdmin).toBe(false);
        expect(response.body).not.toHaveProperty('password');

        // Verify user exists in database
        const user = await prisma.user.findUnique({
          where: { username: newUsername },
        });
        expect(user).toBeTruthy();
      });

      it('should create admin user when isAdmin is true', async () => {
        const { token } = await createAdminAndLogin();
        const newUsername = uniqueUsername('newadmin');

        const response = await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: newUsername,
            password: 'AdminPass123!',
            isAdmin: true,
          })
          .expect(201);

        expect(response.body.isAdmin).toBe(true);

        // Verify admin flag in database
        const user = await prisma.user.findUnique({
          where: { username: newUsername },
        });
        expect(user?.isAdmin).toBe(true);
      });

      it('should reject duplicate username', async () => {
        const { token } = await createAdminAndLogin();
        const existingUsername = uniqueUsername('existing');

        // Create existing user
        await prisma.user.create({
          data: { username: existingUsername, password: 'hash' },
        });

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: existingUsername,
            password: 'Password123!',
          })
          .expect(409);
      });

      it('should reject weak password', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: uniqueUsername('weakpass'),
            password: 'weak', // Too short, no uppercase, no number
          })
          .expect(400);
      });

      it('should reject username shorter than 3 characters', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: 'ab',
            password: 'ValidPass123!',
          })
          .expect(400);
      });

      it('should reject duplicate email', async () => {
        const { token } = await createAdminAndLogin();
        const uniqueEmail = `duplicate_${Date.now()}@example.com`;

        // Create user with email
        await prisma.user.create({
          data: {
            username: uniqueUsername('first'),
            password: 'hash',
            email: uniqueEmail,
          },
        });

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: uniqueUsername('second'),
            password: 'Password123!',
            email: uniqueEmail,
          })
          .expect(409);
      });

      it('should deny non-admin from creating users', async () => {
        const { token } = await createUserAndLogin();

        await request(app)
          .post('/api/v1/admin/users')
          .set(authHeader(token))
          .send({
            username: uniqueUsername('test'),
            password: 'Password123!',
          })
          .expect(403);
      });
    });

    describe('PUT /api/v1/admin/users/:userId', () => {
      it('should update user username', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username: oldUsername } = await createUserAndLogin();
        const newUsername = uniqueUsername('updated');

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ username: newUsername })
          .expect(200);

        expect(response.body.username).toBe(newUsername);

        // Verify old username no longer exists
        const oldUser = await prisma.user.findUnique({
          where: { username: oldUsername },
        });
        expect(oldUser).toBeNull();
      });

      it('should update user email', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();
        const newEmail = `newemail_${Date.now()}@example.com`;

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ email: newEmail })
          .expect(200);

        expect(response.body.email).toBe(newEmail);
      });

      it('should update user password', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();
        const newPassword = 'NewPassword123!';

        await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ password: newPassword })
          .expect(200);

        // Verify new password works
        await request(app)
          .post('/api/v1/auth/login')
          .send({ username, password: newPassword })
          .expect(200);
      });

      it('should promote user to admin', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const response = await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ isAdmin: true })
          .expect(200);

        expect(response.body.isAdmin).toBe(true);

        // Verify in database
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user?.isAdmin).toBe(true);
      });

      it('should demote admin to regular user', async () => {
        const { token: superAdminToken } = await createAdminAndLogin();
        const { adminId } = await createAdminAndLogin(); // Another admin

        const response = await request(app)
          .put(`/api/v1/admin/users/${adminId}`)
          .set(authHeader(superAdminToken))
          .send({ isAdmin: false })
          .expect(200);

        expect(response.body.isAdmin).toBe(false);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .put('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .send({ username: 'test' })
          .expect(404);
      });

      it('should reject duplicate username on update', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();
        const existingUsername = uniqueUsername('existing');

        // Create another user with the target username
        await prisma.user.create({
          data: { username: existingUsername, password: 'hash' },
        });

        await request(app)
          .put(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .send({ username: existingUsername })
          .expect(409);
      });
    });

    describe('DELETE /api/v1/admin/users/:userId', () => {
      it('should delete a user', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        await request(app)
          .delete(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify user is deleted
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user).toBeNull();

        // Verify can't login anymore
        await request(app)
          .post('/api/v1/auth/login')
          .send({ username, password: 'UserPass123!' })
          .expect(401);
      });

      it('should cascade delete wallet user associations', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        // Create wallet for user
        const wallet = await prisma.wallet.create({
          data: {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: { userId, role: 'owner' },
            },
          },
        });

        // Verify user-wallet association exists
        const associationBefore = await prisma.walletUser.findUnique({
          where: { walletId_userId: { userId, walletId: wallet.id } },
        });
        expect(associationBefore).toBeTruthy();

        await request(app)
          .delete(`/api/v1/admin/users/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify user-wallet association is deleted (cascade)
        const associationAfter = await prisma.walletUser.findUnique({
          where: { walletId_userId: { userId, walletId: wallet.id } },
        });
        expect(associationAfter).toBeNull();
      });

      it('should prevent self-deletion', async () => {
        const { adminId, token } = await createAdminAndLogin();

        await request(app)
          .delete(`/api/v1/admin/users/${adminId}`)
          .set(authHeader(token))
          .expect(400);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .delete('/api/v1/admin/users/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .expect(404);
      });
    });
  });

  // =============================================
  // GROUP MANAGEMENT
  // =============================================

  describe('Group Management', () => {
    describe('GET /api/v1/admin/groups', () => {
      it('should return all groups for admin', async () => {
        const { token } = await createAdminAndLogin();

        // Create test groups
        await prisma.group.createMany({
          data: [
            { name: 'Group A', description: 'First group' },
            { name: 'Group B', description: 'Second group' },
          ],
        });

        const response = await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(2);
        expect(response.body[0]).toHaveProperty('name');
        expect(response.body[0]).toHaveProperty('members');

        // Verify our test groups are in the response
        const groupNames = response.body.map((g: { name: string }) => g.name);
        expect(groupNames).toContain('Group A');
        expect(groupNames).toContain('Group B');
      });

      it('should include group members in response', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        const response = await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(200);

        const testGroup = response.body.find((g: { id: string }) => g.id === group.id);
        expect(testGroup.members).toHaveLength(1);
        expect(testGroup.members[0].username).toBe(username);
      });

      it('should deny access to non-admin', async () => {
        const { token } = await createUserAndLogin();

        await request(app)
          .get('/api/v1/admin/groups')
          .set(authHeader(token))
          .expect(403);
      });
    });

    describe('POST /api/v1/admin/groups', () => {
      it('should create a new group', async () => {
        const { token } = await createAdminAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'New Group',
            description: 'A test group',
            purpose: 'testing',
          })
          .expect(201);

        expect(response.body.name).toBe('New Group');
        expect(response.body.description).toBe('A test group');
        expect(response.body.purpose).toBe('testing');

        // Verify in database
        const group = await prisma.group.findUnique({
          where: { id: response.body.id },
        });
        expect(group).toBeTruthy();
      });

      it('should create group with initial members', async () => {
        const { token } = await createAdminAndLogin();
        const { userId: user1Id } = await createUserAndLogin();
        const { userId: user2Id } = await createUserAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'Group with Members',
            memberIds: [user1Id, user2Id],
          })
          .expect(201);

        expect(response.body.members).toHaveLength(2);

        // Verify memberships in database
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: response.body.id },
        });
        expect(memberships).toHaveLength(2);
      });

      it('should skip invalid member IDs', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const response = await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({
            name: 'Group with Mixed Members',
            memberIds: [userId, '00000000-0000-0000-0000-000000000000'],
          })
          .expect(201);

        // Only the valid user should be added
        expect(response.body.members).toHaveLength(1);
      });

      it('should reject group without name', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .post('/api/v1/admin/groups')
          .set(authHeader(token))
          .send({ description: 'No name group' })
          .expect(400);
      });
    });

    describe('PUT /api/v1/admin/groups/:groupId', () => {
      it('should update group name and description', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Original Name', description: 'Original Desc' },
        });

        const response = await request(app)
          .put(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .send({
            name: 'Updated Name',
            description: 'Updated Description',
          })
          .expect(200);

        expect(response.body.name).toBe('Updated Name');
        expect(response.body.description).toBe('Updated Description');
      });

      it('should update group members', async () => {
        const { token } = await createAdminAndLogin();
        const { userId: user1Id } = await createUserAndLogin();
        const { userId: user2Id } = await createUserAndLogin();
        const { userId: user3Id } = await createUserAndLogin();

        // Create group with user1 and user2
        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              createMany: {
                data: [
                  { userId: user1Id, role: 'member' },
                  { userId: user2Id, role: 'member' },
                ],
              },
            },
          },
        });

        // Update to user2 and user3 (remove user1, add user3)
        const response = await request(app)
          .put(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .send({ memberIds: [user2Id, user3Id] })
          .expect(200);

        expect(response.body.members).toHaveLength(2);

        // Verify user1 is removed, user3 is added
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: group.id },
        });
        const memberUserIds = memberships.map(m => m.userId);
        expect(memberUserIds).not.toContain(user1Id);
        expect(memberUserIds).toContain(user2Id);
        expect(memberUserIds).toContain(user3Id);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .put('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .send({ name: 'Test' })
          .expect(404);
      });
    });

    describe('DELETE /api/v1/admin/groups/:groupId', () => {
      it('should delete a group', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Group to Delete' },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .expect(200);

        // Verify group is deleted
        const deletedGroup = await prisma.group.findUnique({
          where: { id: group.id },
        });
        expect(deletedGroup).toBeNull();
      });

      it('should cascade delete group memberships', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Group with Members',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}`)
          .set(authHeader(token))
          .expect(200);

        // Verify memberships are also deleted
        const memberships = await prisma.groupMember.findMany({
          where: { groupId: group.id },
        });
        expect(memberships).toHaveLength(0);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();

        await request(app)
          .delete('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000')
          .set(authHeader(token))
          .expect(404);
      });
    });

    describe('POST /api/v1/admin/groups/:groupId/members', () => {
      it('should add a member to a group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId, username } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        const response = await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId, role: 'member' })
          .expect(201);

        expect(response.body.userId).toBe(userId);
        expect(response.body.username).toBe(username);
        expect(response.body.role).toBe('member');

        // Verify in database
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
        });
        expect(membership).toBeTruthy();
      });

      it('should add member as admin role', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        const response = await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId, role: 'admin' })
          .expect(201);

        expect(response.body.role).toBe('admin');
      });

      it('should reject duplicate membership', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId })
          .expect(409);
      });

      it('should return 404 for non-existent group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        await request(app)
          .post('/api/v1/admin/groups/00000000-0000-0000-0000-000000000000/members')
          .set(authHeader(token))
          .send({ userId })
          .expect(404);
      });

      it('should return 404 for non-existent user', async () => {
        const { token } = await createAdminAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        await request(app)
          .post(`/api/v1/admin/groups/${group.id}/members`)
          .set(authHeader(token))
          .send({ userId: '00000000-0000-0000-0000-000000000000' })
          .expect(404);
      });
    });

    describe('DELETE /api/v1/admin/groups/:groupId/members/:userId', () => {
      it('should remove a member from a group', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: {
            name: 'Test Group',
            members: {
              create: { userId, role: 'member' },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
          .set(authHeader(token))
          .expect(200);

        // Verify membership is removed
        const membership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
        });
        expect(membership).toBeNull();
      });

      it('should return 404 for non-existent membership', async () => {
        const { token } = await createAdminAndLogin();
        const { userId } = await createUserAndLogin();

        const group = await prisma.group.create({
          data: { name: 'Test Group' },
        });

        await request(app)
          .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
          .set(authHeader(token))
          .expect(404);
      });
    });
  });

  // =============================================
  // AUDIT LOGGING
  // =============================================

  describe('Audit Logging', () => {
    it('should create audit log for user creation', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const newUsername = uniqueUsername('audituser');

      await request(app)
        .post('/api/v1/admin/users')
        .set(authHeader(token))
        .send({
          username: newUsername,
          password: 'Password123!',
        })
        .expect(201);

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.create',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeTruthy();
      expect(auditLog?.category).toBe('user');
    });

    it('should create audit log for user deletion', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId, username } = await createUserAndLogin();

      await request(app)
        .delete(`/api/v1/admin/users/${userId}`)
        .set(authHeader(token))
        .expect(200);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.delete',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeTruthy();
    });

    it('should create audit log for admin role grant', async () => {
      const { token, adminId } = await createAdminAndLogin();
      const { userId } = await createUserAndLogin();

      await request(app)
        .put(`/api/v1/admin/users/${userId}`)
        .set(authHeader(token))
        .send({ isAdmin: true })
        .expect(200);

      // Verify audit log for admin grant
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'user.admin_grant',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeTruthy();
    });

    it('should create audit log for admin role revoke', async () => {
      const { token: superToken, adminId: superId } = await createAdminAndLogin();
      const { adminId: targetId } = await createAdminAndLogin();

      await request(app)
        .put(`/api/v1/admin/users/${targetId}`)
        .set(authHeader(superToken))
        .send({ isAdmin: false })
        .expect(200);

      // Verify audit log for admin revoke
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: superId,
          action: 'user.admin_revoke',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeTruthy();
    });

    it('should create audit log for group creation', async () => {
      const { token, adminId } = await createAdminAndLogin();

      await request(app)
        .post('/api/v1/admin/groups')
        .set(authHeader(token))
        .send({ name: 'Audit Test Group' })
        .expect(201);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          userId: adminId,
          action: 'admin.group_create',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(auditLog).toBeTruthy();
      expect(auditLog?.category).toBe('admin');
    });
  });

  // =============================================
  // ACCESS CONTROL INTEGRATION
  // =============================================

  describe('Access Control Integration', () => {
    it('should grant group member access to group wallet', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create a group and wallet
      const group = await prisma.group.create({
        data: { name: 'Shared Group' },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Group Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User should NOT have access initially
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(403);

      // Add user to group via admin API
      await request(app)
        .post(`/api/v1/admin/groups/${group.id}/members`)
        .set(authHeader(adminToken))
        .send({ userId, role: 'member' })
        .expect(201);

      // User should now have access to group wallet
      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      expect(response.body.name).toBe('Group Wallet');
    });

    it('should revoke access when removed from group', async () => {
      const { token: adminToken } = await createAdminAndLogin();
      const { userId, token: userToken } = await createUserAndLogin();

      // Create group with user as member
      const group = await prisma.group.create({
        data: {
          name: 'Shared Group',
          members: {
            create: { userId, role: 'member' },
          },
        },
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Group Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          groupId: group.id,
        },
      });

      // User should have access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(200);

      // Remove user from group
      await request(app)
        .delete(`/api/v1/admin/groups/${group.id}/members/${userId}`)
        .set(authHeader(adminToken))
        .expect(200);

      // User should no longer have access
      await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(userToken))
        .expect(403);
    });
  });
});
