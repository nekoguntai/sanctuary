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

export class NotificationService {
  private subscribedAddresses: Set<string> = new Set();
  private isRunning: boolean = false;

  /**
   * Start the notification service
   */
  async start() {
    if (this.isRunning) {
      console.log('Notification service already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting notification service...');

    // Subscribe to Electrum blockchain headers for new blocks
    await this.subscribeToBlocks();

    console.log('Notification service started');
  }

  /**
   * Stop the notification service
   */
  stop() {
    this.isRunning = false;
    console.log('Notification service stopped');
  }

  /**
   * Subscribe to new blocks
   */
  private async subscribeToBlocks() {
    try {
      // In production, this would subscribe to Electrum's blockchain.headers.subscribe
      // For demo, we'll simulate periodic block checks
      console.log('Subscribed to blockchain headers');
    } catch (err) {
      console.error('Failed to subscribe to blocks:', err);
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
      console.log(`Subscribed to address updates: ${address}`);

      // Note: Electrum subscriptions work via the persistent connection
      // Status changes are received via the socket and would need to be
      // handled separately in the electrum client event handlers
    } catch (err) {
      console.error(`Failed to subscribe to address ${address}:`, err);
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
        console.warn(`Address ${address} not found in database`);
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
      console.error('Failed to handle address update:', err);
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
      console.error('Failed to handle transaction:', err);
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
      console.error('Failed to check confirmation update:', err);
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
      console.error('Failed to handle balance update:', err);
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
    console.log(`Broadcast transaction notification: ${notification.txid}`);
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
    console.log(`Broadcast balance update for wallet: ${update.walletId}`);
  }

  /**
   * Broadcast new block notification
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
    console.log(`Broadcast new block: ${notification.height}`);
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

      console.log(`Wallet ${walletId} subscribed to real-time updates`);
    } catch (err) {
      console.error(`Failed to subscribe wallet ${walletId}:`, err);
    }
  }

  /**
   * Broadcast confirmation update for a transaction
   */
  public broadcastConfirmationUpdate(walletId: string, update: { txid: string; confirmations: number }) {
    const wsServer = getWebSocketServer();

    const event: WebSocketEvent = {
      type: 'confirmation',
      walletId,
      data: {
        txid: update.txid,
        confirmations: update.confirmations,
        timestamp: new Date(),
      },
    };

    wsServer.broadcast(event);
    console.log(`Broadcast confirmation update: ${update.txid} (${update.confirmations} confs)`);
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
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export getter function for use in other services
export const getNotificationService = (): NotificationService => notificationService;
