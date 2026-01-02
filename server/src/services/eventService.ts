/**
 * Event Service
 *
 * Unified service for emitting events across the application.
 * Coordinates between the internal event bus and WebSocket broadcasts.
 *
 * This service ensures that:
 * 1. All significant events are emitted to the event bus for internal subscribers
 * 2. Client-relevant events are broadcast via WebSocket for real-time updates
 * 3. Events are logged for debugging and audit purposes
 *
 * @example
 * // In a service
 * import { eventService } from './eventService';
 *
 * // After syncing a wallet
 * await eventService.emitWalletSynced({
 *   walletId,
 *   balance,
 *   unconfirmedBalance,
 *   transactionCount,
 *   duration,
 * });
 */

import { eventBus, EventTypes } from '../events/eventBus';
import {
  broadcastBalance,
  broadcastTransaction,
  broadcastConfirmation,
  broadcastSync,
} from '../websocket/broadcast';
import { createLogger } from '../utils/logger';

const log = createLogger('EVENT_SVC');

// =============================================================================
// Event Service Implementation
// =============================================================================

/**
 * Wallet sync result for emission
 */
export interface WalletSyncResult {
  walletId: string;
  balance: bigint;
  unconfirmedBalance: bigint;
  transactionCount: number;
  duration: number;
  isFullResync?: boolean;
}

/**
 * Transaction broadcast result
 */
export interface TransactionBroadcastResult {
  walletId: string;
  txid: string;
  amount: bigint;
  fee: bigint;
  recipients: Array<{ address: string; amount: bigint }>;
  rawTx?: string;
}

/**
 * Transaction received data
 */
export interface TransactionReceivedData {
  walletId: string;
  txid: string;
  amount: bigint;
  address: string;
  confirmations: number;
}

/**
 * Transaction confirmation update
 */
export interface TransactionConfirmationData {
  walletId: string;
  txid: string;
  confirmations: number;
  blockHeight: number;
  previousConfirmations?: number;
}

/**
 * Balance change data
 */
export interface BalanceChangeData {
  walletId: string;
  previousBalance: bigint;
  newBalance: bigint;
  unconfirmedBalance?: bigint;
}

/**
 * Wallet creation data
 */
export interface WalletCreatedData {
  walletId: string;
  userId: string;
  name: string;
  type: 'single' | 'multisig';
  network: string;
}

/**
 * User login data
 */
export interface UserLoginData {
  userId: string;
  username: string;
  ipAddress?: string;
}

/**
 * Device registered data
 */
export interface DeviceRegisteredData {
  deviceId: string;
  userId: string;
  type: string;
  fingerprint: string;
}

/**
 * Unified Event Service
 */
class EventService {
  // ===========================================================================
  // Wallet Events
  // ===========================================================================

  /**
   * Emit wallet synced event
   * Triggers both internal event bus and WebSocket broadcast
   */
  emitWalletSynced(data: WalletSyncResult): void {
    // Emit to internal event bus
    eventBus.emit('wallet:synced', {
      walletId: data.walletId,
      balance: data.balance,
      unconfirmedBalance: data.unconfirmedBalance,
      transactionCount: data.transactionCount,
      duration: data.duration,
    });

    // Broadcast to WebSocket clients
    broadcastSync(data.walletId, {
      inProgress: false,
      status: 'complete',
    });

    // Also broadcast updated balance
    broadcastBalance(data.walletId, {
      balance: Number(data.balance),
      unconfirmed: Number(data.unconfirmedBalance),
      change: 0, // Will be calculated by client if needed
    });

    log.debug('Emitted wallet:synced', {
      walletId: data.walletId,
      balance: data.balance.toString(),
    });
  }

  /**
   * Emit wallet sync started event
   */
  emitWalletSyncStarted(walletId: string, fullResync: boolean = false): void {
    eventBus.emit('wallet:syncStarted', { walletId, fullResync });

    broadcastSync(walletId, {
      inProgress: true,
      status: 'syncing',
    });

    log.debug('Emitted wallet:syncStarted', { walletId, fullResync });
  }

  /**
   * Emit wallet sync failed event
   */
  emitWalletSyncFailed(walletId: string, error: string, retryCount: number = 0): void {
    eventBus.emit('wallet:syncFailed', { walletId, error, retryCount });

    broadcastSync(walletId, {
      inProgress: false,
      status: 'error',
      error,
    });

    log.warn('Emitted wallet:syncFailed', { walletId, error, retryCount });
  }

