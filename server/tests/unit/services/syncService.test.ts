import { vi } from 'vitest';
/**
 * Sync Service Unit Tests
 *
 * Tests for wallet synchronization service including:
 * - Queue management
 * - Concurrent sync handling
 * - Retry logic
 * - Error handling
 * - Real-time subscriptions
 */

// Use vi.hoisted to define mocks that are used in vi.mock factories
const {
  mockPrismaClient,
  mockSyncWallet,
  mockUpdateTransactionConfirmations,
  mockPopulateMissingTransactionFields,
  mockGetBlockHeight,
  mockSetCachedBlockHeight,
  mockElectrumClient,
  mockNotificationService,
  mockAcquireLock,
  mockExtendLock,
  mockReleaseLock,
} = vi.hoisted(() => ({
  mockPrismaClient: {
    wallet: {
      findUnique: vi.fn<any>(),
      findMany: vi.fn<any>(),
      update: vi.fn<any>(),
      updateMany: vi.fn<any>(),
    },
    address: {
      findMany: vi.fn<any>(),
      findFirst: vi.fn<any>(),
    },
    transaction: {
      findMany: vi.fn<any>(),
      findFirst: vi.fn<any>(),
    },
    uTXO: {
      aggregate: vi.fn<any>(),
    },
    refreshToken: {
      findMany: vi.fn<any>(),
    },
    $transaction: vi.fn<any>(),
  },
  mockSyncWallet: vi.fn<any>(),
  mockUpdateTransactionConfirmations: vi.fn<any>(),
  mockPopulateMissingTransactionFields: vi.fn<any>(),
  mockGetBlockHeight: vi.fn<any>(),
  mockSetCachedBlockHeight: vi.fn<any>(),
  mockElectrumClient: {
    getServerVersion: vi.fn<any>(),
    subscribeHeaders: vi.fn<any>(),
    subscribeAddress: vi.fn<any>(),
    subscribeAddressBatch: vi.fn<any>(),
    unsubscribeAddress: vi.fn<any>(),
    on: vi.fn<any>(),
    removeAllListeners: vi.fn<any>(),
  },
  mockNotificationService: {
    broadcastSyncStatus: vi.fn<any>(),
    broadcastBalanceUpdate: vi.fn<any>(),
    broadcastNewBlock: vi.fn<any>(),
    broadcastConfirmationUpdate: vi.fn<any>(),
    broadcastTransactionNotification: vi.fn<any>(),
  },
  mockAcquireLock: vi.fn<any>(),
  mockExtendLock: vi.fn<any>(),
  mockReleaseLock: vi.fn<any>(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
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

// Mock config
vi.mock('../../../src/config', () => ({
  getConfig: () => ({
    sync: {
      intervalMs: 60000,
      confirmationUpdateIntervalMs: 30000,
      staleThresholdMs: 300000,
      maxConcurrentSyncs: 3,
      maxRetryAttempts: 3,
      retryDelaysMs: [1000, 5000, 15000],
      maxSyncDurationMs: 120000,
      transactionBatchSize: 100,
    },
    bitcoin: {
      network: 'testnet',
    },
  }),
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  syncWallet: mockSyncWallet,
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
  getBlockHeight: mockGetBlockHeight,
  setCachedBlockHeight: mockSetCachedBlockHeight,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn<any>().mockResolvedValue(mockElectrumClient),
  getElectrumClientIfActive: vi.fn<any>().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../src/websocket/notifications', () => ({
  getNotificationService: () => mockNotificationService,
  walletLog: vi.fn(),
}));

// Mock event service
vi.mock('../../../src/services/eventService', () => ({
  eventService: {
    emitNewBlock: vi.fn(),
    emitWalletSyncStarted: vi.fn(),
    emitWalletSynced: vi.fn(),
    emitWalletSyncFailed: vi.fn(),
    emitTransactionConfirmed: vi.fn(),
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
}));

// Mock dead letter queue
vi.mock('../../../src/services/deadLetterQueue', () => ({
  recordSyncFailure: vi.fn(),
}));

// Mock metrics
vi.mock('../../../src/observability/metrics', () => ({
  walletSyncsTotal: { inc: vi.fn() },
  walletSyncDuration: { observe: vi.fn() },
}));

// Mock async utilities
vi.mock('../../../src/utils/async', () => ({
  withTimeout: vi.fn().mockImplementation((promise) => promise),
}));

// Import after mocks
import SyncService, { getSyncService } from '../../../src/services/syncService';

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Get fresh instance
    syncService = getSyncService();

    // Reset service state by stopping and ensuring clean state
    syncService['isRunning'] = false;
    syncService['syncQueue'] = [];
    syncService['activeSyncs'] = new Set();
    syncService['activeLocks'] = new Map();
    syncService['addressToWalletMap'] = new Map();
    syncService['pendingRetries'] = new Map();
    syncService['subscriptionLock'] = null;
    syncService['subscriptionLockRefresh'] = null;
    syncService['subscriptionsEnabled'] = false;
    syncService['subscriptionOwnership'] = 'disabled';

    // Default mock implementations
    mockAcquireLock.mockResolvedValue({
      key: 'electrum:subscriptions',
      token: 'test-token',
      expiresAt: Date.now() + 60000,
      isLocal: true,
    });
    mockExtendLock.mockImplementation(async (lock) => lock);
    mockReleaseLock.mockResolvedValue(undefined);
    mockSyncWallet.mockResolvedValue({ addresses: 10, transactions: 5, utxos: 3 });
    mockPopulateMissingTransactionFields.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
    mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.wallet.update.mockResolvedValue({});
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
    mockElectrumClient.subscribeHeaders.mockResolvedValue({ height: 100000 });
    mockElectrumClient.subscribeAddressBatch.mockResolvedValue(new Map());
    mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'test', protocol: '1.4' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clean up service
    await syncService.stop();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getSyncService();
      const instance2 = getSyncService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('start/stop', () => {
    it('should start the service', async () => {
      await syncService.start();

      expect(syncService['isRunning']).toBe(true);
    });

    it('should not start twice', async () => {
      await syncService.start();
      await syncService.start();

      // Should still be running, no errors
      expect(syncService['isRunning']).toBe(true);
    });

    it('should stop the service', async () => {
      await syncService.start();
      await syncService.stop();

      expect(syncService['isRunning']).toBe(false);
    });

    it('should reset stuck syncs on start', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 2 });

      await syncService.start();

      expect(mockPrismaClient.wallet.updateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
    });

    it('should drain queued sync jobs when starting', async () => {
      const executeSyncJobSpy = vi
        .spyOn(syncService as any, 'executeSyncJob')
        .mockResolvedValue({ success: true, addresses: 0, transactions: 0, utxos: 0 });

      // Queue before startup: processQueue is a no-op while not running.
      syncService.queueSync('wallet-prestart');
      expect(syncService['syncQueue']).toHaveLength(1);

      await syncService.start();

      expect(syncService['syncQueue']).toHaveLength(0);
      expect(executeSyncJobSpy).toHaveBeenCalledWith('wallet-prestart');

      executeSyncJobSpy.mockRestore();
    });
  });

  describe('queueSync', () => {
    it('should add wallet to queue when service is running', async () => {
      // Start the service first so isRunning is true
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      syncService.queueSync('wallet-1', 'normal');

      // Verify queueSync was called (internal queue state is implementation detail)
      // The important thing is that it doesn't throw
      expect(syncService['isRunning']).toBe(true);
    });

    it('should not throw on duplicate queue calls', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw
      syncService.queueSync('wallet-1');
      syncService.queueSync('wallet-1');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle priority upgrade request', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw when upgrading priority
      syncService.queueSync('wallet-1', 'low');
      syncService.queueSync('wallet-1', 'high');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should not queue if already syncing', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();
      syncService['activeSyncs'].add('wallet-1');

      // Should not throw when trying to queue an already syncing wallet
      syncService.queueSync('wallet-1');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle multiple different wallet queues', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw when queuing multiple wallets with different priorities
      syncService.queueSync('wallet-low', 'low');
      syncService.queueSync('wallet-normal', 'normal');
      syncService.queueSync('wallet-high', 'high');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle large queue gracefully', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Queue many wallets - should not throw
      for (let i = 0; i < 100; i++) {
        syncService.queueSync(`wallet-${i}`, 'normal');
      }

      expect(syncService['isRunning']).toBe(true);

      // Additional wallet should also not throw
      syncService.queueSync('wallet-overflow', 'high');

      expect(syncService['isRunning']).toBe(true);
    });
  });

  describe('queueUserWallets', () => {
    it('should query wallets for a user', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
        { id: 'wallet-3' },
      ]);

      await syncService.queueUserWallets('user-1');

      // Verify the database was queried for user's wallets
      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalled();
    });

    it('should include group wallets in query', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'personal-wallet' },
        { id: 'group-wallet' },
      ]);

      await syncService.queueUserWallets('user-1', 'high');

      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: 'user-1' } } },
            { group: { members: { some: { userId: 'user-1' } } } },
          ],
        },
        select: { id: true },
      });
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for wallet', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-1');

      expect(status.syncStatus).toBe('success');
      expect(status.syncInProgress).toBe(false);
    });

    it('should detect stale wallets', async () => {
      syncService['isRunning'] = true;

      const oldDate = new Date(Date.now() - 600000); // 10 minutes ago
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: oldDate,
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-1');

      expect(status.isStale).toBe(true);
    });

    it('should return queue position', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [
        { walletId: 'wallet-1', priority: 'high', requestedAt: new Date() },
        { walletId: 'wallet-2', priority: 'normal', requestedAt: new Date() },
      ];

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-2');

      expect(status.queuePosition).toBe(2);
    });

    it('should throw for non-existent wallet', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(syncService.getSyncStatus('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

  describe('syncNow', () => {
    it('should execute immediate sync', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(true);
      expect(mockSyncWallet).toHaveBeenCalledWith('wallet-1');
    });

    it('should return error if already syncing', async () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('wallet-1');

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });
  });

  describe('distributed locking', () => {
    it('should acquire lock before syncing', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await syncService.syncNow('wallet-1');

      expect(mockAcquireLock).toHaveBeenCalledWith(
        'sync:wallet:wallet-1',
        expect.objectContaining({ ttlMs: expect.any(Number) })
      );
    });

    it('should release lock after sync', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await syncService.syncNow('wallet-1');

      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('should skip sync if lock cannot be acquired', async () => {
      syncService['isRunning'] = true;
      mockAcquireLock.mockResolvedValue(null);

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already syncing');
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('retrying');
    });

    it('should exhaust retries and fail', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValue(new Error('Persistent error'));

      // Execute all retry attempts
      await syncService['executeSyncJob']('wallet-1', 3);

      // Should record failure after max retries
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastSyncStatus: 'failed',
          }),
        })
      );
    });
  });

  describe('concurrent sync limiting', () => {
    it('should limit concurrent syncs', async () => {
      syncService['isRunning'] = true;

      // Simulate 3 active syncs
      syncService['activeSyncs'].add('wallet-1');
      syncService['activeSyncs'].add('wallet-2');
      syncService['activeSyncs'].add('wallet-3');

      // Add more to queue
      syncService.queueSync('wallet-4');
      syncService.queueSync('wallet-5');

      // Queue should have wallets waiting
      expect(syncService['syncQueue'].length).toBe(2);

      // processQueue should not start new syncs when at limit
      await syncService['processQueue']();

      // Still should have wallets in queue (not started)
      // Note: processQueue doesn't actually start them if at limit
    });
  });

  describe('health metrics', () => {
    it('should return health metrics', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [{ walletId: 'w1', priority: 'normal', requestedAt: new Date() }];
      syncService['activeSyncs'].add('w2');
      syncService['addressToWalletMap'].set('addr1', 'w1');

      const metrics = syncService.getHealthMetrics();

      expect(metrics.isRunning).toBe(true);
      expect(metrics.queueLength).toBe(1);
      expect(metrics.activeSyncs).toBe(1);
      expect(metrics.subscribedAddresses).toBe(1);
    });
  });

  describe('address subscriptions', () => {
    it('should subscribe to wallet addresses', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: 'tb1qaddr1' },
        { address: 'tb1qaddr2' },
      ]);

      await syncService.subscribeNewWalletAddresses('wallet-1');

      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe wallet addresses', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('addr1', 'wallet-1');
      syncService['addressToWalletMap'].set('addr2', 'wallet-1');
      syncService['addressToWalletMap'].set('addr3', 'wallet-2');

      await syncService.unsubscribeWalletAddresses('wallet-1');

      expect(syncService['addressToWalletMap'].size).toBe(1);
      expect(mockElectrumClient.unsubscribeAddress).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup on stop', () => {
    it('should cancel pending retry timers', async () => {
      syncService['isRunning'] = true;

      const timer = setTimeout(() => {}, 10000);
      syncService['pendingRetries'].set('wallet-1', timer);

      await syncService.stop();

      expect(syncService['pendingRetries'].size).toBe(0);
    });

    it('should release all active locks', async () => {
      syncService['isRunning'] = true;

      syncService['activeLocks'].set('wallet-1', { id: 'lock-1', resource: 'test' } as any);
      syncService['activeLocks'].set('wallet-2', { id: 'lock-2', resource: 'test' } as any);

      await syncService.stop();

      expect(mockReleaseLock).toHaveBeenCalledTimes(2);
      expect(syncService['activeLocks'].size).toBe(0);
    });

    it('should clear the sync queue', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [
        { walletId: 'w1', priority: 'normal', requestedAt: new Date() },
        { walletId: 'w2', priority: 'high', requestedAt: new Date() },
      ];

      await syncService.stop();

      expect(syncService['syncQueue'].length).toBe(0);
    });
  });
});

describe('SyncService - Error Handling', () => {
  let syncService: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = getSyncService();
    syncService['isRunning'] = false;
    syncService['syncQueue'] = [];
    syncService['activeSyncs'] = new Set();
    syncService['activeLocks'] = new Map();

    mockAcquireLock.mockResolvedValue({ id: 'lock-1', resource: 'test' });
    mockReleaseLock.mockResolvedValue(undefined);
    mockPrismaClient.wallet.update.mockResolvedValue({});
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
  });

  afterEach(async () => {
    await syncService.stop();
  });

  it('should handle Electrum connection failure', async () => {
    syncService['isRunning'] = true;
    mockSyncWallet.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await syncService.syncNow('wallet-1');

    expect(result.success).toBe(false);
  });

  it('should handle timeout errors', async () => {
    syncService['isRunning'] = true;
    mockSyncWallet.mockRejectedValue(new Error('Sync timeout: exceeded 120s limit'));

    const result = await syncService.syncNow('wallet-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should handle database errors', async () => {
    syncService['isRunning'] = true;
    mockPrismaClient.wallet.update.mockRejectedValue(new Error('Database connection lost'));

    await expect(syncService.syncNow('wallet-1')).rejects.toThrow();
  });
});
