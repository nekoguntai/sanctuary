/**
 * Notification Service
 *
 * Manages real-time notifications for blockchain events
 * Integrates with Electrum for transaction/block updates
 * Broadcasts events via WebSocket
 */

import { getWebSocketServer, WebSocketEvent } from './server';
import { getElectrumClient } from '../services/bitcoin/electrum';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('NOTIFY');

export interface TransactionNotification {
  txid: string;
  walletId: string;
  type: 'received' | 'sent';
  amount: number; // satoshis
  confirmations: number;
  blockHeight?: number;
  timestamp: Date;
}

export interface BalanceUpdate {
  walletId: string;
  balance: number; // satoshis
  unconfirmed: number; // satoshis
  previousBalance: number;
  change: number;
}

export interface BlockNotification {
  height: number;
  hash: string;
  timestamp: Date;
  transactionCount: number;
}

export interface MempoolNotification {
  txid: string;
  fee: number; // satoshis
  size: number; // bytes
  feeRate: number; // sat/vB
}

// Wallet Log Types for real-time sync logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WalletLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, any>;
}

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
    await this.subscribeToBlocks();

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
    try {
      // Get all addresses for this wallet from the database
      const addresses = await prisma.address.findMany({
        where: { walletId },
        select: { address: true },
      });

      let unsubscribed = 0;
      for (const { address } of addresses) {
        if (this.subscribedAddresses.has(address)) {
          this.subscribedAddresses.delete(address);
          unsubscribed++;
        }
      }

      if (unsubscribed > 0) {
        log.debug(`[NOTIFY] Unsubscribed ${unsubscribed} addresses for wallet ${walletId}`);
      }
    } catch (error) {
      log.warn('[NOTIFY] Failed to unsubscribe wallet addresses', { walletId, error: String(error) });
    }
  }

  /**
   * Subscribe to new blocks
   */
  private async subscribeToBlocks() {
    try {
      // In production, this would subscribe to Electrum's blockchain.headers.subscribe
      // For demo, we'll simulate periodic block checks
      log.debug('Subscribed to blockchain headers');
    } catch (err) {
      log.error('Failed to subscribe to blocks', { error: String(err) });
    }
  }

  /**
   * Subscribe to address updates
   */
  async subscribeToAddress(address: string, walletId: string) {
    if (this.subscribedAddresses.has(address)) {
      return;
    }

    try {
      // Subscribe to address via Electrum
      const electrumClient = await getElectrumClient();
      await electrumClient.subscribeAddress(address);

      this.subscribedAddresses.add(address);
      log.debug(`Subscribed to address updates: ${address}`);

      // Note: Electrum subscriptions work via the persistent connection
      // Status changes are received via the socket and would need to be
      // handled separately in the electrum client event handlers
    } catch (err) {
      log.error(`Failed to subscribe to address ${address}`, { error: String(err) });
    }
  }

  /**
   * Handle address status update
   */
  private async handleAddressUpdate(address: string, walletId: string) {
    try {
      // Get address from database
      const addressRecord = await prisma.address.findFirst({
        where: { address },
        include: { wallet: true },
      });

      if (!addressRecord) {
        log.warn(`Address ${address} not found in database`);
        return;
      }

      // Fetch transaction history from Electrum
      const electrumClient = await getElectrumClient();
      const history = await electrumClient.getAddressHistory(address);

      // Check for new transactions
      for (const tx of history) {
        await this.handleTransaction(tx.tx_hash, addressRecord.wallet.id, address);
      }

      // Update balance
      const balance = await electrumClient.getAddressBalance(address);
      await this.handleBalanceUpdate(addressRecord.wallet.id, balance);
    } catch (err) {
      log.error('Failed to handle address update', { error: String(err) });
    }
  }

  /**
   * Handle new/updated transaction
   */
  private async handleTransaction(txid: string, walletId: string, address: string) {
    try {
      // Check if transaction already exists
      const existing = await prisma.transaction.findFirst({
        where: { txid },
      });

      if (existing) {
        // Check for confirmation updates
        await this.checkConfirmationUpdate(txid, walletId);
        return;
      }

      // New transaction - broadcast notification
      const notification: TransactionNotification = {
        txid,
        walletId,
        type: 'received', // Determine from transaction details
        amount: 0, // Parse from transaction
        confirmations: 0,
        timestamp: new Date(),
      };

      this.broadcastTransactionNotification(notification);
    } catch (err) {
      log.error('Failed to handle transaction', { error: String(err) });
    }
  }

  /**
   * Check for confirmation updates
   */
  private async checkConfirmationUpdate(txid: string, walletId: string) {
    try {
      const transaction = await prisma.transaction.findFirst({
        where: { txid },
      });

      if (!transaction) return;

      // In production, fetch current confirmations from Electrum
      // If confirmations changed, broadcast update

      const wsServer = getWebSocketServer();
      wsServer.broadcast({
        type: 'confirmation',
        walletId,
        data: {
          txid,
          confirmations: transaction.confirmations,
        },
      });
    } catch (err) {
      log.error('Failed to check confirmation update', { error: String(err) });
    }
  }

  /**
   * Handle balance update
   */
  private async handleBalanceUpdate(walletId: string, balance: any) {
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) return;

      const update: BalanceUpdate = {
        walletId,
        balance: balance.confirmed,
        unconfirmed: balance.unconfirmed,
        previousBalance: 0, // Get from wallet record
        change: balance.confirmed - 0,
      };

      this.broadcastBalanceUpdate(update);
    } catch (err) {
      log.error('Failed to handle balance update', { error: String(err) });
    }
  }

  /**
   * Broadcast transaction notification
   */
  public broadcastTransactionNotification(notification: TransactionNotification) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'transaction',
      walletId: notification.walletId,
      data: {
        txid: notification.txid,
        type: notification.type,
        amount: notification.amount,
        confirmations: notification.confirmations,
        blockHeight: notification.blockHeight,
        timestamp: notification.timestamp,
      },
    };

    wsServer.broadcast(event);
    log.debug(`Broadcast transaction notification: ${notification.txid}`);
  }

  /**
   * Broadcast balance update
   */
  public broadcastBalanceUpdate(update: BalanceUpdate) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'balance',
      walletId: update.walletId,
      data: {
        balance: update.balance,
        unconfirmed: update.unconfirmed,
        change: update.change,
        timestamp: new Date(),
      },
    };

    wsServer.broadcast(event);
    log.debug(`Broadcast balance update for wallet: ${update.walletId}`);
  }

  /**
   * Broadcast new block notification (full details)
   */
  public broadcastBlockNotification(notification: BlockNotification) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'block',
      data: {
        height: notification.height,
        hash: notification.hash,
        timestamp: notification.timestamp,
        transactionCount: notification.transactionCount,
      },
    };

    wsServer.broadcast(event);
    log.debug(`Broadcast new block: ${notification.height}`);
  }

  /**
   * Broadcast new block notification (minimal - just height)
   * Used by real-time Electrum subscription
   */
  public broadcastNewBlock(block: { height: number }) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'newBlock',
      data: {
        height: block.height,
        timestamp: new Date(),
      },
    };

    wsServer.broadcast(event);
    log.info(`New block at height ${block.height}`);
  }

  /**
   * Broadcast mempool notification
   */
  public broadcastMempoolNotification(notification: MempoolNotification) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'mempool',
      data: {
        txid: notification.txid,
        fee: notification.fee,
        size: notification.size,
        feeRate: notification.feeRate,
      },
    };

    wsServer.broadcast(event);
  }

  /**
   * Subscribe wallet to real-time updates
   */
  async subscribeWallet(walletId: string) {
    try {
      // Get all addresses for this wallet
      const addresses = await prisma.address.findMany({
        where: { walletId },
      });

      // Subscribe to each address
      for (const addr of addresses) {
        await this.subscribeToAddress(addr.address, walletId);
      }

      log.debug(`Wallet ${walletId} subscribed to real-time updates`);
    } catch (err) {
      log.error(`Failed to subscribe wallet ${walletId}`, { error: String(err) });
    }
  }

  /**
   * Broadcast confirmation update for a transaction
   * Includes previousConfirmations so frontend can detect milestone transitions (e.g., 0→1)
   */
  public broadcastConfirmationUpdate(walletId: string, update: { txid: string; confirmations: number; previousConfirmations?: number }) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'confirmation',
      walletId,
      data: {
        txid: update.txid,
        confirmations: update.confirmations,
        previousConfirmations: update.previousConfirmations,
        timestamp: new Date(),
      },
    };

    wsServer.broadcast(event);

    // Log at info level for first confirmation milestone (0→1)
    if (update.previousConfirmations === 0 && update.confirmations >= 1) {
      log.info(`First confirmation: ${update.txid.slice(0, 8)}... (${update.confirmations} confs)`);
    } else {
      log.debug(`Broadcast confirmation update: ${update.txid} (${update.previousConfirmations ?? '?'}→${update.confirmations} confs)`);
    }
  }

  /**
   * Broadcast sync status update for a wallet
   */
  public broadcastSyncStatus(walletId: string, status: {
    inProgress: boolean;
    status?: string;
    error?: string;
    lastSyncedAt?: Date;
    retryCount?: number;
    maxRetries?: number;
    retryingIn?: number;
    retriesExhausted?: boolean;
  }) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'sync',
      walletId,
      data: {
        ...status,
        timestamp: new Date(),
      },
    };

    wsServer.broadcast(event);
  }

  /**
   * Broadcast wallet log entry for real-time sync logging
   */
  public broadcastWalletLog(walletId: string, entry: Omit<WalletLogEntry, 'id' | 'timestamp'>) {
    const wsServer = getWebSocketServer();

    const logEntry: WalletLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const event: WebSocketEvent = {
      type: 'log',
      walletId,
      data: logEntry,
    };

    wsServer.broadcast(event);
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
  details?: Record<string, any>
): void {
  notificationService.broadcastWalletLog(walletId, {
    level,
    module,
    message,
    details,
  });
}
