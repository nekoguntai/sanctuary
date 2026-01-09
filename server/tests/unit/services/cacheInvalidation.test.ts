import { vi } from 'vitest';
/**
 * Cache Invalidation Service Tests
 *
 * Tests the event-driven cache invalidation system that subscribes
 * to event bus events and invalidates relevant caches.
 */

import {
  initializeCacheInvalidation,
  shutdownCacheInvalidation,
} from '../../../src/services/cacheInvalidation';
import { eventBus } from '../../../src/events/eventBus';
import {
  invalidateWalletCaches,
  blockHeightCache,
  priceCache,
  feeEstimateCache,
} from '../../../src/utils/cache';

// Mock the cache utilities
vi.mock('../../../src/utils/cache', () => ({
  invalidateWalletCaches: vi.fn(),
  blockHeightCache: { clear: vi.fn() },
  priceCache: { clear: vi.fn() },
  feeEstimateCache: { clear: vi.fn() },
}));

// Mock logger to avoid console noise
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CacheInvalidation', () => {
  beforeEach(() => {
    // Clean up any previous initialization
    shutdownCacheInvalidation();
    // Clear all mock calls
    vi.clearAllMocks();
  });

  afterEach(() => {
    shutdownCacheInvalidation();
  });

  describe('initializeCacheInvalidation', () => {
    it('should register event listeners on initialization', () => {
      const initialListenerCount = eventBus.listenerCount('wallet:synced');

      initializeCacheInvalidation();

      // Should have registered listeners for various events
      expect(eventBus.listenerCount('wallet:synced')).toBeGreaterThan(initialListenerCount);
      expect(eventBus.listenerCount('wallet:deleted')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('wallet:balanceChanged')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:received')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:sent')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:confirmed')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('blockchain:newBlock')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('blockchain:priceUpdated')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('blockchain:feeEstimateUpdated')).toBeGreaterThan(0);
    });

    it('should not register duplicate listeners on re-initialization', () => {
      initializeCacheInvalidation();
      const listenerCount = eventBus.listenerCount('wallet:synced');

      // Try to initialize again
      initializeCacheInvalidation();

      // Should still have the same number of listeners
      expect(eventBus.listenerCount('wallet:synced')).toBe(listenerCount);
    });
  });

  describe('shutdownCacheInvalidation', () => {
    it('should remove all event listeners on shutdown', () => {
      initializeCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBeGreaterThan(0);

      shutdownCacheInvalidation();

      // All listeners registered by this service should be removed
      // (Note: other services might still have listeners)
      expect(eventBus.listenerCount('wallet:synced')).toBe(0);
      expect(eventBus.listenerCount('wallet:deleted')).toBe(0);
      expect(eventBus.listenerCount('wallet:balanceChanged')).toBe(0);
    });

    it('should be safe to call shutdown when not initialized', () => {
      // Should not throw
      expect(() => shutdownCacheInvalidation()).not.toThrow();
    });

    it('should be safe to call shutdown multiple times', () => {
      initializeCacheInvalidation();
      shutdownCacheInvalidation();

      // Second shutdown should be a no-op
      expect(() => shutdownCacheInvalidation()).not.toThrow();
    });
  });

  describe('wallet event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should invalidate caches on wallet:synced event', async () => {
      const walletId = 'test-wallet-123';

      eventBus.emit('wallet:synced', {
        walletId,
        balance: 100000n,
        unconfirmedBalance: 0n,
        transactionCount: 10,
        duration: 500,
      });

      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });

    it('should invalidate caches on wallet:deleted event', async () => {
      const walletId = 'deleted-wallet-456';

      eventBus.emit('wallet:deleted', {
        walletId,
        userId: 'user-123',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });

    it('should invalidate caches on wallet:balanceChanged event', async () => {
      const walletId = 'balance-wallet-789';

      eventBus.emit('wallet:balanceChanged', {
        walletId,
        previousBalance: 50000n,
        newBalance: 100000n,
        difference: 50000n,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });
  });

  describe('transaction event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should invalidate caches on transaction:received event', async () => {
      const walletId = 'tx-wallet-1';

      eventBus.emit('transaction:received', {
        walletId,
        txid: 'abc123',
        amount: 10000n,
        address: 'bc1q...',
        confirmations: 0,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });

    it('should invalidate caches on transaction:sent event', async () => {
      const walletId = 'tx-wallet-2';

      eventBus.emit('transaction:sent', {
        walletId,
        txid: 'def456',
        amount: 5000n,
        fee: 200n,
        recipients: [{ address: 'bc1q...', amount: 5000n }],
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });

    it('should invalidate caches on transaction:confirmed event', async () => {
      const walletId = 'tx-wallet-3';

      eventBus.emit('transaction:confirmed', {
        walletId,
        txid: 'ghi789',
        confirmations: 6,
        blockHeight: 800000,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
    });
  });

  describe('blockchain event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should clear block height cache on blockchain:newBlock event', async () => {
      eventBus.emit('blockchain:newBlock', {
        network: 'mainnet',
        height: 800001,
        hash: '00000000000000000000abc...',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(blockHeightCache.clear).toHaveBeenCalled();
    });

    it('should clear price cache on blockchain:priceUpdated event', async () => {
      eventBus.emit('blockchain:priceUpdated', {
        btcUsd: 45000,
        source: 'coingecko',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(priceCache.clear).toHaveBeenCalled();
    });

    it('should clear fee estimate cache on blockchain:feeEstimateUpdated event', async () => {
      eventBus.emit('blockchain:feeEstimateUpdated', {
        network: 'mainnet',
        fastestFee: 50,
        halfHourFee: 30,
        hourFee: 10,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(feeEstimateCache.clear).toHaveBeenCalled();
    });
  });

  describe('multiple events', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should handle multiple wallet events for different wallets', async () => {
      const walletIds = ['wallet-a', 'wallet-b', 'wallet-c'];

      for (const walletId of walletIds) {
        eventBus.emit('wallet:synced', {
          walletId,
          balance: 100000n,
          unconfirmedBalance: 0n,
          transactionCount: 5,
          duration: 100,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(invalidateWalletCaches).toHaveBeenCalledTimes(3);
      for (const walletId of walletIds) {
        expect(invalidateWalletCaches).toHaveBeenCalledWith(walletId);
      }
    });

    it('should handle rapid successive events', async () => {
      const walletId = 'rapid-wallet';

      // Emit multiple events in quick succession
      for (let i = 0; i < 5; i++) {
        eventBus.emit('wallet:balanceChanged', {
          walletId,
          previousBalance: BigInt(i * 1000),
          newBalance: BigInt((i + 1) * 1000),
          difference: 1000n,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(invalidateWalletCaches).toHaveBeenCalledTimes(5);
    });
  });

  describe('initialization state', () => {
    it('should allow re-initialization after shutdown', () => {
      initializeCacheInvalidation();
      const firstCount = eventBus.listenerCount('wallet:synced');

      shutdownCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBe(0);

      initializeCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBe(firstCount);
    });
  });
});
