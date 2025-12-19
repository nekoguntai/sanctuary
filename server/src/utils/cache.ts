/**
 * Application Cache Utilities
 *
 * Provides LRU caching for frequently accessed data to reduce database load.
 * Uses TTL-based expiration for automatic cache invalidation.
 */

import { LRUCache } from 'lru-cache';
import { createLogger } from './logger';

const log = createLogger('CACHE');

interface CacheOptions {
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** Maximum number of items in cache */
  maxItems: number;
  /** Cache name for logging */
  name: string;
}

/**
 * Generic typed LRU cache wrapper
 */
export class ApplicationCache<T extends object> {
  private cache: LRUCache<string, T>;
  private name: string;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions) {
    this.name = options.name;
    this.cache = new LRUCache<string, T>({
      max: options.maxItems,
      ttl: options.ttlMs,
    });
  }

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.hits++;
    } else {
      this.misses++;
    }
    return value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  /**
   * Delete specific key from cache
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   */
  invalidatePattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    log.debug(`[CACHE] Cleared ${this.name} cache`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { name: string; size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A';
    return {
      name: this.name,
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate,
    };
  }
}

// ========================================
// CACHE INSTANCES
// ========================================

/**
 * Cache for wallet balances
 * Key: walletId
 * Value: { balance } in satoshis
 * TTL: 30 seconds (balances change with transactions)
 */
export const walletBalanceCache = new ApplicationCache<{ balance: number }>({
  ttlMs: 30000,
  maxItems: 1000,
  name: 'wallet-balance',
});

/**
 * Cache for fee estimates
 * Key: 'fee-estimates'
 * Value: { fastest, halfHour, hour, economy }
 * TTL: 30 seconds (matches FEE_ESTIMATE_CACHE_DURATION)
 */
export const feeEstimateCache = new ApplicationCache<{
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}>({
  ttlMs: 30000,
  maxItems: 1,
  name: 'fee-estimate',
});

/**
 * Cache for current block height
 * Key: 'block-height'
 * Value: { height } block number
 * TTL: 10 seconds (new blocks ~10 minutes, but we want fresh data)
 */
export const blockHeightCache = new ApplicationCache<{ height: number }>({
  ttlMs: 10000,
  maxItems: 1,
  name: 'block-height',
});

/**
 * Cache for Bitcoin price
 * Key: currency code (e.g., 'USD')
 * Value: price in fiat
 * TTL: 60 seconds (price updates are not critical)
 */
export const priceCache = new ApplicationCache<{ price: number; change24h?: number }>({
  ttlMs: 60000,
  maxItems: 10,
  name: 'price',
});

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get or compute value with cache
 * If value exists in cache, return it. Otherwise, compute and cache.
 */
export async function getOrCompute<T extends object>(
  cache: ApplicationCache<T>,
  key: string,
  compute: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await compute();
  cache.set(key, value);
  return value;
}

/**
 * Invalidate wallet-related caches when data changes
 */
export function invalidateWalletCaches(walletId: string): void {
  walletBalanceCache.invalidate(walletId);
  log.debug(`[CACHE] Invalidated caches for wallet ${walletId}`);
}

/**
 * Get all cache statistics for monitoring
 */
export function getAllCacheStats(): Array<{ name: string; size: number; hits: number; misses: number; hitRate: string }> {
  return [
    walletBalanceCache.getStats(),
    feeEstimateCache.getStats(),
    blockHeightCache.getStats(),
    priceCache.getStats(),
  ];
}
