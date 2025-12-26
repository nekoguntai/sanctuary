/**
 * Background Sync Service
 *
 * Manages wallet synchronization with the blockchain.
 * - Queues sync jobs for wallets
 * - Runs periodic background sync
 * - Updates confirmations for pending transactions
 * - Notifies frontend via WebSocket when data changes
 */

import prisma from '../models/prisma';
import { syncWallet, syncAddress, updateTransactionConfirmations, getBlockHeight, populateMissingTransactionFields, setCachedBlockHeight } from './bitcoin/blockchain';
import { getNodeClient, getElectrumClientIfActive } from './bitcoin/nodeClient';
import { getNotificationService, walletLog } from '../websocket/notifications';
import { createLogger } from '../utils/logger';
import { ElectrumClient } from './bitcoin/electrum';

const log = createLogger('SYNC');

// Sync configuration
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for full sync check
const CONFIRMATION_UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes for confirmation updates
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // Consider wallet stale if not synced in 10 minutes
const MAX_CONCURRENT_SYNCS = 3;

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000, 45000]; // Exponential backoff: 5s, 15s, 45s
// NOTE: No overall sync timeout - sync continues as long as progress is being made
// Individual operations (like transaction fetching) may have their own timeouts

interface SyncJob {
  walletId: string;
  priority: 'high' | 'normal' | 'low';
  requestedAt: Date;
  retryCount?: number;
  lastError?: string;
}

class SyncService {
  private static instance: SyncService;
  private syncQueue: SyncJob[] = [];
  private activeSyncs: Set<string> = new Set();
  // Promise-based locks to prevent race conditions between concurrent sync requests
  private syncLocks: Map<string, Promise<void>> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private confirmationInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private subscribedToHeaders = false;
  // Track which addresses belong to which wallets for real-time notifications
  private addressToWalletMap: Map<string, string> = new Map();

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

    // Start periodic sync check
    this.syncInterval = setInterval(() => {
      this.checkAndQueueStaleSyncs();
    }, SYNC_INTERVAL_MS);

    // Start periodic confirmation updates
    this.confirmationInterval = setInterval(() => {
      this.updateAllConfirmations();
    }, CONFIRMATION_UPDATE_INTERVAL_MS);

    // Process any existing queue
    this.processQueue();

    // Set up real-time subscriptions (async, don't block startup)
    this.setupRealTimeSubscriptions().catch(err => {
      log.error('[SYNC] Failed to set up real-time subscriptions', { error: String(err) });
    });

