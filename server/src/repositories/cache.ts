/**
 * Repository Cache Layer
 *
 * Provides caching decorators and utilities for repository methods.
 * Uses cache-aside pattern with automatic invalidation.
 *
 * ## Features
 *
 * - Automatic cache key generation
 * - TTL-based expiration
 * - Pattern-based invalidation
 * - Metrics for hit/miss tracking
 *
 * ## Usage
 *
 * ```typescript
 * // In repository
 * export async function findById(id: string): Promise<Wallet | null> {
 *   return withCache(
 *     `wallet:${id}`,
 *     () => prisma.wallet.findUnique({ where: { id } }),
 *     { ttl: 60 }
 *   );
 * }
 *
 * // Invalidation
 * await invalidateCache(`wallet:${walletId}`);
 * await invalidateCachePattern('wallet:*');
 * ```
 */

import { getDistributedCache } from '../infrastructure/redis';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('RepoCache');

// =============================================================================
// Types
// =============================================================================

export interface CacheOptions {
  /** TTL in seconds (default: 60) */
  ttl?: number;
  /** Skip cache read (force refresh) */
  skipRead?: boolean;
  /** Skip cache write */
  skipWrite?: boolean;
  /** Cache namespace for grouping */
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  invalidations: number;
}

// =============================================================================
// State
// =============================================================================

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  writes: 0,
  invalidations: 0,
};

// Default TTLs for different entity types
export const DEFAULT_TTL = {
  wallet: 60,
  walletWithAddresses: 30,
  transaction: 30,
  utxo: 30,
  address: 60,
  user: 300,
  device: 300,
  systemSetting: 600,
} as const;

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Execute a query with caching
 * Implements cache-aside pattern
 */
export async function withCache<T>(
  key: string,
  queryFn: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl = 60, skipRead = false, skipWrite = false, namespace } = options;
  const cache = getDistributedCache();
  const fullKey = namespace ? `${namespace}:${key}` : key;

  // Try cache first (unless skipRead)
  if (!skipRead) {
    try {
      const cached = await cache.get<T>(fullKey);
      if (cached !== null) {
        stats.hits++;
        log.debug('Cache hit', { key: fullKey });
        return cached;
      }
      stats.misses++;
      log.debug('Cache miss', { key: fullKey });
    } catch (error) {
      // Cache read failed, continue to database
      log.warn('Cache read failed, falling back to database', {
        key: fullKey,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  // Execute query
  const result = await queryFn();

  // Cache result (unless skipWrite or null result)
  if (!skipWrite && result !== null) {
    try {
      await cache.set(fullKey, result, ttl);
      stats.writes++;
      log.debug('Cache write', { key: fullKey, ttl });
    } catch (error) {
      // Cache write failed, continue without caching
      log.warn('Cache write failed', {
        key: fullKey,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  return result;
}

/**
 * Execute a query with caching for array results
 * Only caches non-empty arrays
 */
export async function withArrayCache<T>(
  key: string,
  queryFn: () => Promise<T[]>,
  options: CacheOptions = {}
): Promise<T[]> {
  const { ttl = 60, skipRead = false, skipWrite = false, namespace } = options;
  const cache = getDistributedCache();
  const fullKey = namespace ? `${namespace}:${key}` : key;

  // Try cache first (unless skipRead)
  if (!skipRead) {
    try {
      const cached = await cache.get<T[]>(fullKey);
      if (cached !== null && Array.isArray(cached)) {
        stats.hits++;
        log.debug('Cache hit (array)', { key: fullKey, count: cached.length });
        return cached;
      }
      stats.misses++;
    } catch (error) {
      log.warn('Cache read failed for array', { key: fullKey });
    }
  }

  // Execute query
  const result = await queryFn();

  // Cache result (unless skipWrite or empty array)
  if (!skipWrite && result.length > 0) {
    try {
      await cache.set(fullKey, result, ttl);
      stats.writes++;
    } catch (error) {
      log.warn('Cache write failed for array', { key: fullKey });
    }
  }

  return result;
}

/**
 * Invalidate a specific cache key
 */
export async function invalidateCache(key: string, namespace?: string): Promise<boolean> {
  const cache = getDistributedCache();
  const fullKey = namespace ? `${namespace}:${key}` : key;

  try {
    const deleted = await cache.delete(fullKey);
    if (deleted) {
      stats.invalidations++;
      log.debug('Cache invalidated', { key: fullKey });
    }
    return deleted;
  } catch (error) {
    log.warn('Cache invalidation failed', { key: fullKey });
    return false;
  }
}

/**
 * Invalidate cache keys matching a pattern
 */
export async function invalidateCachePattern(pattern: string, namespace?: string): Promise<number> {
  const cache = getDistributedCache();
  const fullPattern = namespace ? `${namespace}:${pattern}` : pattern;

  try {
    const count = await cache.deletePattern(fullPattern);
    stats.invalidations += count;
    log.debug('Cache pattern invalidated', { pattern: fullPattern, count });
    return count;
  } catch (error) {
    log.warn('Cache pattern invalidation failed', { pattern: fullPattern });
    return 0;
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats & { hitRate: number } {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    hitRate: total > 0 ? stats.hits / total : 0,
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.writes = 0;
  stats.invalidations = 0;
}

// =============================================================================
// Cache Key Generators
// =============================================================================

/**
 * Generate cache key for wallet queries
 */
export const walletCacheKey = {
  byId: (walletId: string) => `wallet:${walletId}`,
  byIdWithAddresses: (walletId: string) => `wallet:${walletId}:addresses`,
  byUserId: (userId: string) => `wallet:user:${userId}`,
  byNetwork: (userId: string, network: string) => `wallet:user:${userId}:network:${network}`,
};

/**
 * Generate cache key for transaction queries
 */
export const transactionCacheKey = {
  byWalletId: (walletId: string, page?: number) =>
    page ? `tx:wallet:${walletId}:page:${page}` : `tx:wallet:${walletId}`,
  count: (walletId: string) => `tx:wallet:${walletId}:count`,
};

/**
 * Generate cache key for UTXO queries
 */
export const utxoCacheKey = {
  byWalletId: (walletId: string) => `utxo:wallet:${walletId}`,
  balance: (walletId: string) => `utxo:wallet:${walletId}:balance`,
};

/**
 * Invalidate all cache for a wallet (after sync or modification)
 */
export async function invalidateWalletCache(walletId: string): Promise<void> {
  await Promise.all([
    invalidateCachePattern(`wallet:${walletId}*`),
    invalidateCachePattern(`tx:wallet:${walletId}*`),
    invalidateCachePattern(`utxo:wallet:${walletId}*`),
  ]);
}

/**
 * Invalidate all cache for a user (after wallet creation/deletion)
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await invalidateCachePattern(`wallet:user:${userId}*`);
}