  /**
   * Emit wallet created event
   */
  emitWalletCreated(data: WalletCreatedData): void {
    eventBus.emit('wallet:created', data);
    log.info('Emitted wallet:created', { walletId: data.walletId, type: data.type });
  }

  /**
   * Emit wallet deleted event
   */
  emitWalletDeleted(walletId: string, userId: string): void {
    eventBus.emit('wallet:deleted', { walletId, userId });
    log.info('Emitted wallet:deleted', { walletId, userId });
  }

  /**
   * Emit balance changed event
   */
  emitBalanceChanged(data: BalanceChangeData): void {
    const difference = data.newBalance - data.previousBalance;

    eventBus.emit('wallet:balanceChanged', {
      walletId: data.walletId,
      previousBalance: data.previousBalance,
      newBalance: data.newBalance,
      difference,
    });

    broadcastBalance(data.walletId, {
      balance: Number(data.newBalance),
      unconfirmed: Number(data.unconfirmedBalance ?? 0n),
      change: Number(difference),
    });

    log.debug('Emitted wallet:balanceChanged', {
      walletId: data.walletId,
      change: difference.toString(),
    });
  }

  // ===========================================================================
  // Transaction Events
  // ===========================================================================

  /**
   * Emit transaction sent (broadcast) event
   */
  emitTransactionSent(data: TransactionBroadcastResult): void {
    eventBus.emit('transaction:sent', {
      walletId: data.walletId,
      txid: data.txid,
      amount: data.amount,
      fee: data.fee,
      recipients: data.recipients,
    });

    // Also emit broadcast event with raw tx
    if (data.rawTx) {
      eventBus.emit('transaction:broadcast', {
        walletId: data.walletId,
        txid: data.txid,
        rawTx: data.rawTx,
      });
    }

    broadcastTransaction(data.walletId, {
      txid: data.txid,
      type: 'sent',
      amount: -Number(data.amount), // Negative for sent
      confirmations: 0,
      timestamp: new Date(),
    });

    log.info('Emitted transaction:sent', {
      walletId: data.walletId,
      txid: data.txid,
      amount: data.amount.toString(),
    });
  }

  /**
   * Emit transaction received event
   */
  emitTransactionReceived(data: TransactionReceivedData): void {
    eventBus.emit('transaction:received', data);

    broadcastTransaction(data.walletId, {
      txid: data.txid,
      type: 'received',
      amount: Number(data.amount),
      confirmations: data.confirmations,
      timestamp: new Date(),
    });

    log.info('Emitted transaction:received', {
      walletId: data.walletId,
      txid: data.txid,
      amount: data.amount.toString(),
    });
  }

  /**
   * Emit transaction confirmed event
   */
  emitTransactionConfirmed(data: TransactionConfirmationData): void {
    eventBus.emit('transaction:confirmed', {
      walletId: data.walletId,
      txid: data.txid,
      confirmations: data.confirmations,
      blockHeight: data.blockHeight,
    });

    broadcastConfirmation(data.walletId, {
      txid: data.txid,
      confirmations: data.confirmations,
      previousConfirmations: data.previousConfirmations,
    });

    log.debug('Emitted transaction:confirmed', {
      txid: data.txid,
      confirmations: data.confirmations,
    });
  }

  /**
   * Emit RBF replacement event
   */
  emitTransactionReplaced(walletId: string, originalTxid: string, replacementTxid: string): void {
    eventBus.emit('transaction:rbfReplaced', {
      walletId,
      originalTxid,
      replacementTxid,
    });

    log.info('Emitted transaction:rbfReplaced', {
      walletId,
      originalTxid,
      replacementTxid,
    });
  }

  // ===========================================================================
  // User Events
  // ===========================================================================

  /**
   * Emit user login event
   */
  emitUserLogin(data: UserLoginData): void {
    eventBus.emit('user:login', data);
    log.info('Emitted user:login', { userId: data.userId, username: data.username });
  }

  /**
   * Emit user logout event
   */
  emitUserLogout(userId: string): void {
    eventBus.emit('user:logout', { userId });
    log.debug('Emitted user:logout', { userId });
  }

  /**
   * Emit user created event
   */
  emitUserCreated(userId: string, username: string): void {
    eventBus.emit('user:created', { userId, username });
    log.info('Emitted user:created', { userId, username });
  }

