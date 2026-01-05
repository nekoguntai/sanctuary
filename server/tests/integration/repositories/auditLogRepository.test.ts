/**
 * Audit Log Repository Integration Tests
 *
 * Tests the audit log repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestAuditLog,
} from './setup';

describeIfDatabase('AuditLogRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create an audit log entry with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, { username: 'audited-user' });

        const log = await createTestAuditLog(tx, user.id, 'audited-user', {
          action: 'auth.login',
          category: 'auth',
          details: { method: '2fa' },
          success: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        });

        expect(log.userId).toBe(user.id);
        expect(log.username).toBe('audited-user');
        expect(log.action).toBe('auth.login');
        expect(log.category).toBe('auth');
        expect(log.success).toBe(true);
        expect(log.ipAddress).toBe('192.168.1.1');
      });
    });

    it('should create audit log without user ID (for failed auth)', async () => {
      await withTestTransaction(async (tx) => {
        const log = await createTestAuditLog(tx, null, 'unknown-user', {
          action: 'auth.login',
          category: 'auth',
          success: false,
          errorMsg: 'Invalid credentials',
        });

        expect(log.userId).toBeNull();
        expect(log.username).toBe('unknown-user');
        expect(log.success).toBe(false);
        expect(log.errorMsg).toBe('Invalid credentials');
      });
    });
  });

  describe('findMany', () => {
    it('should find audit logs with pagination', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        for (let i = 0; i < 10; i++) {
          await createTestAuditLog(tx, user.id, user.username, {
            action: `action-${i}`,
          });
        }

        const page1 = await tx.auditLog.findMany({
          take: 5,
          skip: 0,
          orderBy: { createdAt: 'desc' },
        });

        const page2 = await tx.auditLog.findMany({
          take: 5,
          skip: 5,
          orderBy: { createdAt: 'desc' },
        });

        expect(page1).toHaveLength(5);
        expect(page2).toHaveLength(5);
      });
    });

    it('should filter by user ID', async () => {
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'user1' });
        const user2 = await createTestUser(tx, { username: 'user2' });

        await createTestAuditLog(tx, user1.id, 'user1');
        await createTestAuditLog(tx, user1.id, 'user1');
        await createTestAuditLog(tx, user2.id, 'user2');

        const user1Logs = await tx.auditLog.findMany({
          where: { userId: user1.id },
        });

        expect(user1Logs).toHaveLength(2);
      });
    });

    it('should filter by category', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { category: 'auth' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'auth' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'wallet' });

        const authLogs = await tx.auditLog.findMany({
          where: { category: 'auth' },
        });

        expect(authLogs).toHaveLength(2);
      });
    });

    it('should filter by success status', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { success: true });
        await createTestAuditLog(tx, user.id, user.username, { success: true });
        await createTestAuditLog(tx, user.id, user.username, { success: false });

        const failedLogs = await tx.auditLog.findMany({
          where: { success: false },
        });

        expect(failedLogs).toHaveLength(1);
      });
    });

    it('should filter by date range', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const now = new Date();

        // Create log with backdated timestamp
        await tx.auditLog.create({
          data: {
            userId: user.id,
            username: user.username,
            action: 'old.action',
            category: 'system',
            success: true,
            createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
          },
        });

        // Create recent log
        await createTestAuditLog(tx, user.id, user.username, {
          action: 'recent.action',
        });

        const recentLogs = await tx.auditLog.findMany({
          where: {
            createdAt: {
              gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
        });

        expect(recentLogs).toHaveLength(1);
        expect(recentLogs[0].action).toBe('recent.action');
      });
    });
  });

  describe('findByUserId', () => {
    it('should find all logs for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { action: 'action1' });
        await createTestAuditLog(tx, user.id, user.username, { action: 'action2' });
        await createTestAuditLog(tx, user.id, user.username, { action: 'action3' });

        const logs = await tx.auditLog.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        });

        expect(logs).toHaveLength(3);
      });
    });
  });

  describe('findByCategory', () => {
    it('should find logs by category', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { category: 'admin' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'admin' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'system' });

        const adminLogs = await tx.auditLog.findMany({
          where: { category: 'admin' },
        });

        expect(adminLogs).toHaveLength(2);
      });
    });
  });

  describe('findFailedActions', () => {
    it('should find failed actions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, {
          success: false,
          errorMsg: 'Error 1',
        });
        await createTestAuditLog(tx, user.id, user.username, {
          success: false,
          errorMsg: 'Error 2',
        });
        await createTestAuditLog(tx, user.id, user.username, { success: true });

        const failed = await tx.auditLog.findMany({
          where: { success: false },
          orderBy: { createdAt: 'desc' },
        });

        expect(failed).toHaveLength(2);
        expect(failed.every((l) => !l.success)).toBe(true);
      });
    });
  });

  describe('findRecent', () => {
    it('should find most recent logs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        for (let i = 0; i < 20; i++) {
          await createTestAuditLog(tx, user.id, user.username, {
            action: `action-${i}`,
          });
        }

        const recent = await tx.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        expect(recent).toHaveLength(10);
      });
    });
  });

  describe('countByAction', () => {
    it('should count logs grouped by action', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { action: 'auth.login' });
        await createTestAuditLog(tx, user.id, user.username, { action: 'auth.login' });
        await createTestAuditLog(tx, user.id, user.username, { action: 'auth.logout' });

        const counts = await tx.auditLog.groupBy({
          by: ['action'],
          _count: { action: true },
        });

        const loginCount = counts.find((c) => c.action === 'auth.login');
        expect(loginCount?._count.action).toBe(2);
      });
    });
  });

  describe('countByCategory', () => {
    it('should count logs grouped by category', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestAuditLog(tx, user.id, user.username, { category: 'auth' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'auth' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'wallet' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'wallet' });
        await createTestAuditLog(tx, user.id, user.username, { category: 'wallet' });

        const counts = await tx.auditLog.groupBy({
          by: ['category'],
          _count: { category: true },
        });

        const authCount = counts.find((c) => c.category === 'auth');
        const walletCount = counts.find((c) => c.category === 'wallet');

        expect(authCount?._count.category).toBe(2);
        expect(walletCount?._count.category).toBe(3);
      });
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete logs older than specified date', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const now = new Date();

        // Create old logs
        for (let i = 0; i < 3; i++) {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              username: user.username,
              action: 'old.action',
              category: 'system',
              success: true,
              createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            },
          });
        }

        // Create recent logs
        await createTestAuditLog(tx, user.id, user.username, {
          action: 'recent.action',
        });

        const cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

        const result = await tx.auditLog.deleteMany({
          where: {
            createdAt: { lt: cutoffDate },
          },
        });

        expect(result.count).toBe(3);

        const remaining = await tx.auditLog.count();
        expect(remaining).toBe(1);
      });
    });
  });

  describe('security monitoring patterns', () => {
    it('should track failed login attempts', async () => {
      await withTestTransaction(async (tx) => {
        // Multiple failed logins from same IP
        for (let i = 0; i < 5; i++) {
          await tx.auditLog.create({
            data: {
              userId: null,
              username: 'target-user',
              action: 'auth.login',
              category: 'auth',
              success: false,
              errorMsg: 'Invalid password',
              ipAddress: '10.0.0.1',
            },
          });
        }

        const failedFromIP = await tx.auditLog.count({
          where: {
            action: 'auth.login',
            success: false,
            ipAddress: '10.0.0.1',
          },
        });

        expect(failedFromIP).toBe(5);
      });
    });

    it('should track admin actions', async () => {
      await withTestTransaction(async (tx) => {
        const admin = await createTestUser(tx, { username: 'admin', isAdmin: true });

        await createTestAuditLog(tx, admin.id, admin.username, {
          action: 'admin.user_delete',
          category: 'admin',
          details: { targetUser: 'deleted-user' },
        });
        await createTestAuditLog(tx, admin.id, admin.username, {
          action: 'admin.config_change',
          category: 'admin',
          details: { setting: 'registration', value: false },
        });

        const adminActions = await tx.auditLog.findMany({
          where: { category: 'admin' },
        });

        expect(adminActions).toHaveLength(2);
      });
    });
  });
});
