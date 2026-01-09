import { vi } from 'vitest';
/**
 * Sync API Tests
 *
 * Tests for network-based wallet synchronization endpoints.
 */

import express from 'express';
import request from 'supertest';

// Hoist mock variables for use in vi.mock() factories
const {
  mockWalletRepository,
  mockTransactionRepository,
  mockAddressRepository,
  mockSyncService,
} = vi.hoisted(() => ({
  mockWalletRepository: {
    getIdsByNetwork: vi.fn(),
    findByNetworkWithSyncStatus: vi.fn(),
    resetSyncState: vi.fn(),
  },
  mockTransactionRepository: {
    deleteByWalletId: vi.fn(),
  },
  mockAddressRepository: {
    resetUsedFlags: vi.fn(),
  },
  mockSyncService: {
    queueSync: vi.fn(),
    getSyncStatus: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: mockWalletRepository,
  transactionRepository: mockTransactionRepository,
  addressRepository: mockAddressRepository,
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => mockSyncService,
}));

// Mock authentication middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { userId: 'test-user-id', isAdmin: false };
    next();
  },
}));

// Mock rate limit middleware - pass through all requests
vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (req: express.Request, res: express.Response, next: express.NextFunction) => next(),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock wallet log buffer
vi.mock('../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: {
    get: vi.fn(() => []),
  },
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
    vi.clearAllMocks();
  });

  describe('POST /sync/network/:network', () => {
    it('should queue all mainnet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1', 'wallet-2']);

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
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['testnet-wallet-1']);

      const response = await request(app)
        .post('/sync/network/testnet')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('testnet-wallet-1', 'high');
    });

    it('should queue signet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['signet-wallet-1']);

      const response = await request(app)
        .post('/sync/network/signet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
    });

    it('should return empty result when no wallets found', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue([]);

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
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1']);

      await request(app)
        .post('/sync/network/mainnet')
        .send({});

      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'normal');
    });
  });

  describe('POST /sync/network/:network/resync', () => {
    it('should resync all wallets for a network with confirmation header', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(50);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 10 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

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
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: true },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(30);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 5 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

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
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(75);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 20 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      // Verify transactions deleted
      expect(mockTransactionRepository.deleteByWalletId).toHaveBeenCalledWith('wallet-1');

      // Verify address flags reset
      expect(mockAddressRepository.resetUsedFlags).toHaveBeenCalledWith('wallet-1');

      // Verify wallet state reset
      expect(mockWalletRepository.resetSyncState).toHaveBeenCalledWith('wallet-1');

      // Verify queued for high priority sync
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'high');
    });
  });

  describe('GET /sync/network/:network/status', () => {
    it('should return aggregate sync status for network', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
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
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([]);

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
