/**
 * Background Sync Service
 *
 * Manages wallet synchronization with the blockchain.
 * - Queues sync jobs for wallets
 * - Runs periodic background sync
 * - Updates confirmations for pending transactions
 * - Notifies frontend via WebSocket when data changes
 */

import { db as prisma } from '../repositories/db';
import { syncWallet, syncAddress, updateTransactionConfirmations, getBlockHeight, populateMissingTransactionFields, setCachedBlockHeight } from './bitcoin/blockchain';
import { getNodeClient, getElectrumClientIfActive } from './bitcoin/nodeClient';
import { getNotificationService, walletLog } from '../websocket/notifications';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { ElectrumClient } from './bitcoin/electrum';
import { getConfig } from '../config';
import { eventService } from './eventService';
import { recordSyncFailure } from './deadLetterQueue';
import { acquireLock, extendLock, releaseLock, type DistributedLock } from '../infrastructure';
import { walletSyncsTotal, walletSyncDuration } from '../observability/metrics';

const log = createLogger('SYNC');
const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';
const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 2 * 60 * 1000;
const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = 60 * 1000;

interface SyncJob {
  walletId: string;
  priority: 'high' | 'normal' | 'low';
  requestedAt: Date;
  retryCount?: number;
  lastError?: string;
}

// Maximum sync queue size to prevent unbounded memory growth
const MAX_QUEUE_SIZE = 1000;