  /**
   * Emit password changed event
   */
  emitPasswordChanged(userId: string): void {
    eventBus.emit('user:passwordChanged', { userId });
    log.info('Emitted user:passwordChanged', { userId });
  }

  /**
   * Emit 2FA enabled event
   */
  emitTwoFactorEnabled(userId: string): void {
    eventBus.emit('user:twoFactorEnabled', { userId });
    log.info('Emitted user:twoFactorEnabled', { userId });
  }

  /**
   * Emit 2FA disabled event
   */
  emitTwoFactorDisabled(userId: string): void {
    eventBus.emit('user:twoFactorDisabled', { userId });
    log.info('Emitted user:twoFactorDisabled', { userId });
  }

  // ===========================================================================
  // Device Events
  // ===========================================================================

  /**
   * Emit device registered event
   */
  emitDeviceRegistered(data: DeviceRegisteredData): void {
    eventBus.emit('device:registered', data);
    log.info('Emitted device:registered', { deviceId: data.deviceId, type: data.type });
  }

  /**
   * Emit device deleted event
   */
  emitDeviceDeleted(deviceId: string, userId: string): void {
    eventBus.emit('device:deleted', { deviceId, userId });
    log.info('Emitted device:deleted', { deviceId, userId });
  }

  /**
   * Emit device shared event
   */
  emitDeviceShared(deviceId: string, ownerId: string, sharedWithUserId: string, role: 'owner' | 'viewer'): void {
    eventBus.emit('device:shared', { deviceId, ownerId, sharedWithUserId, role });
    log.info('Emitted device:shared', { deviceId, sharedWithUserId, role });
  }

  // ===========================================================================
  // System Events
  // ===========================================================================

  /**
   * Emit system startup event
   */
  emitSystemStartup(version: string, environment: string): void {
    eventBus.emit('system:startup', { version, environment });
    log.info('Emitted system:startup', { version, environment });
  }

  /**
   * Emit system shutdown event
   */
  emitSystemShutdown(reason: string): void {
    eventBus.emit('system:shutdown', { reason });
    log.info('Emitted system:shutdown', { reason });
  }

  /**
   * Emit maintenance started event
   */
  emitMaintenanceStarted(task: string): void {
    eventBus.emit('system:maintenanceStarted', { task });
    log.debug('Emitted system:maintenanceStarted', { task });
  }

  /**
   * Emit maintenance completed event
   */
  emitMaintenanceCompleted(task: string, duration: number, success: boolean): void {
    eventBus.emit('system:maintenanceCompleted', { task, duration, success });
    log.debug('Emitted system:maintenanceCompleted', { task, duration, success });
  }

  // ===========================================================================
  // Blockchain Events
  // ===========================================================================

  /**
   * Emit new block event
   */
  emitNewBlock(network: string, height: number, hash: string): void {
    eventBus.emit('blockchain:newBlock', { network, height, hash });
    log.debug('Emitted blockchain:newBlock', { network, height });
  }

  /**
   * Emit fee estimate updated event
   */
  emitFeeEstimateUpdated(network: string, fastestFee: number, halfHourFee: number, hourFee: number): void {
    eventBus.emit('blockchain:feeEstimateUpdated', {
      network,
      fastestFee,
      halfHourFee,
      hourFee,
    });
  }

  /**
   * Emit price updated event
   */
  emitPriceUpdated(btcUsd: number, source: string): void {
    eventBus.emit('blockchain:priceUpdated', { btcUsd, source });
    log.debug('Emitted blockchain:priceUpdated', { btcUsd, source });
  }

  // ===========================================================================
  // Direct Event Bus Access (for custom events)
  // ===========================================================================

  /**
   * Subscribe to an event
   */
  on<E extends keyof EventTypes>(event: E, handler: (data: EventTypes[E]) => void | Promise<void>): () => void {
    return eventBus.on(event, handler);
  }

  /**
   * Subscribe to an event once
   */
  once<E extends keyof EventTypes>(event: E, handler: (data: EventTypes[E]) => void | Promise<void>): void {
    eventBus.once(event, handler);
  }

  /**
   * Emit a raw event (for events not covered by helper methods)
   */
  emit<E extends keyof EventTypes>(event: E, data: EventTypes[E]): void {
    eventBus.emit(event, data);
  }

  /**
   * Get event bus metrics
   */
  getMetrics() {
    return eventBus.getMetrics();
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const eventService = new EventService();
export default eventService;
