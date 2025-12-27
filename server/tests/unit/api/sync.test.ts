/**
 * Sync API Tests
 *
 * Tests for network-based wallet synchronization endpoints.
 */

import express from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock sync service
const mockSyncService = {
  queueSync: jest.fn(),
  getSyncStatus: jest.fn(),
};

jest.mock('../../../src/services/syncService', () => ({
  getSyncService: () => mockSyncService,
}));

// Mock authentication middleware
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { userId: 'test-user-id', isAdmin: false };
    next();
  },
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

// Import after mocks
import syncRouter from '../../../src/api/sync';

describe('Sync API - Network Endpoints', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/sync', syncRouter);
  });

  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('POST /sync/network/:network', () => {
    it('should queue all mainnet wallets for sync', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
      ]);

      const response = await request(app)
        .post('/sync/network/mainnet')
        .send({ priority: 'normal' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 2,
        walletIds: ['wallet-1', 'wallet-2'],
      });
      expect(mockSyncService.queueSync).toHaveBeenCalledTimes(2);
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'normal');
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-2', 'normal');
    });

    it('should queue testnet wallets for sync', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'testnet-wallet-1' },
      ]);

      const response = await request(app)
        .post('/sync/network/testnet')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('testnet-wallet-1', 'high');
    });

    it('should queue signet wallets for sync', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'signet-wallet-1' },
      ]);

      const response = await request(app)
        .post('/sync/network/signet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
    });

    it('should return empty result when no wallets found', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const response = await request(app)
        .post('/sync/network/testnet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 0,
        walletIds: [],
        message: 'No testnet wallets found',
      });
      expect(mockSyncService.queueSync).not.toHaveBeenCalled();
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .post('/sync/network/regtest')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });

    it('should default to normal priority', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1' },
      ]);

      await request(app)
        .post('/sync/network/mainnet')
        .send({});

      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'normal');
    });
  });

  describe('POST /sync/network/:network/resync', () => {
    it('should resync all wallets for a network with confirmation header', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockPrismaClient.transaction.deleteMany.mockResolvedValue({ count: 50 });
      mockPrismaClient.address.updateMany.mockResolvedValue({ count: 10 });
      mockPrismaClient.wallet.update.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 2,
        walletIds: ['wallet-1', 'wallet-2'],
        deletedTransactions: 100, // 50 per wallet
        clearedStuckFlags: 0,
      });
    });

    it('should require confirmation header', async () => {
      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('X-Confirm-Resync');
    });

    it('should clear stuck sync flags and resync all wallets', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: true },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockPrismaClient.transaction.deleteMany.mockResolvedValue({ count: 30 });
      mockPrismaClient.address.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaClient.wallet.update.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/network/testnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      // Full resync processes ALL wallets, including stuck ones
      expect(response.body.queued).toBe(2);
      expect(response.body.clearedStuckFlags).toBe(1);
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .post('/sync/network/invalid/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });

    it('should delete transactions and reset wallet state', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockPrismaClient.transaction.deleteMany.mockResolvedValue({ count: 75 });
      mockPrismaClient.address.updateMany.mockResolvedValue({ count: 20 });
      mockPrismaClient.wallet.update.mockResolvedValue({});

      await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      // Verify transactions deleted
      expect(mockPrismaClient.transaction.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });

      // Verify address flags reset
      expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        data: { used: false },
      });

      // Verify wallet state reset
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          syncInProgress: false,
          lastSyncedAt: null,
          lastSyncStatus: null,
        },
      });

      // Verify queued for high priority sync
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'high');
    });
  });

  describe('GET /sync/network/:network/status', () => {
    it('should return aggregate sync status for network', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false, lastSyncStatus: 'success', lastSyncedAt: new Date('2024-01-01') },
        { id: 'wallet-2', syncInProgress: true, lastSyncStatus: null, lastSyncedAt: null },
        { id: 'wallet-3', syncInProgress: false, lastSyncStatus: 'failed', lastSyncedAt: new Date('2024-01-02') },
      ]);

      const response = await request(app)
        .get('/sync/network/mainnet/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        network: 'mainnet',
        total: 3,
        syncing: 1,
        synced: 1,
        failed: 1,
        pending: 0,
        lastSyncAt: expect.any(String),
      });
    });

    it('should return empty status when no wallets', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/sync/network/testnet/status');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .get('/sync/network/bitcoin/status');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });
  });
});