class SyncService {
  private static instance: SyncService;
  private syncQueue: SyncJob[] = [];
  // Track active syncs in memory for quick lookup (authoritative state is in distributed lock)
  private activeSyncs: Set<string> = new Set();
  // Track distributed locks for active syncs (to release on completion)
  private activeLocks: Map<string, DistributedLock> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private confirmationInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private subscribedToHeaders = false;
  private subscriptionLock: DistributedLock | null = null;
  private subscriptionLockRefresh: NodeJS.Timeout | null = null;
  private subscriptionsEnabled = false;
  private subscriptionOwnership: 'self' | 'external' | 'disabled' = 'disabled';
  // Track which addresses belong to which wallets for real-time notifications
  private addressToWalletMap: Map<string, string> = new Map();
  // Track pending retry timers for cleanup on shutdown
  private pendingRetries: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {}

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Start the background sync service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.info('[SYNC] Service already running');
      return;
    }

    log.info('[SYNC] Starting background sync service...');
    this.isRunning = true;

    // Reset any stuck syncInProgress flags from previous server sessions
    await this.resetStuckSyncs();

    // Get config values
    const syncConfig = getConfig().sync;
    this.subscriptionsEnabled = syncConfig.electrumSubscriptionsEnabled;

    // Start periodic sync check
    this.syncInterval = setInterval(() => {
      this.checkAndQueueStaleSyncs();
    }, syncConfig.intervalMs);

    // Start periodic confirmation updates
    this.confirmationInterval = setInterval(() => {
      this.updateAllConfirmations();
    }, syncConfig.confirmationUpdateIntervalMs);

    // Process any existing queue
    this.processQueue();

    // Set up real-time subscriptions (async, don't block startup)
    this.setupRealTimeSubscriptions().catch(err => {
      log.error('[SYNC] Failed to set up real-time subscriptions', { error: getErrorMessage(err) });
    });

    log.info('[SYNC] Background sync service started');
  }

  /**
   * Set up real-time subscriptions for block and address notifications
   */
  private async setupRealTimeSubscriptions(): Promise<void> {
    try {
      const syncConfig = getConfig().sync;
      this.subscriptionsEnabled = syncConfig.electrumSubscriptionsEnabled;

      if (!this.subscriptionsEnabled) {
        this.subscriptionOwnership = 'disabled';
        log.info('[SYNC] Server-side Electrum subscriptions disabled by config');
        return;
      }

      const lock = await acquireLock(ELECTRUM_SUBSCRIPTION_LOCK_KEY, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
      if (!lock) {
        this.subscriptionOwnership = 'external';
        log.info('[SYNC] Electrum subscriptions owned by another process, skipping setup');
        return;
      }

      this.subscriptionLock = lock;
      this.subscriptionOwnership = 'self';
      this.startSubscriptionLockRefresh();
      log.info('[SYNC] Acquired Electrum subscription ownership');

      // Get the node client to ensure it's connected
      const client = await getNodeClient();

      // Only Electrum supports real-time subscriptions
      const electrumClient = await getElectrumClientIfActive();
      if (!electrumClient) {
        log.info('[SYNC] Real-time subscriptions only available with Electrum (current node type does not support it)');
        await this.releaseSubscriptionLock();
        this.subscriptionOwnership = 'disabled';
        return;
      }

      // Negotiate protocol version first (required by some servers like Blockstream)
      try {
        const version = await electrumClient.getServerVersion();
        log.info(`[SYNC] Connected to Electrum server: ${version.server} (protocol ${version.protocol})`);
      } catch (versionError) {
        log.warn('[SYNC] Could not get server version, continuing anyway', { error: getErrorMessage(versionError) });
      }

      // Subscribe to new block headers
      if (!this.subscribedToHeaders) {
        const currentHeader = await electrumClient.subscribeHeaders();
        this.subscribedToHeaders = true;
        log.info(`[SYNC] Subscribed to block headers, current height: ${currentHeader.height}`);

        // Cache the current block height for the configured network
        setCachedBlockHeight(currentHeader.height, getConfig().bitcoin.network);

        // Listen for new blocks
        electrumClient.on('newBlock', this.handleNewBlock.bind(this));

        // Listen for address activity
        electrumClient.on('addressActivity', this.handleAddressActivity.bind(this));
      }

      // Subscribe to all wallet addresses
      await this.subscribeAllWalletAddresses();

      log.info('[SYNC] Real-time subscriptions active');
    } catch (error) {
      log.error('[SYNC] Failed to set up real-time subscriptions', { error: getErrorMessage(error) });
      await this.releaseSubscriptionLock();
      if (this.subscriptionsEnabled) {
        this.subscriptionOwnership = 'external';
      }
    }
  }

  private startSubscriptionLockRefresh(): void {
    if (this.subscriptionLockRefresh) return;

    this.subscriptionLockRefresh = setInterval(async () => {
      if (!this.subscriptionLock) return;

      const refreshed = await extendLock(this.subscriptionLock, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
      if (!refreshed) {
        log.warn('[SYNC] Lost Electrum subscription lock, disabling subscriptions');
        this.subscriptionLock = null;
        this.subscriptionOwnership = 'external';
        this.stopSubscriptionLockRefresh();
        await this.teardownRealTimeSubscriptions();
        return;
      }

      this.subscriptionLock = refreshed;
    }, ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS);

    this.subscriptionLockRefresh.unref?.();
  }

  private stopSubscriptionLockRefresh(): void {
    if (this.subscriptionLockRefresh) {
      clearInterval(this.subscriptionLockRefresh);
      this.subscriptionLockRefresh = null;
    }
  }

  private async releaseSubscriptionLock(): Promise<void> {
    this.stopSubscriptionLockRefresh();
    if (this.subscriptionLock) {
      await releaseLock(this.subscriptionLock);
      this.subscriptionLock = null;
    }
  }

  /**
   * Subscribe to all addresses from all wallets for real-time notifications
   * Uses batch subscription for efficiency (single RPC call vs N calls)
   */
  private async subscribeAllWalletAddresses(): Promise<void> {
    if (this.subscriptionOwnership !== 'self') {
      return;
    }

    const electrumClient = await getElectrumClientIfActive();
    if (!electrumClient) return;

    const addressRecords = await prisma.address.findMany({
      select: { address: true, walletId: true },
    });

    if (addressRecords.length === 0) {
      log.info('[SYNC] No addresses to subscribe to');
      return;
    }

    // Build address to wallet mapping
    const addressToWallet = new Map<string, string>();
    const addresses: string[] = [];
    for (const { address, walletId } of addressRecords) {
      addresses.push(address);
      addressToWallet.set(address, walletId);
    }

    try {
      // Batch subscribe to all addresses in a single RPC call
      const results = await electrumClient.subscribeAddressBatch(addresses);

      // Update our address to wallet mapping for successfully subscribed addresses
      let subscribed = 0;
      for (const [address, status] of results) {
        const walletId = addressToWallet.get(address);
        if (walletId) {
          this.addressToWalletMap.set(address, walletId);
          subscribed++;
        }
      }

      log.info(`[SYNC] Batch subscribed to ${subscribed} addresses for real-time notifications`);
    } catch (error) {
      log.error('[SYNC] Batch subscription failed, falling back to individual subscriptions', { error: getErrorMessage(error) });

      // Fallback to individual subscriptions if batch fails
      let subscribed = 0;
      for (const address of addresses) {
        try {
          await electrumClient.subscribeAddress(address);
          const walletId = addressToWallet.get(address);
          if (walletId) {
            this.addressToWalletMap.set(address, walletId);
            subscribed++;
          }
        } catch (err) {
          log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: getErrorMessage(err) });
        }
      }
      log.info(`[SYNC] Fallback: subscribed to ${subscribed} addresses individually`);
    }
  }

  /**
   * Unsubscribe all addresses for a wallet (call when wallet is deleted)
   * Prevents memory leak by cleaning up the addressToWalletMap
   */
  async unsubscribeWalletAddresses(walletId: string): Promise<void> {
    if (this.subscriptionOwnership !== 'self') {
      return;
    }

    const electrumClient = await getElectrumClientIfActive();

    let unsubscribed = 0;
    for (const [address, wId] of this.addressToWalletMap.entries()) {
      if (wId === walletId) {
        this.addressToWalletMap.delete(address);
        if (electrumClient) {
          try {
            await electrumClient.unsubscribeAddress(address);
            unsubscribed++;
          } catch (error) {
            // Silently ignore unsubscribe errors
          }
        }
      }
    }

    if (unsubscribed > 0) {
      log.debug(`[SYNC] Unsubscribed ${unsubscribed} addresses for wallet ${walletId}`);
    }
  }

  /**
   * Get health metrics for monitoring
   */
  getHealthMetrics(): {
    isRunning: boolean;
    queueLength: number;
    activeSyncs: number;
    subscribedAddresses: number;
    subscriptionsEnabled: boolean;
    subscriptionOwnership: 'self' | 'external' | 'disabled';
  } {
    return {
      isRunning: this.isRunning,
      queueLength: this.syncQueue.length,
      activeSyncs: this.activeSyncs.size,
      subscribedAddresses: this.addressToWalletMap.size,
      subscriptionsEnabled: this.subscriptionsEnabled,
      subscriptionOwnership: this.subscriptionOwnership,
    };
  }

  /**
   * Handle new block notification - immediately update confirmations
   */
  private async handleNewBlock(block: { height: number; hex: string }): Promise<void> {
    log.info(`[SYNC] New block received at height ${block.height}`);

    // Update cached block height for the configured network
    const network = getConfig().bitcoin.network;
    setCachedBlockHeight(block.height, network);

    // Emit new block event (handles both event bus and WebSocket)
    eventService.emitNewBlock(network, block.height, block.hex.slice(0, 64));

    // Immediately update confirmations for all pending transactions
    try {
      await this.updateAllConfirmations();

      // Notify frontend of new block
      const notificationService = getNotificationService();
      notificationService.broadcastNewBlock({
        height: block.height,
      });
    } catch (error) {
      log.error('[SYNC] Failed to update confirmations after new block', { error: getErrorMessage(error) });
    }
  }

  /**
   * Handle address activity notification - queue affected wallet for sync
   */
  private async handleAddressActivity(activity: { scriptHash: string; address?: string; status: string }): Promise<void> {
    const address = activity.address;
    if (!address) {
      log.warn('[SYNC] Received address activity without resolved address');
      return;
    }

    log.info(`[SYNC] Address activity detected: ${address}`);

    // Find the wallet for this address
    const walletId = this.addressToWalletMap.get(address);
    if (walletId) {
      // Queue high-priority sync for this wallet
      this.queueSync(walletId, 'high');
      log.info(`[SYNC] Queued high-priority sync for wallet ${walletId} due to address activity`);
    } else {
      // Try to look up the wallet from the database
      const addressRecord = await prisma.address.findFirst({
        where: { address },
        select: { walletId: true },
      });

      if (addressRecord) {
        this.addressToWalletMap.set(address, addressRecord.walletId);
        this.queueSync(addressRecord.walletId, 'high');
        log.info(`[SYNC] Queued high-priority sync for wallet ${addressRecord.walletId} due to address activity`);
      }
    }
  }

  /**
   * Reset any wallets that have syncInProgress stuck as true
   * This happens if the server was restarted during a sync
   */
  private async resetStuckSyncs(): Promise<void> {
    try {
      const result = await prisma.wallet.updateMany({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
      if (result.count > 0) {
        log.info(`[SYNC] Reset ${result.count} stuck sync flags from previous session`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to reset stuck sync flags', { error: getErrorMessage(error) });
    }
  }

  /**
   * Stop the background sync service
   */
  async stop(): Promise<void> {
    log.info('[SYNC] Stopping background sync service...');
    this.isRunning = false;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.confirmationInterval) {
      clearInterval(this.confirmationInterval);
      this.confirmationInterval = null;
    }

    await this.teardownRealTimeSubscriptions();
    await this.releaseSubscriptionLock();

    // Cancel all pending retry timers
    if (this.pendingRetries.size > 0) {
      log.info(`[SYNC] Cancelling ${this.pendingRetries.size} pending retry timers`);
      for (const timer of this.pendingRetries.values()) {
        clearTimeout(timer);
      }
      this.pendingRetries.clear();
    }

    // Release all active distributed locks
    if (this.activeLocks.size > 0) {
      log.info(`[SYNC] Releasing ${this.activeLocks.size} active sync locks`);
      for (const [walletId, lock] of this.activeLocks.entries()) {
        try {
          await releaseLock(lock);
        } catch (error) {
          log.warn(`[SYNC] Failed to release lock for wallet ${walletId}`, { error });
        }
      }
      this.activeLocks.clear();
      this.activeSyncs.clear();
    }

    // Clear the sync queue
    if (this.syncQueue.length > 0) {
      log.info(`[SYNC] Clearing ${this.syncQueue.length} queued sync jobs`);
      this.syncQueue.length = 0;
    }

    this.subscriptionOwnership = this.subscriptionsEnabled ? 'external' : 'disabled';

    log.info('[SYNC] Background sync service stopped');
  }

  private async teardownRealTimeSubscriptions(): Promise<void> {
    this.subscribedToHeaders = false;

    const electrumClient = await getElectrumClientIfActive();
    if (electrumClient && this.addressToWalletMap.size > 0) {
      for (const address of this.addressToWalletMap.keys()) {
        try {
          await electrumClient.unsubscribeAddress(address);
        } catch (error) {
          log.debug(`[SYNC] Failed to unsubscribe address ${address} (non-critical)`, { error: getErrorMessage(error) });
        }
      }
    }

    this.addressToWalletMap.clear();

    if (electrumClient) {
      electrumClient.removeAllListeners('newBlock');
      electrumClient.removeAllListeners('addressActivity');
    }
  }

  /**
   * Subscribe to new addresses for a wallet (called when wallet is created/imported)
   */
  async subscribeNewWalletAddresses(walletId: string): Promise<void> {
    if (this.subscriptionOwnership !== 'self') {
      return;
    }

    const electrumClient = await getElectrumClientIfActive();
    if (!electrumClient) return;

    const addresses = await prisma.address.findMany({
      where: { walletId },
      select: { address: true },
    });

    for (const { address } of addresses) {
      try {
        if (!this.addressToWalletMap.has(address)) {
          await electrumClient.subscribeAddress(address);
          this.addressToWalletMap.set(address, walletId);
        }
      } catch (error) {
        log.error(`[SYNC] Failed to subscribe to new address ${address}`, { error: getErrorMessage(error) });
      }
    }

    log.info(`[SYNC] Subscribed to ${addresses.length} addresses for new wallet ${walletId}`);
  }

  /**
   * Queue a wallet for sync
   */
  queueSync(walletId: string, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    // Don't queue if already in queue or actively syncing
    if (this.activeSyncs.has(walletId)) {
      log.info(`[SYNC] Wallet ${walletId} already syncing, skipping queue`);
      return;
    }

    const existingIndex = this.syncQueue.findIndex(j => j.walletId === walletId);
    if (existingIndex >= 0) {
      // Upgrade priority if higher
      if (priority === 'high' && this.syncQueue[existingIndex].priority !== 'high') {
        this.syncQueue[existingIndex].priority = 'high';
        this.sortQueue();
      }
      return;
    }

    // Enforce queue size limit to prevent unbounded memory growth
    if (this.syncQueue.length >= MAX_QUEUE_SIZE) {
      // Try to evict a low-priority job
      const lowPriorityIndex = this.syncQueue.findIndex(j => j.priority === 'low');
      if (lowPriorityIndex >= 0) {
        const evicted = this.syncQueue.splice(lowPriorityIndex, 1)[0];
        log.warn(`[SYNC] Queue full, evicted low-priority wallet ${evicted.walletId}`);
      } else if (priority === 'low') {
        // Don't add low-priority if queue is full of higher priority
        log.warn(`[SYNC] Queue full (${MAX_QUEUE_SIZE}), rejecting low-priority wallet ${walletId}`);
        return;
      } else {
        // Evict oldest normal priority for high priority request
        const normalIndex = this.syncQueue.findIndex(j => j.priority === 'normal');
        if (normalIndex >= 0 && priority === 'high') {
          const evicted = this.syncQueue.splice(normalIndex, 1)[0];
          log.warn(`[SYNC] Queue full, evicted normal-priority wallet ${evicted.walletId} for high-priority`);
        } else {
          log.warn(`[SYNC] Queue full (${MAX_QUEUE_SIZE}), rejecting wallet ${walletId}`);
          return;
        }
      }
    }

    this.syncQueue.push({
      walletId,
      priority,
      requestedAt: new Date(),
    });

    this.sortQueue();
    log.info(`[SYNC] Queued wallet ${walletId} with ${priority} priority (queue size: ${this.syncQueue.length})`);

    // Start processing if not already
    this.processQueue();
  }

  /**
   * Queue all user's wallets for sync (called on login/page load)
   */
  async queueUserWallets(userId: string, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });

    for (const wallet of wallets) {
      this.queueSync(wallet.id, priority);
    }

    log.info(`[SYNC] Queued ${wallets.length} wallets for user ${userId}`);
  }

  /**
   * Get sync status for a wallet
   */
  async getSyncStatus(walletId: string): Promise<{
    lastSyncedAt: Date | null;
    syncStatus: string | null;
    syncInProgress: boolean;
    isStale: boolean;
    queuePosition: number | null;
  }> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        lastSyncedAt: true,
        lastSyncStatus: true,
        syncInProgress: true,
      },
    });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const queuePosition = this.syncQueue.findIndex(j => j.walletId === walletId);
    const { staleThresholdMs } = getConfig().sync;
    const isStale = !wallet.lastSyncedAt ||
      (Date.now() - wallet.lastSyncedAt.getTime()) > staleThresholdMs;

    // Only trust the in-memory activeSyncs set for current sync status
    // The DB flag may be stale from a previous server session
    const isActuallyInProgress = this.activeSyncs.has(walletId);

    return {
      lastSyncedAt: wallet.lastSyncedAt,
      syncStatus: wallet.lastSyncStatus,
      syncInProgress: isActuallyInProgress,
      isStale,
      queuePosition: queuePosition >= 0 ? queuePosition + 1 : null,
    };
  }

  /**
   * Force immediate sync of a wallet (high priority)
   */
  async syncNow(walletId: string): Promise<{
    success: boolean;
    addresses: number;
    transactions: number;
    utxos: number;
    error?: string;
  }> {
    // If already syncing, wait for completion
    if (this.activeSyncs.has(walletId)) {
      return {
        success: false,
        addresses: 0,
        transactions: 0,
        utxos: 0,
        error: 'Sync already in progress',
      };
    }

    return this.executeSyncJob(walletId);
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.syncQueue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.requestedAt.getTime() - b.requestedAt.getTime();
    });
  }

  /**
   * Process the sync queue
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    const { maxConcurrentSyncs } = getConfig().sync;
    while (this.syncQueue.length > 0 && this.activeSyncs.size < maxConcurrentSyncs) {
      const job = this.syncQueue.shift();
      if (!job) break;

      // Don't await - run concurrently
      this.executeSyncJob(job.walletId).catch(err => {
        log.error(`[SYNC] Failed to sync wallet ${job.walletId}`, { error: getErrorMessage(err) });
      });
    }
  }

  /**
   * Acquire a distributed lock for a wallet sync
   *
   * Uses Redis for distributed locking across multiple server instances.
   * Falls back to in-memory locks when Redis is unavailable.
   */
  private async acquireSyncLock(walletId: string): Promise<boolean> {
    // Quick check if we already have the lock locally
    if (this.activeSyncs.has(walletId)) {
      return false;
    }

    const syncConfig = getConfig().sync;
    // Lock TTL should be slightly longer than max sync duration to prevent premature expiration
    const lockTtlMs = syncConfig.maxSyncDurationMs + 60000; // +1 minute buffer

    // Try to acquire distributed lock
    const lock = await acquireLock(`sync:wallet:${walletId}`, {
      ttlMs: lockTtlMs,
      waitTimeMs: 0, // Don't wait - if locked, skip
    });

    if (!lock) {
      log.debug(`[SYNC] Could not acquire lock for wallet ${walletId} (already syncing)`);
      return false;
    }

    // Store lock for later release
    this.activeLocks.set(walletId, lock);
    this.activeSyncs.add(walletId);
    return true;
  }

  /**
   * Release a distributed wallet sync lock
   */
  private async releaseSyncLock(walletId: string): Promise<void> {
    const lock = this.activeLocks.get(walletId);
    if (lock) {
      await releaseLock(lock);
      this.activeLocks.delete(walletId);
    }
    this.activeSyncs.delete(walletId);
  }

  /**
   * Execute a sync job for a wallet with retry support
   */
  private async executeSyncJob(walletId: string, retryCount: number = 0): Promise<{
    success: boolean;
    addresses: number;
    transactions: number;
    utxos: number;
    error?: string;
  }> {
    // Try to acquire distributed lock - prevents race conditions across instances
    if (!await this.acquireSyncLock(walletId)) {
      return { success: false, addresses: 0, transactions: 0, utxos: 0, error: 'Already syncing' };
    }

    // Mark sync in progress
    await prisma.wallet.update({
      where: { id: walletId },
      data: { syncInProgress: true },
    });

    // Get retry config
    const syncConfig = getConfig().sync;

    // Notify sync starting via WebSocket
    const notificationService = getNotificationService();
    notificationService.broadcastSyncStatus(walletId, {
      inProgress: true,
      retryCount,
      maxRetries: syncConfig.maxRetryAttempts,
    });

    // Emit sync started event
    eventService.emitWalletSyncStarted(walletId, false);

    try {
      const startTime = Date.now();
      log.info(`[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${syncConfig.maxRetryAttempts})` : ''}`);
      walletLog(walletId, 'info', 'SYNC', retryCount > 0
        ? `Sync started (retry ${retryCount}/${syncConfig.maxRetryAttempts})`
        : 'Sync started');

      // Get previous balance for comparison
      const previousBalances = await this.getWalletBalance(walletId);
      const previousTotal = previousBalances.confirmed + previousBalances.unconfirmed;

      // Execute sync and keep lock ownership until the underlying promise settles.
      // Important: Promise.race timeouts do not cancel syncWallet(), which could otherwise
      // keep mutating DB after lock release and race with retries/other workers.
      const syncPromise = syncWallet(walletId);
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ timedOut: true }), syncConfig.maxSyncDurationMs);
      });

      let result: Awaited<ReturnType<typeof syncWallet>>;
      const raced = await Promise.race([
        syncPromise.then((value) => ({ timedOut: false as const, value })),
        timeoutPromise,
      ]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (raced.timedOut) {
        log.warn(
          `[SYNC] Wallet ${walletId} exceeded configured sync threshold (${syncConfig.maxSyncDurationMs / 1000}s); waiting for completion`
        );
        walletLog(
          walletId,
          'warn',
          'SYNC',
          `Sync is taking longer than expected (${Math.round(syncConfig.maxSyncDurationMs / 1000)}s), continuing...`
        );
        result = await syncPromise;
      } else {
        result = raced.value;
      }

      // Populate missing fields for any existing transactions
      walletLog(walletId, 'info', 'SYNC', 'Completing sync (populating transaction details)...');
      const populateResult = await populateMissingTransactionFields(walletId);
      if (populateResult.updated > 0) {
        log.info(`[SYNC] Populated missing fields for ${populateResult.updated} existing transactions`);
        walletLog(walletId, 'info', 'SYNC', `Populated details for ${populateResult.updated} transactions`);
      }

      // Get new balance (confirmed and unconfirmed)
      const newBalances = await this.getWalletBalance(walletId);
      const newTotal = newBalances.confirmed + newBalances.unconfirmed;

      // Update sync metadata
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: 'success',
          lastSyncError: null,
          syncInProgress: false,
        },
      });

      const duration = Date.now() - startTime;
      log.info(`[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`);
      walletLog(walletId, 'info', 'SYNC', `Sync complete (${result.transactions} transactions, ${result.utxos} UTXOs)`);

      // Record sync metrics
      walletSyncsTotal.inc({ status: 'success' });
      walletSyncDuration.observe({ walletType: 'all' }, duration / 1000);

      // Emit wallet synced event (handles both event bus and WebSocket)
      eventService.emitWalletSynced({
        walletId,
        balance: BigInt(newBalances.confirmed),
        unconfirmedBalance: BigInt(newBalances.unconfirmed),
        transactionCount: result.transactions,
        duration,
      });

      // Always notify sync completion via WebSocket
      notificationService.broadcastSyncStatus(walletId, {
        inProgress: false,
        status: 'success',
        lastSyncedAt: new Date(),
      });

      // Notify via WebSocket if balance changed (confirmed or unconfirmed)
      if (newTotal !== previousTotal || newBalances.unconfirmed !== previousBalances.unconfirmed) {
        notificationService.broadcastBalanceUpdate({
          walletId,
          balance: newBalances.confirmed,
          unconfirmed: newBalances.unconfirmed,
          previousBalance: previousBalances.confirmed,
          change: newBalances.confirmed - previousBalances.confirmed,
        });
      }

      // Continue processing queue
      this.processQueue();

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error');
      log.error(`[SYNC] Sync failed for wallet ${walletId}:`, { error: errorMessage });

      // Check if we should retry
      if (retryCount < syncConfig.maxRetryAttempts) {
        const nextRetry = retryCount + 1;
        const delayMs = syncConfig.retryDelaysMs[retryCount] || syncConfig.retryDelaysMs[syncConfig.retryDelaysMs.length - 1];

        log.info(`[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${syncConfig.maxRetryAttempts})`);
        walletLog(walletId, 'warn', 'SYNC', `Sync failed: ${errorMessage}. Retrying in ${delayMs / 1000}s...`, {
          attempt: nextRetry,
          maxAttempts: syncConfig.maxRetryAttempts,
        });

        // Notify that we're retrying
        notificationService.broadcastSyncStatus(walletId, {
          inProgress: true,
          status: 'retrying',
          error: errorMessage,
          retryCount: nextRetry,
          maxRetries: syncConfig.maxRetryAttempts,
          retryingIn: delayMs,
        });

        // Update DB to show retrying state
        await prisma.wallet.update({
          where: { id: walletId },
          data: {
            lastSyncStatus: 'retrying',
            lastSyncError: `${errorMessage} (retrying ${nextRetry}/${syncConfig.maxRetryAttempts})`,
            syncInProgress: false, // Will be set to true when retry starts
          },
        });

        // Release distributed lock so retry can acquire it fresh
        await this.releaseSyncLock(walletId);

        // Schedule retry with delay (track timer for cleanup on shutdown)
        const retryTimer = setTimeout(() => {
          this.pendingRetries.delete(walletId);
          this.executeSyncJob(walletId, nextRetry).catch(err => {
            log.error(`[SYNC] Retry failed for wallet ${walletId}`, { error: getErrorMessage(err) });
          });
        }, delayMs);
        this.pendingRetries.set(walletId, retryTimer);

        return {
          success: false,
          addresses: 0,
          transactions: 0,
          utxos: 0,
          error: `${errorMessage} - retrying...`,
        };
      }

      // All retries exhausted - final failure
      log.error(`[SYNC] All retries exhausted for wallet ${walletId}`);
      walletLog(walletId, 'error', 'SYNC', `Sync failed after ${syncConfig.maxRetryAttempts} attempts: ${errorMessage}`);

      // Record sync failure metric
      walletSyncsTotal.inc({ status: 'failure' });

      // Record in dead letter queue for visibility
      await recordSyncFailure(walletId, errorMessage, syncConfig.maxRetryAttempts, {
        lastError: errorMessage,
      });

      // Emit sync failed event
      eventService.emitWalletSyncFailed(walletId, errorMessage, syncConfig.maxRetryAttempts);

      // Update sync metadata with final error
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          lastSyncStatus: 'failed',
          lastSyncError: errorMessage,
          syncInProgress: false,
        },
      });

      // Notify sync failure via WebSocket
      notificationService.broadcastSyncStatus(walletId, {
        inProgress: false,
        status: 'failed',
        error: errorMessage,
        retriesExhausted: true,
      });

      // Continue processing queue
      this.processQueue();

      return {
        success: false,
        addresses: 0,
        transactions: 0,
        utxos: 0,
        error: errorMessage,
      };
    } finally {
      await this.releaseSyncLock(walletId);
    }
  }

  /**
   * Get wallet balance from UTXOs, separated into confirmed and unconfirmed
   */
  private async getWalletBalance(walletId: string): Promise<{ confirmed: number; unconfirmed: number }> {
    const [confirmedResult, unconfirmedResult] = await Promise.all([
      // Confirmed: UTXOs with a block height
      prisma.uTXO.aggregate({
        where: {
          walletId,
          spent: false,
          blockHeight: { not: null },
        },
        _sum: {
          amount: true,
        },
      }),
      // Unconfirmed: UTXOs without a block height (still in mempool)
      prisma.uTXO.aggregate({
        where: {
          walletId,
          spent: false,
          blockHeight: null,
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    return {
      confirmed: Number(confirmedResult._sum.amount || 0),
      unconfirmed: Number(unconfirmedResult._sum.amount || 0),
    };
  }

  /**
   * Check for stale wallets and queue them for sync.
   * Also auto-unstuck wallets that have syncInProgress=true but aren't actually syncing.
   */
  private async checkAndQueueStaleSyncs(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // First, check for stuck syncs - wallets marked as syncing in DB but not in memory
      // This can happen if sync times out or crashes without proper cleanup
      const stuckWallets = await prisma.wallet.findMany({
        where: {
          syncInProgress: true,
        },
        select: { id: true, name: true },
      });

      // Reset any wallet that's marked as syncing but isn't actually syncing
      let unstuckCount = 0;
      for (const wallet of stuckWallets) {
        if (!this.activeSyncs.has(wallet.id)) {
          log.warn(`[SYNC] Auto-unstuck wallet ${wallet.name || wallet.id} (was stuck with syncInProgress=true)`);
          await prisma.wallet.update({
            where: { id: wallet.id },
            data: { syncInProgress: false },
          });
          unstuckCount++;
        }
      }

      if (unstuckCount > 0) {
        log.info(`[SYNC] Auto-unstuck ${unstuckCount} wallets that had stale syncInProgress flags`);
      }

      // Now check for stale wallets that need syncing
      const { staleThresholdMs } = getConfig().sync;
      const staleWallets = await prisma.wallet.findMany({
        where: {
          OR: [
            { lastSyncedAt: null },
            { lastSyncedAt: { lt: new Date(Date.now() - staleThresholdMs) } },
          ],
          syncInProgress: false,
        },
        select: { id: true },
      });

      for (const wallet of staleWallets) {
        this.queueSync(wallet.id, 'low');
      }

      if (staleWallets.length > 0) {
        log.info(`[SYNC] Queued ${staleWallets.length} stale wallets for background sync`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to check for stale syncs', { error: getErrorMessage(error) });
    }
  }

  /**
   * Update confirmations for all wallets with pending transactions
   */
  private async updateAllConfirmations(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all wallets with pending transactions
      const walletsWithPending = await prisma.transaction.findMany({
        where: {
          confirmations: { lt: 6 },
        },
        select: {
          walletId: true,
        },
        distinct: ['walletId'],
      });

      let totalUpdated = 0;

      for (const { walletId } of walletsWithPending) {
        try {
          // First, try to populate missing blockHeight for transactions that were discovered in mempool
          // This handles servers like Blockstream that don't support verbose transaction responses
          const populateResult = await populateMissingTransactionFields(walletId);
          if (populateResult.updated > 0) {
            log.debug(`[SYNC] Populated missing fields for ${populateResult.updated} transactions in wallet ${walletId}`);
          }

          // updateTransactionConfirmations now returns detailed info about changes
          const updates = await updateTransactionConfirmations(walletId);
          totalUpdated += updates.length + populateResult.updated;

          // Combine confirmation updates from both sources
          const allConfirmationUpdates = [...populateResult.confirmationUpdates, ...updates];

          // Notify frontend of updates - only broadcast transactions that actually changed
          if (allConfirmationUpdates.length > 0) {
            const notificationService = getNotificationService();

            for (const update of allConfirmationUpdates) {
              // Emit confirmation event to event bus
              // Note: blockHeight not available in ConfirmationUpdate, use 0 as placeholder
              eventService.emitTransactionConfirmed({
                walletId,
                txid: update.txid,
                confirmations: update.newConfirmations,
                blockHeight: 0,
                previousConfirmations: update.oldConfirmations,
              });

              // Broadcast with milestone info so frontend knows if this is first confirmation
              notificationService.broadcastConfirmationUpdate(walletId, {
                txid: update.txid,
                confirmations: update.newConfirmations,
                previousConfirmations: update.oldConfirmations,
              });
            }
          }
        } catch (error) {
          log.error(`[SYNC] Failed to update confirmations for wallet ${walletId}`, { error: getErrorMessage(error) });
        }
      }

      if (totalUpdated > 0) {
        log.info(`[SYNC] Updated ${totalUpdated} transaction confirmations`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to update confirmations', { error: getErrorMessage(error) });
    }
  }

  /**
   * Subscribe to Electrum address notifications for a wallet
   * This enables real-time updates when transactions are received
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    // Get wallet to determine network
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { network: true }
    });
    const network = (wallet?.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

    const addresses = await prisma.address.findMany({
      where: { walletId },
      select: { address: true },
    });

    const client = await getNodeClient(network);

    for (const { address } of addresses) {
      try {
        // Subscribe to address - Electrum/RPC will notify on changes (if supported)
        await client.subscribeAddress(address);
      } catch (error) {
        log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: getErrorMessage(error) });
      }
    }

    log.info(`[SYNC] Subscribed to ${addresses.length} addresses for wallet ${walletId}`);
  }
}

// Export singleton instance
export const getSyncService = (): SyncService => SyncService.getInstance();

// Export for use in server startup
export default SyncService;
