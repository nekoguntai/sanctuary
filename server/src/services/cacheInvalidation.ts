/**
 * Cache Invalidation Service
 *
 * Subscribes to event bus events and invalidates relevant caches.
 * Ensures cache consistency when underlying data changes.
 */

import { eventBus } from '../events/eventBus';
import {
  invalidateWalletCaches,
  blockHeightCache,
  priceCache,
  feeEstimateCache,
} from '../utils/cache';
import { createLogger } from '../utils/logger';

const log = createLogger('CacheInvalidation');

let isInitialized = false;
const unsubscribers: Array<() => void> = [];

/**
 * Initialize cache invalidation listeners
 * Call once at application startup
 */
export function initializeCacheInvalidation(): void {
  if (isInitialized) {
    log.warn('Cache invalidation already initialized');
    return;
  }

  log.info('Initializing cache invalidation listeners');

  // Wallet sync events - invalidate all wallet caches
  unsubscribers.push(
    eventBus.on('wallet:synced', ({ walletId }) => {
      log.debug(`Invalidating caches for synced wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  // Wallet deletion - clean up caches
  unsubscribers.push(
    eventBus.on('wallet:deleted', ({ walletId }) => {
      log.debug(`Invalidating caches for deleted wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  // Balance changes - invalidate wallet caches
  unsubscribers.push(
    eventBus.on('wallet:balanceChanged', ({ walletId }) => {
      log.debug(`Invalidating caches for balance change in wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  // Transaction events - invalidate affected wallet caches
  unsubscribers.push(
    eventBus.on('transaction:received', ({ walletId }) => {
      log.debug(`Invalidating caches for received transaction in wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:sent', ({ walletId }) => {
      log.debug(`Invalidating caches for sent transaction in wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:confirmed', ({ walletId }) => {
      log.debug(`Invalidating caches for confirmed transaction in wallet ${walletId}`);
      invalidateWalletCaches(walletId);
    })
  );

  // Blockchain events - invalidate global caches
  unsubscribers.push(
    eventBus.on('blockchain:newBlock', ({ height }) => {
      log.debug(`Invalidating block height cache for new block ${height}`);
      blockHeightCache.clear();
    })
  );

  unsubscribers.push(
    eventBus.on('blockchain:priceUpdated', () => {
      log.debug('Invalidating price cache for price update');
      priceCache.clear();
    })
  );

  unsubscribers.push(
    eventBus.on('blockchain:feeEstimateUpdated', () => {
      log.debug('Invalidating fee estimate cache');
      feeEstimateCache.clear();
    })
  );

  isInitialized = true;
  log.info(`Cache invalidation initialized with ${unsubscribers.length} listeners`);
}

/**
 * Shutdown cache invalidation listeners
 * Call on application shutdown
 */
export function shutdownCacheInvalidation(): void {
  if (!isInitialized) {
    return;
  }

  log.info('Shutting down cache invalidation listeners');

  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers.length = 0;

  isInitialized = false;
  log.info('Cache invalidation shutdown complete');
}
