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
import { syncWallet, syncAddress, updateTransactionConfirmations, getBlockHeight, populateMissingTransactionFields } from './bitcoin/blockchain';
import { getNodeClient } from './bitcoin/nodeClient';
import { getNotificationService } from '../websocket/notifications';

// Sync configuration
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for full sync check
const CONFIRMATION_UPDATE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes for confirmation updates
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // Consider wallet stale if not synced in 10 minutes
const MAX_CONCURRENT_SYNCS = 3;

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5000, 15000, 45000]; // Exponential backoff: 5s, 15s, 45s

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
  private syncInterval: NodeJS.Timeout | null = null;
  private confirmationInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

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
      console.log('[SYNC] Service already running');
      return;
    }

    console.log('[SYNC] Starting background sync service...');
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

    console.log('[SYNC] Background sync service started');
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
        console.log(`[SYNC] Reset ${result.count} stuck sync flags from previous session`);
      }
    } catch (error) {
      console.error('[SYNC] Failed to reset stuck sync flags:', error);
    }
  }

  /**
   * Stop the background sync service
   */
  stop(): void {
    console.log('[SYNC] Stopping background sync service...');
    this.isRunning = false;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.confirmationInterval) {
      clearInterval(this.confirmationInterval);
      this.confirmationInterval = null;
    }

    console.log('[SYNC] Background sync service stopped');
  }

  /**
   * Queue a wallet for sync
   */
  queueSync(walletId: string, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    // Don't queue if already in queue or actively syncing
    if (this.activeSyncs.has(walletId)) {
      console.log(`[SYNC] Wallet ${walletId} already syncing, skipping queue`);
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
    console.log(`[SYNC] Queued wallet ${walletId} with ${priority} priority`);

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

    console.log(`[SYNC] Queued ${wallets.length} wallets for user ${userId}`);
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
        console.error(`[SYNC] Failed to sync wallet ${job.walletId}:`, err);
      });
    }
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
    if (this.activeSyncs.has(walletId)) {
      return { success: false, addresses: 0, transactions: 0, utxos: 0, error: 'Already syncing' };
    }

    this.activeSyncs.add(walletId);

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
      console.log(`[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRY_ATTEMPTS})` : ''}`);

      // Get previous balance for comparison
      const previousBalance = await this.getWalletBalance(walletId);

      // Execute the sync
      const result = await syncWallet(walletId);

      // Populate missing fields for any existing transactions
      const populatedCount = await populateMissingTransactionFields(walletId);
      if (populatedCount > 0) {
        console.log(`[SYNC] Populated missing fields for ${populatedCount} existing transactions`);
      }

      // Get new balance
      const newBalance = await this.getWalletBalance(walletId);

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

      console.log(`[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`);

      // Always notify sync completion via WebSocket
      notificationService.broadcastSyncStatus(walletId, {
        inProgress: false,
        status: 'success',
        lastSyncedAt: new Date(),
      });

      // Notify via WebSocket if balance changed
      if (newBalance !== previousBalance) {
        notificationService.broadcastBalanceUpdate({
          walletId,
          balance: newBalance,
          unconfirmed: 0, // TODO: Calculate unconfirmed
          previousBalance,
          change: newBalance - previousBalance,
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
      console.error(`[SYNC] Sync failed for wallet ${walletId}:`, errorMessage);

      // Check if we should retry
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        const nextRetry = retryCount + 1;
        const delayMs = RETRY_DELAYS_MS[retryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

        console.log(`[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${MAX_RETRY_ATTEMPTS})`);

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

        // Remove from active syncs so retry can start
        this.activeSyncs.delete(walletId);

        // Schedule retry with delay
        setTimeout(() => {
          this.executeSyncJob(walletId, nextRetry).catch(err => {
            console.error(`[SYNC] Retry failed for wallet ${walletId}:`, err);
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
      console.error(`[SYNC] All retries exhausted for wallet ${walletId}`);

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
      this.activeSyncs.delete(walletId);
    }
  }

  /**
   * Get wallet balance from UTXOs
   */
  private async getWalletBalance(walletId: string): Promise<number> {
    const result = await prisma.uTXO.aggregate({
      where: {
        walletId,
        spent: false,
      },
      _sum: {
        amount: true,
      },
    });

    return Number(result._sum.amount || 0);
  }

  /**
   * Check for stale wallets and queue them for sync
   */
  private async checkAndQueueStaleSyncs(): Promise<void> {
    if (!this.isRunning) return;

    try {
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
        console.log(`[SYNC] Queued ${staleWallets.length} stale wallets for background sync`);
      }
    } catch (error) {
      console.error('[SYNC] Failed to check for stale syncs:', error);
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
          const updated = await updateTransactionConfirmations(walletId);
          totalUpdated += updated;

          // Notify frontend of updates
          if (updated > 0) {
            const notificationService = getNotificationService();
            // Get the updated transactions to send specific notifications
            const updatedTxs = await prisma.transaction.findMany({
              where: {
                walletId,
                confirmations: { gte: 1, lte: 6 },
              },
              select: {
                txid: true,
                confirmations: true,
              },
            });

            for (const tx of updatedTxs) {
              notificationService.broadcastConfirmationUpdate(walletId, {
                txid: tx.txid,
                confirmations: tx.confirmations,
              });
            }
          }
        } catch (error) {
          console.error(`[SYNC] Failed to update confirmations for wallet ${walletId}:`, error);
        }
      }

      if (totalUpdated > 0) {
        console.log(`[SYNC] Updated ${totalUpdated} transaction confirmations`);
      }
    } catch (error) {
      console.error('[SYNC] Failed to update confirmations:', error);
    }
  }

  /**
   * Subscribe to Electrum address notifications for a wallet
   * This enables real-time updates when transactions are received
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    const addresses = await prisma.address.findMany({
      where: { walletId },
      select: { address: true },
    });

    const client = await getNodeClient();

    for (const { address } of addresses) {
      try {
        // Subscribe to address - Electrum/RPC will notify on changes (if supported)
        await client.subscribeAddress(address);
      } catch (error) {
        console.error(`[SYNC] Failed to subscribe to address ${address}:`, error);
      }
    }

    console.log(`[SYNC] Subscribed to ${addresses.length} addresses for wallet ${walletId}`);
  }
}

// Export singleton instance
export const getSyncService = (): SyncService => SyncService.getInstance();

// Export for use in server startup
export default SyncService;
