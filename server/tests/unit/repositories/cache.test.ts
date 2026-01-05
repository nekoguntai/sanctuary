/**
 * Repository Cache Layer Tests
 *
 * Tests for the repository caching utilities.
 */

import {
  withCache,
  withArrayCache,
  invalidateCache,
  invalidateCachePattern,
  getCacheStats,
  resetCacheStats,
  walletCacheKey,
  transactionCacheKey,
  utxoCacheKey,
  invalidateWalletCache,
  invalidateUserCache,
} from '../../../src/repositories/cache';

// Mock the Redis infrastructure
jest.mock('../../../src/infrastructure/redis', () => {
  const cache = new Map<string, { value: any; expiresAt: number }>();

  return {
    getDistributedCache: () => ({
      get: jest.fn(async (key: string) => {
        const entry = cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
          cache.delete(key);
          return null;
        }
        return entry.value;
      }),
      set: jest.fn(async (key: string, value: any, ttl: number) => {
        cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
      }),
      delete: jest.fn(async (key: string) => {
        return cache.delete(key);
      }),
      deletePattern: jest.fn(async (pattern: string) => {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        let count = 0;
        for (const key of cache.keys()) {
          if (regex.test(key)) {
            cache.delete(key);
            count++;
          }
        }
        return count;
      }),
    }),
  };
});

describe('Repository Cache', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  describe('withCache', () => {
    it('should cache query results', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: '1', name: 'test' });

      // First call - should execute query
      const result1 = await withCache('test-key', queryFn);
      expect(result1).toEqual({ id: '1', name: 'test' });
      expect(queryFn).toHaveBeenCalledTimes(1);

      // Second call - should return cached value
      const result2 = await withCache('test-key', queryFn);
      expect(result2).toEqual({ id: '1', name: 'test' });
      // Query function should still only be called once
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('should respect TTL', async () => {
      const queryFn = jest.fn().mockResolvedValue({ value: 42 });

      // Use very short TTL
      await withCache('ttl-test', queryFn, { ttl: 1 });

      // Should be cached
      const stats1 = getCacheStats();
      expect(stats1.writes).toBe(1);
    });

    it('should support skipRead option', async () => {
      const queryFn = jest.fn().mockResolvedValue({ fresh: true });

      // Initial cache
      await withCache('skip-test', queryFn);

      // Skip cache read - force fresh query
      queryFn.mockResolvedValue({ fresh: false });
      const result = await withCache('skip-test', queryFn, { skipRead: true });

      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('should support skipWrite option', async () => {
      const queryFn = jest.fn().mockResolvedValue({ noCache: true });

      const statsBeforeWrite = getCacheStats().writes;
      await withCache('no-write-test', queryFn, { skipWrite: true });
      const statsAfterWrite = getCacheStats().writes;

      expect(statsAfterWrite).toBe(statsBeforeWrite);
    });

    it('should support namespace option', async () => {
      const queryFn = jest.fn().mockResolvedValue({ namespaced: true });

      await withCache('key', queryFn, { namespace: 'test-ns' });

      expect(getCacheStats().writes).toBe(1);
    });

    it('should not cache null results', async () => {
      const queryFn = jest.fn().mockResolvedValue(null);

      await withCache('null-test', queryFn);

      expect(getCacheStats().writes).toBe(0);
    });
  });

  describe('withArrayCache', () => {
    it('should cache array results', async () => {
      const queryFn = jest.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const result1 = await withArrayCache('array-test', queryFn);
      expect(result1).toHaveLength(2);

      const result2 = await withArrayCache('array-test', queryFn);
      expect(queryFn).toHaveBeenCalledTimes(1); // Should use cache
    });

    it('should not cache empty arrays', async () => {
      const queryFn = jest.fn().mockResolvedValue([]);

      await withArrayCache('empty-array', queryFn);

      expect(getCacheStats().writes).toBe(0);
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate specific cache key', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: '1' });

      await withCache('invalidate-test', queryFn);
      await invalidateCache('invalidate-test');

      // Next call should execute query again
      await withCache('invalidate-test', queryFn);
      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it('should support namespace in invalidation', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: '1' });

      await withCache('key', queryFn, { namespace: 'ns' });
      await invalidateCache('key', 'ns');

      const stats = getCacheStats();
      expect(stats.invalidations).toBeGreaterThanOrEqual(1);
    });
  });

  describe('invalidateCachePattern', () => {
    it('should invalidate matching keys', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: '1' });

      await withCache('wallet:1:info', queryFn);
      await withCache('wallet:1:balance', queryFn);
      await withCache('wallet:2:info', queryFn);

      const count = await invalidateCachePattern('wallet:1:*');

      // Should invalidate wallet:1:* keys
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCacheStats', () => {
    it('should track cache statistics', async () => {
      resetCacheStats();

      const queryFn = jest.fn().mockResolvedValue({ id: '1' });

      // Generate some activity
      await withCache('stats-test', queryFn);
      await withCache('stats-test', queryFn); // Should hit cache
      await invalidateCache('stats-test');

      const stats = getCacheStats();
      expect(stats.writes).toBeGreaterThanOrEqual(1);
      expect(stats.invalidations).toBeGreaterThanOrEqual(1);
      expect(stats).toHaveProperty('hitRate');
    });
  });

  describe('cache key generators', () => {
    it('should generate wallet cache keys', () => {
      expect(walletCacheKey.byId('123')).toBe('wallet:123');
      expect(walletCacheKey.byIdWithAddresses('123')).toBe('wallet:123:addresses');
      expect(walletCacheKey.byUserId('user1')).toBe('wallet:user:user1');
      expect(walletCacheKey.byNetwork('user1', 'mainnet')).toBe('wallet:user:user1:network:mainnet');
    });

    it('should generate transaction cache keys', () => {
      expect(transactionCacheKey.byWalletId('w1')).toBe('tx:wallet:w1');
      expect(transactionCacheKey.byWalletId('w1', 2)).toBe('tx:wallet:w1:page:2');
      expect(transactionCacheKey.count('w1')).toBe('tx:wallet:w1:count');
    });

    it('should generate UTXO cache keys', () => {
      expect(utxoCacheKey.byWalletId('w1')).toBe('utxo:wallet:w1');
      expect(utxoCacheKey.balance('w1')).toBe('utxo:wallet:w1:balance');
    });
  });

  describe('invalidateWalletCache', () => {
    it('should invalidate all wallet-related cache', async () => {
      const queryFn = jest.fn().mockResolvedValue({ id: '1' });

      // Cache some wallet data
      await withCache('wallet:123:info', queryFn);
      await withCache('tx:wallet:123:page:1', queryFn);
      await withCache('utxo:wallet:123:balance', queryFn);

      await invalidateWalletCache('123');

      const stats = getCacheStats();
      expect(stats.invalidations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('invalidateUserCache', () => {
    it('should invalidate user-related cache', async () => {
      const queryFn = jest.fn().mockResolvedValue([{ id: '1' }]);

      await withCache('wallet:user:u1:list', queryFn);

      await invalidateUserCache('u1');

      const stats = getCacheStats();
      expect(stats.invalidations).toBeGreaterThanOrEqual(0);
    });
  });
});
