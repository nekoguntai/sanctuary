/**
 * Notification Service
 *
 * Manages real-time notifications for blockchain events.
 * Integrates with Electrum for transaction/block updates
 * and broadcasts events via WebSocket.
 *
 * Delegates to focused modules:
 * - broadcasts.ts: WebSocket broadcast methods per event type
 * - subscriptions.ts: Electrum address/wallet subscription handling
 */

import { createLogger } from '../../utils/logger';
import {
  broadcastTransactionNotification,
  broadcastBalanceUpdate,
  broadcastBlockNotification,
  broadcastNewBlock,
  broadcastMempoolNotification,
  broadcastModelDownloadProgress,
  broadcastConfirmationUpdate,
  broadcastSyncStatus,
  broadcastWalletLog,
} from './broadcasts';
import {
  subscribeToBlocks,
  subscribeToAddress,
  subscribeWallet,
  unsubscribeWalletAddresses,
  handleAddressUpdate,
  handleTransaction,
  checkConfirmationUpdate,
  handleBalanceUpdate,
} from './subscriptions';
import type {
  TransactionNotification,
  BalanceUpdate,
  BlockNotification,
  MempoolNotification,
  ModelDownloadProgress,
  WalletLogEntry,
  SyncStatusUpdate,
  ConfirmationUpdate,
  LogLevel,
} from './types';

const log = createLogger('NOTIFY');

export class NotificationService {
  private subscribedAddresses: Set<string> = new Set();
  private isRunning: boolean = false;

  /**
   * Start the notification service
   */
  async start() {
    if (this.isRunning) {
      log.debug('Notification service already running');
      return;
    }

    this.isRunning = true;
    log.debug('Starting notification service...');

    // Subscribe to Electrum blockchain headers for new blocks
    await subscribeToBlocks();

    log.debug('Notification service started');
  }

  /**
   * Stop the notification service
   */
  stop() {
    this.isRunning = false;
    log.debug('Notification service stopped');
  }

  /**
   * Unsubscribe all addresses for a wallet (call when wallet is deleted)
   * Prevents memory leak by cleaning up the subscribedAddresses set
   */
  async unsubscribeWalletAddresses(walletId: string): Promise<void> {
    await unsubscribeWalletAddresses(walletId, this.subscribedAddresses);
  }

  /**
   * Subscribe to address updates
   */
  async subscribeToAddress(address: string, walletId: string) {
    await subscribeToAddress(address, walletId, this.subscribedAddresses);
  }

  /**
   * Subscribe wallet to real-time updates
   */
  async subscribeWallet(walletId: string) {
    await subscribeWallet(walletId, this.subscribedAddresses);
  }

  /**
   * Subscribe to new blocks with retry logic
   * Delegated to subscriptions module
   */
  private async subscribeToBlocks(maxRetries?: number, delayMs?: number) {
    await subscribeToBlocks(maxRetries, delayMs);
  }

  /**
   * Handle address status update from Electrum
   * Delegated to subscriptions module
   */
  private async handleAddressUpdate(address: string, walletId: string) {
    await handleAddressUpdate(address, walletId);
  }

  /**
   * Handle new/updated transaction
   * Delegated to subscriptions module
   */
  private async handleTransaction(txid: string, walletId: string, address: string) {
    await handleTransaction(txid, walletId, address);
  }

  /**
   * Check for confirmation updates on a transaction
   * Delegated to subscriptions module
   */
  private async checkConfirmationUpdate(txid: string, walletId: string) {
    await checkConfirmationUpdate(txid, walletId);
  }

  /**
   * Handle balance update from Electrum
   * Delegated to subscriptions module
   */
  private async handleBalanceUpdate(walletId: string, balance: { confirmed: number; unconfirmed: number }) {
    await handleBalanceUpdate(walletId, balance);
  }

  /**
   * Broadcast transaction notification
   */
  public broadcastTransactionNotification(notification: TransactionNotification) {
    broadcastTransactionNotification(notification);
  }

  /**
   * Broadcast balance update
   */
  public broadcastBalanceUpdate(update: BalanceUpdate) {
    broadcastBalanceUpdate(update);
  }

  /**
   * Broadcast new block notification (full details)
   */
  public broadcastBlockNotification(notification: BlockNotification) {
    broadcastBlockNotification(notification);
  }

  /**
   * Broadcast new block notification (minimal - just height)
   * Used by real-time Electrum subscription
   */
  public broadcastNewBlock(block: { height: number }) {
    broadcastNewBlock(block);
  }

  /**
   * Broadcast mempool notification
   */
  public broadcastMempoolNotification(notification: MempoolNotification) {
    broadcastMempoolNotification(notification);
  }

  /**
   * Broadcast model download progress
   * Used for real-time UI updates during Ollama model pulls
   */
  public broadcastModelDownloadProgress(progress: ModelDownloadProgress) {
    broadcastModelDownloadProgress(progress);
  }

  /**
   * Broadcast confirmation update for a transaction
   * Includes previousConfirmations so frontend can detect milestone transitions (e.g., 0->1)
   */
  public broadcastConfirmationUpdate(walletId: string, update: ConfirmationUpdate) {
    broadcastConfirmationUpdate(walletId, update);
  }

  /**
   * Broadcast sync status update for a wallet
   */
  public broadcastSyncStatus(walletId: string, status: SyncStatusUpdate) {
    broadcastSyncStatus(walletId, status);
  }

  /**
   * Broadcast wallet log entry for real-time sync logging
   * Also stores the entry in the log buffer for later retrieval
   */
  public broadcastWalletLog(walletId: string, entry: Omit<WalletLogEntry, 'id' | 'timestamp'>) {
    broadcastWalletLog(walletId, entry);
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export getter function for use in other services
export const getNotificationService = (): NotificationService => notificationService;

/**
 * Helper function to send a log entry to the frontend via WebSocket for a specific wallet
 * Convenience wrapper around notificationService.broadcastWalletLog
 */
export function walletLog(
  walletId: string,
  level: LogLevel,
  module: string,
  message: string,
  details?: Record<string, unknown>
): void {
  notificationService.broadcastWalletLog(walletId, {
    level,
    module,
    message,
    details,
  });
}
