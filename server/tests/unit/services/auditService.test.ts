/**
 * Audit Service Tests
 *
 * Tests for security audit logging, event tracking, and query capabilities.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { createMockRequest } from '../../helpers/testUtils';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  auditService,
  AuditCategory,
  AuditAction,
  getClientInfo,
} from '../../../src/services/auditService';

describe('Audit Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({
        id: 'audit-1',
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        success: true,
        createdAt: new Date(),
      });

      await auditService.log({
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
      });

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          username: 'testuser',
          action: AuditAction.LOGIN,
          category: AuditCategory.AUTH,
          success: true,
        }),
      });
    });

    it('should log failed events with error message', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({
        id: 'audit-2',
        success: false,
      });

      await auditService.log({
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN_FAILED,
        category: AuditCategory.AUTH,
        success: false,
        errorMsg: 'Invalid password',
      });

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: false,
          errorMsg: 'Invalid password',
        }),
      });
    });

    it('should include IP address and user agent', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({ id: 'audit-3' });

      await auditService.log({
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      });

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
        }),
      });
    });

    it('should include details as JSON', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({ id: 'audit-4' });

      await auditService.log({
        username: 'admin',
        action: AuditAction.USER_CREATE,
        category: AuditCategory.USER,
        details: {
          newUserId: 'new-user-1',
          newUsername: 'newuser',
        },
      });

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: {
            newUserId: 'new-user-1',
            newUsername: 'newuser',
          },
        }),
      });
    });

    it('should not throw when database write fails', async () => {
      mockPrismaClient.auditLog.create.mockRejectedValue(new Error('DB error'));

      // Should not throw - audit failures should not break the application
      await expect(
        auditService.log({
          username: 'testuser',
          action: AuditAction.LOGIN,
          category: AuditCategory.AUTH,
        })
      ).resolves.not.toThrow();
    });

    it('should default success to true', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({ id: 'audit-5' });

      await auditService.log({
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
      });

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: true,
        }),
      });
    });
  });

  describe('logFromRequest', () => {
    it('should extract user info from request', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({ id: 'audit-6' });

      // Create a more complete mock request with socket
      const req = {
        ...createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: false,
          },
          headers: {
            'user-agent': 'Test Agent',
          },
          ip: '10.0.0.1',
        }),
        socket: { remoteAddress: '10.0.0.1' },
      };

      await auditService.logFromRequest(
        req as any,
        AuditAction.WALLET_CREATE,
        AuditCategory.WALLET,
        { details: { walletId: 'wallet-1' } }
      );

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          username: 'testuser',
          action: AuditAction.WALLET_CREATE,
          category: AuditCategory.WALLET,
        }),
      });
    });

    it('should use anonymous for unauthenticated requests', async () => {
      mockPrismaClient.auditLog.create.mockResolvedValue({ id: 'audit-7' });

      // Create a more complete mock request with socket
      const req = {
        ...createMockRequest({}),
        socket: { remoteAddress: '127.0.0.1' },
      };

      await auditService.logFromRequest(
        req as any,
        AuditAction.LOGIN_FAILED,
        AuditCategory.AUTH
      );

      expect(mockPrismaClient.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'anonymous',
        }),
      });
    });
  });

  describe('query', () => {
    it('should return paginated results', async () => {
      const mockLogs = [
        { id: 'log-1', action: AuditAction.LOGIN },
        { id: 'log-2', action: AuditAction.LOGIN },
      ];

      mockPrismaClient.auditLog.findMany.mockResolvedValue(mockLogs);
      mockPrismaClient.auditLog.count.mockResolvedValue(100);

      const result = await auditService.query({ limit: 2, offset: 0 });

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(100);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(0);
    });

    it('should filter by userId', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);
      mockPrismaClient.auditLog.count.mockResolvedValue(0);

      await auditService.query({ userId: 'user-123' });

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-123' }),
        })
      );
    });

    it('should filter by category', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);
      mockPrismaClient.auditLog.count.mockResolvedValue(0);

      await auditService.query({ category: AuditCategory.AUTH });

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: AuditCategory.AUTH }),
        })
      );
    });

    it('should filter by date range', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);
      mockPrismaClient.auditLog.count.mockResolvedValue(0);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await auditService.query({ startDate, endDate });

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: startDate, lte: endDate },
          }),
        })
      );
    });

    it('should filter by success status', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);
      mockPrismaClient.auditLog.count.mockResolvedValue(0);

      await auditService.query({ success: false });

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ success: false }),
        })
      );
    });

    it('should use default limit of 50', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);
      mockPrismaClient.auditLog.count.mockResolvedValue(0);

      const result = await auditService.query({});

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
        })
      );
      expect(result.limit).toBe(50);
    });
  });

  describe('getForUser', () => {
    it('should return recent logs for a user', async () => {
      const mockLogs = [
        { id: 'log-1', userId: 'user-123' },
        { id: 'log-2', userId: 'user-123' },
      ];

      mockPrismaClient.auditLog.findMany.mockResolvedValue(mockLogs);

      const result = await auditService.getForUser('user-123');

      expect(result).toHaveLength(2);
      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    });

    it('should respect custom limit', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);

      await auditService.getForUser('user-123', 5);

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });
  });

  describe('getFailedLogins', () => {
    it('should return failed login attempts since date', async () => {
      const since = new Date('2024-01-01');
      const mockLogs = [
        { id: 'fail-1', action: AuditAction.LOGIN_FAILED },
      ];

      mockPrismaClient.auditLog.findMany.mockResolvedValue(mockLogs);

      const result = await auditService.getFailedLogins(since);

      expect(result).toHaveLength(1);
      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          action: AuditAction.LOGIN_FAILED,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  });

  describe('getAdminActions', () => {
    it('should return admin, backup, and system actions', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);

      await auditService.getAdminActions();

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          category: {
            in: [AuditCategory.ADMIN, AuditCategory.BACKUP, AuditCategory.SYSTEM],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should support pagination', async () => {
      mockPrismaClient.auditLog.findMany.mockResolvedValue([]);

      await auditService.getAdminActions(10, 20);

      expect(mockPrismaClient.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });
  });

  describe('cleanup', () => {
    it('should delete logs older than specified date', async () => {
      const olderThan = new Date('2023-01-01');
      mockPrismaClient.auditLog.deleteMany.mockResolvedValue({ count: 500 });

      const deleted = await auditService.cleanup(olderThan);

      expect(deleted).toBe(500);
      expect(mockPrismaClient.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: olderThan },
        },
      });
    });
  });

  describe('getStats', () => {
    it('should return statistics for the specified period', async () => {
      mockPrismaClient.auditLog.count.mockResolvedValue(1000);
      mockPrismaClient.auditLog.groupBy.mockResolvedValue([
        { category: 'auth', _count: 500 },
        { category: 'wallet', _count: 300 },
      ]);

      const stats = await auditService.getStats(30);

      expect(stats.totalEvents).toBe(1000);
      expect(stats.byCategory).toEqual({
        auth: 500,
        wallet: 300,
      });
    });

    it('should count failed events', async () => {
      mockPrismaClient.auditLog.count
        .mockResolvedValueOnce(1000) // totalEvents
        .mockResolvedValueOnce(50);  // failedEvents
      mockPrismaClient.auditLog.groupBy.mockResolvedValue([]);

      const stats = await auditService.getStats();

      expect(stats.failedEvents).toBe(50);
    });

    it('should return top actions', async () => {
      mockPrismaClient.auditLog.count.mockResolvedValue(100);
      mockPrismaClient.auditLog.groupBy
        .mockResolvedValueOnce([]) // category stats
        .mockResolvedValueOnce([
          { action: 'auth.login', _count: 50 },
          { action: 'wallet.create', _count: 20 },
        ]);

      const stats = await auditService.getStats();

      expect(stats.byAction).toEqual({
        'auth.login': 50,
        'wallet.create': 20,
      });
    });
  });
});

describe('getClientInfo', () => {
  it('should extract IP from socket remoteAddress', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('192.168.1.1');
  });

  it('should extract IP from x-forwarded-for header (single IP)', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '192.168.1.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should extract first IP from x-forwarded-for header (multiple IPs)', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1, 172.16.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should handle array x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': ['10.0.0.1', '192.168.1.1'] },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should extract user agent', () => {
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0)');
  });

  it('should default to unknown for missing user agent', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.userAgent).toBe('unknown');
  });

  it('should default to unknown for missing IP', () => {
    const req = {
      headers: {},
      socket: {},
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('unknown');
  });
});

describe('Audit Actions and Categories', () => {
  describe('AuditCategory enum', () => {
    it('should have expected categories', () => {
      expect(AuditCategory.AUTH).toBe('auth');
      expect(AuditCategory.USER).toBe('user');
      expect(AuditCategory.WALLET).toBe('wallet');
      expect(AuditCategory.DEVICE).toBe('device');
      expect(AuditCategory.ADMIN).toBe('admin');
      expect(AuditCategory.BACKUP).toBe('backup');
      expect(AuditCategory.SYSTEM).toBe('system');
    });
  });

  describe('AuditAction enum', () => {
    it('should have auth-related actions', () => {
      expect(AuditAction.LOGIN).toBe('auth.login');
      expect(AuditAction.LOGIN_FAILED).toBe('auth.login_failed');
      expect(AuditAction.LOGOUT).toBe('auth.logout');
      expect(AuditAction.PASSWORD_CHANGE).toBe('auth.password_change');
    });

    it('should have 2FA-related actions', () => {
      expect(AuditAction.TWO_FACTOR_SETUP).toBe('auth.2fa_setup');
      expect(AuditAction.TWO_FACTOR_ENABLED).toBe('auth.2fa_enabled');
      expect(AuditAction.TWO_FACTOR_DISABLED).toBe('auth.2fa_disabled');
      expect(AuditAction.TWO_FACTOR_FAILED).toBe('auth.2fa_failed');
      expect(AuditAction.TWO_FACTOR_BACKUP_CODE_USED).toBe('auth.2fa_backup_code_used');
    });

    it('should have wallet-related actions', () => {
      expect(AuditAction.WALLET_CREATE).toBe('wallet.create');
      expect(AuditAction.WALLET_DELETE).toBe('wallet.delete');
      expect(AuditAction.WALLET_SHARE).toBe('wallet.share');
      expect(AuditAction.WALLET_EXPORT).toBe('wallet.export');
    });

    it('should have transaction-related actions', () => {
      expect(AuditAction.TRANSACTION_CREATE).toBe('wallet.transaction_create');
      expect(AuditAction.TRANSACTION_SIGN).toBe('wallet.transaction_sign');
      expect(AuditAction.TRANSACTION_BROADCAST).toBe('wallet.transaction_broadcast');
    });

    it('should have admin-related actions', () => {
      expect(AuditAction.NODE_CONFIG_UPDATE).toBe('admin.node_config_update');
      expect(AuditAction.GROUP_CREATE).toBe('admin.group_create');
      expect(AuditAction.SYSTEM_SETTING_UPDATE).toBe('admin.system_setting_update');
    });

    it('should have backup-related actions', () => {
      expect(AuditAction.BACKUP_CREATE).toBe('backup.create');
      expect(AuditAction.BACKUP_VALIDATE).toBe('backup.validate');
      expect(AuditAction.BACKUP_RESTORE).toBe('backup.restore');
    });
  });
});