    log.info('[SYNC] Background sync service started');
  }

  /**
   * Set up real-time subscriptions for block and address notifications
   */
  private async setupRealTimeSubscriptions(): Promise<void> {
    try {
      // Get the node client to ensure it's connected
      const client = await getNodeClient();

      // Only Electrum supports real-time subscriptions
      const electrumClient = await getElectrumClientIfActive();
      if (!electrumClient) {
        log.info('[SYNC] Real-time subscriptions only available with Electrum (current node type does not support it)');
        return;
      }

      // Negotiate protocol version first (required by some servers like Blockstream)
      try {
        const version = await electrumClient.getServerVersion();
        log.info(`[SYNC] Connected to Electrum server: ${version.server} (protocol ${version.protocol})`);
      } catch (versionError) {
        log.warn('[SYNC] Could not get server version, continuing anyway', { error: String(versionError) });
      }

      // Subscribe to new block headers
      if (!this.subscribedToHeaders) {
        const currentHeader = await electrumClient.subscribeHeaders();
        this.subscribedToHeaders = true;
        log.info(`[SYNC] Subscribed to block headers, current height: ${currentHeader.height}`);

        // Cache the current block height for fast confirmation calculations
        setCachedBlockHeight(currentHeader.height);

        // Listen for new blocks
        electrumClient.on('newBlock', this.handleNewBlock.bind(this));

        // Listen for address activity
        electrumClient.on('addressActivity', this.handleAddressActivity.bind(this));
      }

      // Subscribe to all wallet addresses
      await this.subscribeAllWalletAddresses();

      log.info('[SYNC] Real-time subscriptions active');
    } catch (error) {
      log.error('[SYNC] Failed to set up real-time subscriptions', { error: String(error) });
    }
  }

  /**
   * Subscribe to all addresses from all wallets for real-time notifications
   * Uses batch subscription for efficiency (single RPC call vs N calls)
   */
  private async subscribeAllWalletAddresses(): Promise<void> {
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
      log.error('[SYNC] Batch subscription failed, falling back to individual subscriptions', { error: String(error) });

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
          log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: String(err) });
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
  } {
    return {
      isRunning: this.isRunning,
      queueLength: this.syncQueue.length,
      activeSyncs: this.activeSyncs.size,
      subscribedAddresses: this.addressToWalletMap.size,
    };
  }

  /**
   * Handle new block notification - immediately update confirmations
   */
  private async handleNewBlock(block: { height: number; hex: string }): Promise<void> {
    log.info(`[SYNC] New block received at height ${block.height}`);

    // Update cached block height immediately for fast confirmation calculations
    setCachedBlockHeight(block.height);

    // Immediately update confirmations for all pending transactions
    try {
      await this.updateAllConfirmations();

      // Notify frontend of new block
      const notificationService = getNotificationService();
      notificationService.broadcastNewBlock({
        height: block.height,
      });
    } catch (error) {
      log.error('[SYNC] Failed to update confirmations after new block', { error: String(error) });
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
      log.error('[SYNC] Failed to reset stuck sync flags', { error: String(error) });
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

    // Clean up real-time subscriptions
    this.subscribedToHeaders = false;
    this.addressToWalletMap.clear();

    // Remove event listeners from Electrum client
    const electrumClient = await getElectrumClientIfActive();
    if (electrumClient) {
      electrumClient.removeAllListeners('newBlock');
      electrumClient.removeAllListeners('addressActivity');
    }

    log.info('[SYNC] Background sync service stopped');
  }

  /**
   * Subscribe to new addresses for a wallet (called when wallet is created/imported)
   */
  async subscribeNewWalletAddresses(walletId: string): Promise<void> {
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
        log.error(`[SYNC] Failed to subscribe to new address ${address}`, { error: String(error) });
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

    this.syncQueue.push({
      walletId,
      priority,
      requestedAt: new Date(),
    });

    this.sortQueue();
    log.info(`[SYNC] Queued wallet ${walletId} with ${priority} priority`);

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
    const isStale = !wallet.lastSyncedAt ||
      (Date.now() - wallet.lastSyncedAt.getTime()) > STALE_THRESHOLD_MS;

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

    while (this.syncQueue.length > 0 && this.activeSyncs.size < MAX_CONCURRENT_SYNCS) {
      const job = this.syncQueue.shift();
      if (!job) break;

      // Don't await - run concurrently
      this.executeSyncJob(job.walletId).catch(err => {
        log.error(`[SYNC] Failed to sync wallet ${job.walletId}`, { error: String(err) });
      });
    }
  }

  /**
   * Acquire a lock for a wallet sync to prevent race conditions
   */
  private async acquireSyncLock(walletId: string): Promise<boolean> {
    // If there's an existing lock, wait for it to complete
    const existingLock = this.syncLocks.get(walletId);
    if (existingLock) {
      try {
        await existingLock;
      } catch {
        // Ignore errors from previous sync
      }
    }

    // Check again after waiting (another request may have just started)
    if (this.activeSyncs.has(walletId)) {
      return false;
    }

    // Acquire the lock
    this.activeSyncs.add(walletId);
    return true;
  }

  /**
   * Release a wallet sync lock
   */
  private releaseSyncLock(walletId: string): void {
    this.activeSyncs.delete(walletId);
    this.syncLocks.delete(walletId);
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
    // Try to acquire lock - prevents race conditions
    if (!await this.acquireSyncLock(walletId)) {
      return { success: false, addresses: 0, transactions: 0, utxos: 0, error: 'Already syncing' };
    }

    // Create a promise that will be resolved when sync completes
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => { resolveLock = resolve; });
    this.syncLocks.set(walletId, lockPromise);

    // Mark sync in progress
    await prisma.wallet.update({
      where: { id: walletId },
      data: { syncInProgress: true },
    });

    // Notify sync starting via WebSocket
    const notificationService = getNotificationService();
    notificationService.broadcastSyncStatus(walletId, {
      inProgress: true,
      retryCount,
      maxRetries: MAX_RETRY_ATTEMPTS,
    });

    try {
      const startTime = Date.now();
      log.info(`[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRY_ATTEMPTS})` : ''}`);
      walletLog(walletId, 'info', 'SYNC', retryCount > 0
        ? `Sync started (retry ${retryCount}/${MAX_RETRY_ATTEMPTS})`
        : 'Sync started');

      // Get previous balance for comparison
      const previousBalances = await this.getWalletBalance(walletId);
      const previousTotal = previousBalances.confirmed + previousBalances.unconfirmed;

      // Execute the sync - no overall timeout since sync writes incrementally
      // and continues as long as progress is being made
      const result = await syncWallet(walletId);

      // Populate missing fields for any existing transactions
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

      log.info(`[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`);

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
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      log.error(`[SYNC] Sync failed for wallet ${walletId}:`, errorMessage);

      // Check if we should retry
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        const nextRetry = retryCount + 1;
        const delayMs = RETRY_DELAYS_MS[retryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

        log.info(`[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${MAX_RETRY_ATTEMPTS})`);
        walletLog(walletId, 'warn', 'SYNC', `Sync failed: ${errorMessage}. Retrying in ${delayMs / 1000}s...`, {
          attempt: nextRetry,
          maxAttempts: MAX_RETRY_ATTEMPTS,
        });

        // Notify that we're retrying
        notificationService.broadcastSyncStatus(walletId, {
          inProgress: true,
          status: 'retrying',
          error: errorMessage,
          retryCount: nextRetry,
          maxRetries: MAX_RETRY_ATTEMPTS,
          retryingIn: delayMs,
        });

        // Update DB to show retrying state
        await prisma.wallet.update({
          where: { id: walletId },
          data: {
            lastSyncStatus: 'retrying',
            lastSyncError: `${errorMessage} (retrying ${nextRetry}/${MAX_RETRY_ATTEMPTS})`,
            syncInProgress: false, // Will be set to true when retry starts
          },
        });

        // Remove from active syncs and release lock so retry can start
        this.releaseSyncLock(walletId);
        resolveLock!();

        // Schedule retry with delay
        setTimeout(() => {
          this.executeSyncJob(walletId, nextRetry).catch(err => {
            log.error(`[SYNC] Retry failed for wallet ${walletId}`, { error: String(err) });
          });
        }, delayMs);

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
      walletLog(walletId, 'error', 'SYNC', `Sync failed after ${MAX_RETRY_ATTEMPTS} attempts: ${errorMessage}`);

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
      this.releaseSyncLock(walletId);
      resolveLock!();
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
      const staleWallets = await prisma.wallet.findMany({
        where: {
          OR: [
            { lastSyncedAt: null },
            { lastSyncedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) } },
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
      log.error('[SYNC] Failed to check for stale syncs', { error: String(error) });
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
              // Broadcast with milestone info so frontend knows if this is first confirmation
              notificationService.broadcastConfirmationUpdate(walletId, {
                txid: update.txid,
                confirmations: update.newConfirmations,
                previousConfirmations: update.oldConfirmations,
              });
            }
          }
        } catch (error) {
          log.error(`[SYNC] Failed to update confirmations for wallet ${walletId}`, { error: String(error) });
        }
      }

      if (totalUpdated > 0) {
        log.info(`[SYNC] Updated ${totalUpdated} transaction confirmations`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to update confirmations', { error: String(error) });
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
        log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: String(error) });
      }
    }

    log.info(`[SYNC] Subscribed to ${addresses.length} addresses for wallet ${walletId}`);
  }
}

// Export singleton instance
export const getSyncService = (): SyncService => SyncService.getInstance();

// Export for use in server startup
export default SyncService;
