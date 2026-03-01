/**
 * AI Internal API Tests
 *
 * Tests for internal AI endpoints with IP restriction and data sanitization.
 * These endpoints are security-critical and only accessible from Docker internal networks.
 *
 * Coverage target: 90%+
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock dependencies BEFORE importing the router
// All mocks must be defined inside vi.mock to avoid hoisting issues

// Mock Prisma
vi.mock('../../../src/models/prisma', () => {
  const mockTransaction = {
    findFirst: vi.fn(),
    count: vi.fn(),
  };
  const mockWallet = {
    findFirst: vi.fn(),
  };
  const mockLabel = {
    findMany: vi.fn(),
  };
  const mockAddress = {
    count: vi.fn(),
  };
  const mockUTXO = {
    count: vi.fn(),
  };

  return {
    __esModule: true,
    default: {
      transaction: mockTransaction,
      wallet: mockWallet,
      label: mockLabel,
      address: mockAddress,
      uTXO: mockUTXO,
    },
  };
});

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock notification service
vi.mock('../../../src/websocket/notifications', () => ({
  notificationService: {
    broadcastModelDownloadProgress: vi.fn(),
  },
}));

// Mock authenticate middleware - pass through with user when Authorization header present
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.user = { userId: 'test-user-123', username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

// Import the router and mocked modules AFTER all mocks are set up
import aiInternalRouter from '../../../src/api/ai-internal';
import prisma from '../../../src/models/prisma';
import { notificationService } from '../../../src/websocket/notifications';

// Get typed references to mocked functions
const mockPrisma = prisma as unknown as {
  transaction: { findFirst: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  wallet: { findFirst: ReturnType<typeof vi.fn> };
  label: { findMany: ReturnType<typeof vi.fn> };
  address: { count: ReturnType<typeof vi.fn> };
  uTXO: { count: ReturnType<typeof vi.fn> };
};
const mockNotificationService = notificationService as unknown as {
  broadcastModelDownloadProgress: ReturnType<typeof vi.fn>;
};

describe('AI Internal API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Add trust proxy to properly handle X-Forwarded-For
    app.set('trust proxy', true);

    app.use('/internal/ai', aiInternalRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IP Restriction Middleware', () => {
    describe('Allowed Private IP Ranges', () => {
      describe('10.x.x.x (Class A Private)', () => {
        it.each([
          '10.0.0.1',
          '10.0.0.255',
          '10.1.2.3',
          '10.255.255.255',
          '10.100.50.25',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await request(app)
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('172.16-31.x.x (Class B Private)', () => {
        it.each([
          '172.16.0.1',
          '172.20.5.10',
          '172.31.255.255',
          '172.24.128.64',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await request(app)
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('192.168.x.x (Class C Private)', () => {
        it.each([
          '192.168.0.1',
          '192.168.1.1',
          '192.168.100.200',
          '192.168.255.255',
        ])('should allow IP %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await request(app)
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('Localhost', () => {
        it.each([
          '127.0.0.1',
          '::1',
          'localhost',
        ])('should allow %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await request(app)
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });

      describe('IPv6-mapped IPv4', () => {
        it.each([
          '::ffff:10.0.0.1',
          '::ffff:192.168.1.1',
          '::ffff:172.16.0.1',
          '::ffff:127.0.0.1',
        ])('should allow %s', async (ip) => {
          mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

          const res = await request(app)
            .post('/internal/ai/pull-progress')
            .set('X-Forwarded-For', ip)
            .send({ model: 'llama2', status: 'downloading' });

          expect(res.status).not.toBe(403);
        });
      });
    });

    describe('Blocked Public IP Ranges', () => {
      it.each([
        '8.8.8.8',          // Google DNS
        '1.1.1.1',          // Cloudflare DNS
        '203.0.113.1',      // TEST-NET-3
        '104.16.0.1',       // Cloudflare
        '52.94.236.248',    // AWS
        '172.15.255.255',   // Just below private range
        '172.32.0.1',       // Just above private range
        '192.167.1.1',      // Close to but not private
        '192.169.1.1',      // Close to but not private
        '11.0.0.1',         // Close to 10.x range
        '9.255.255.255',    // Just below 10.x range
      ])('should block public IP %s', async (ip) => {
        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', ip)
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Access denied: internal endpoint');
      });
    });

    describe('Invalid IP Handling', () => {
      it.each([
        'invalid',
        '256.0.0.1',
        '10.0.0.256',
        '-1.0.0.1',
        '10.0.0',
        '10.0.0.1.1',
        'not-an-ip',
      ])('should block invalid IP format: %s', async (ip) => {
        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', ip)
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });
    });

    describe('X-Forwarded-For Header Handling', () => {
      it('should use first IP from X-Forwarded-For header', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '192.168.1.1, 8.8.8.8')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should block when first IP in X-Forwarded-For is public', async () => {
        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '8.8.8.8, 192.168.1.1')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });

      it('should trim whitespace from X-Forwarded-For', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .set('X-Forwarded-For', '  192.168.1.1  , 8.8.8.8')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should use socket remoteAddress when X-Forwarded-For is missing', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const res = await request(app)
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should use first IP when X-Forwarded-For is an array', async () => {
        mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

        const appWithArrayHeader = express();
        appWithArrayHeader.use(express.json());
        appWithArrayHeader.use((req, _res, next) => {
          (req.headers as Record<string, unknown>)['x-forwarded-for'] = ['192.168.1.1', '8.8.8.8'];
          next();
        });
        appWithArrayHeader.use('/internal/ai', aiInternalRouter);

        const res = await request(appWithArrayHeader)
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).not.toBe(403);
      });

      it('should reject when socket remoteAddress is empty and no forwarded header exists', async () => {
        const appWithEmptyRemoteAddress = express();
        appWithEmptyRemoteAddress.use(express.json());
        appWithEmptyRemoteAddress.use((req, _res, next) => {
          (req.headers as Record<string, unknown>)['x-forwarded-for'] = undefined;
          Object.defineProperty(req, 'socket', {
            value: { remoteAddress: '' },
            configurable: true,
          });
          next();
        });
        appWithEmptyRemoteAddress.use('/internal/ai', aiInternalRouter);

        const res = await request(appWithEmptyRemoteAddress)
          .post('/internal/ai/pull-progress')
          .send({ model: 'llama2', status: 'downloading' });

        expect(res.status).toBe(403);
      });
    });
  });

  describe('POST /internal/ai/pull-progress', () => {
    const internalIp = '10.0.0.1';

    it('should broadcast progress updates', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2:7b',
          status: 'downloading',
          completed: 500,
          total: 1000,
          digest: 'sha256:abc123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith({
        model: 'llama2:7b',
        status: 'downloading',
        completed: 500,
        total: 1000,
        percent: 50,
        digest: 'sha256:abc123',
        error: undefined,
      });
    });

    it('should return 400 when model is missing', async () => {
      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({ status: 'downloading' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model and status required');
    });

    it('should return 400 when status is missing', async () => {
      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({ model: 'llama2' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model and status required');
    });

    it('should handle zero total (calculate percent as 0)', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'preparing',
          completed: 0,
          total: 0,
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 0 })
      );
    });

    it('should handle missing completed/total fields', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'complete',
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 0,
          total: 0,
          percent: 0,
        })
      );
    });

    it('should broadcast error status', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'error',
          error: 'Download failed',
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: 'Download failed',
        })
      );
    });

    it('should return 500 on internal error', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockImplementation(() => {
        throw new Error('Broadcast failed');
      });

      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'downloading',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal error');
    });

    it('should NOT require authentication (no JWT)', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      // No Authorization header, should still work
      const res = await request(app)
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'downloading',
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /internal/ai/tx/:id', () => {
    const internalIp = '10.0.0.1';
    const authHeader = 'Bearer valid-token';

    it('should return sanitized transaction data', async () => {
      const mockTx = {
        id: 'tx-123',
        amount: BigInt(-50000),
        type: 'send',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 6,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        walletId: 'wallet-123',
        amount: 50000, // Absolute value
        direction: 'send',
        date: '2024-01-15T10:30:00.000Z',
        confirmations: 6,
      });
      // Verify sensitive fields are NOT included
      expect(res.body).not.toHaveProperty('txid');
      expect(res.body).not.toHaveProperty('address');
    });

    it('should return direction as receive for positive amount', async () => {
      const mockTx = {
        id: 'tx-receive',
        amount: BigInt(100000),
        type: 'receive',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 3,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-receive')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.direction).toBe('receive');
      expect(res.body.amount).toBe(100000);
    });

    it('should use createdAt when blockTime is null', async () => {
      const createdAt = new Date('2024-01-15T10:00:00Z');
      const mockTx = {
        id: 'tx-unconfirmed',
        amount: BigInt(10000),
        type: 'receive',
        blockTime: null,
        createdAt,
        confirmations: 0,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-unconfirmed')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should return 404 for non-existent transaction', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/internal/ai/tx/non-existent')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Transaction not found');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should include userId in query for access check', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      await request(app)
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'tx-123',
            wallet: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ users: expect.any(Object) }),
                expect.objectContaining({ group: expect.any(Object) }),
              ]),
            }),
          }),
        })
      );
    });

    it('should return 500 on database error', async () => {
      mockPrisma.transaction.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal error');
    });
  });

  describe('GET /internal/ai/wallet/:id/labels', () => {
    const internalIp = '10.0.0.1';
    const authHeader = 'Bearer valid-token';

    it('should return wallet labels', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123', name: 'Test' });
      mockPrisma.label.findMany.mockResolvedValue([
        { name: 'Exchange' },
        { name: 'Mining' },
        { name: 'Salary' },
      ]);

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: ['Exchange', 'Mining', 'Salary'],
      });
    });

    it('should return empty array when wallet has no labels', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ labels: [] });
    });

    it('should return 404 for non-existent wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/internal/ai/wallet/non-existent/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Wallet not found');
    });

    it('should limit labels to 50', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);

      await request(app)
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.label.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wallet.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal error');
    });
  });

  describe('GET /internal/ai/wallet/:id/context', () => {
    const internalIp = '10.0.0.1';
    const authHeader = 'Bearer valid-token';

    it('should return wallet context with stats', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([
        { name: 'Exchange' },
        { name: 'Mining' },
      ]);
      mockPrisma.transaction.count.mockResolvedValue(150);
      mockPrisma.address.count.mockResolvedValue(25);
      mockPrisma.uTXO.count.mockResolvedValue(10);

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: ['Exchange', 'Mining'],
        stats: {
          transactionCount: 150,
          addressCount: 25,
          utxoCount: 10,
        },
      });
    });

    it('should NOT include balance or addresses', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-123',
        balance: BigInt(5000000), // Should not be exposed
      });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(5);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('balance');
      expect(res.body).not.toHaveProperty('addresses');
      expect(res.body.stats).not.toHaveProperty('balance');
    });

    it('should return 404 for non-existent wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/internal/ai/wallet/non-existent/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Wallet not found');
    });

    it('should limit labels to 20', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      await request(app)
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.label.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.transaction.count.mockRejectedValue(new Error('Count failed'));

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal error');
    });

    it('should handle empty wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'empty-wallet' });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/internal/ai/wallet/empty-wallet/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: [],
        stats: {
          transactionCount: 0,
          addressCount: 0,
          utxoCount: 0,
        },
      });
    });
  });

  describe('Data Policy Compliance', () => {
    const internalIp = '10.0.0.1';
    const authHeader = 'Bearer valid-token';

    it('should verify transaction response follows data policy', async () => {
      const mockTx = {
        id: 'tx-policy',
        txid: 'abc123def456...', // Should NOT be in response
        amount: BigInt(50000),
        type: 'receive',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 6,
        walletId: 'wallet-123',
        address: 'bc1q...sensitive', // Should NOT be in response
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-policy')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      // Allowed fields
      const allowedFields = ['walletId', 'amount', 'direction', 'date', 'confirmations'];
      allowedFields.forEach(field => {
        expect(res.body).toHaveProperty(field);
      });

      // Forbidden fields
      const forbiddenFields = ['address', 'txid', 'privateKey', 'password', 'seed', 'xpriv', 'id'];
      forbiddenFields.forEach(field => {
        expect(res.body).not.toHaveProperty(field);
      });
    });

    it('should verify wallet context follows data policy', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-policy',
        balance: BigInt(5000000), // Should NOT be exposed
        xpub: 'xpub...secret', // Should NOT be exposed
      });
      mockPrisma.label.findMany.mockResolvedValue([{ name: 'Test' }]);
      mockPrisma.transaction.count.mockResolvedValue(100);
      mockPrisma.address.count.mockResolvedValue(20);
      mockPrisma.uTXO.count.mockResolvedValue(5);

      const res = await request(app)
        .get('/internal/ai/wallet/wallet-policy/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      // Allowed fields
      expect(res.body).toHaveProperty('labels');
      expect(res.body).toHaveProperty('stats');
      expect(res.body.stats).toHaveProperty('transactionCount');
      expect(res.body.stats).toHaveProperty('addressCount');
      expect(res.body.stats).toHaveProperty('utxoCount');

      // Forbidden fields
      const forbiddenFields = ['balance', 'addresses', 'txids', 'privateKeys', 'xpub', 'id'];
      forbiddenFields.forEach(field => {
        expect(res.body).not.toHaveProperty(field);
        if (res.body.stats) {
          expect(res.body.stats).not.toHaveProperty(field);
        }
      });
    });
  });

  describe('Edge Cases', () => {
    const internalIp = '10.0.0.1';
    const authHeader = 'Bearer valid-token';

    it('should handle transaction with zero confirmations', async () => {
      const mockTx = {
        id: 'tx-unconfirmed',
        amount: BigInt(10000),
        type: 'receive',
        confirmations: 0,
        blockTime: null,
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-unconfirmed')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.confirmations).toBe(0);
    });

    it('should handle very large transaction amounts', async () => {
      const mockTx = {
        id: 'tx-large',
        amount: BigInt('2100000000000000'), // 21 million BTC in satoshis
        type: 'receive',
        confirmations: 100,
        blockTime: new Date(),
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-large')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(2100000000000000);
    });

    it('should handle zero amount (direction as receive)', async () => {
      const mockTx = {
        id: 'tx-zero',
        amount: BigInt(0),
        type: 'receive',
        confirmations: 1,
        blockTime: new Date(),
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await request(app)
        .get('/internal/ai/tx/tx-zero')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.direction).toBe('receive');
      expect(res.body.amount).toBe(0);
    });
  });
});
