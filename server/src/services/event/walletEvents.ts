/**
 * Wallet Event Emitters
 *
 * Handles emission of wallet-related events to the event bus and WebSocket.
 */

import { eventBus } from '../../events/eventBus';
import { broadcastBalance, broadcastSync } from '../../websocket/broadcast';
import { createLogger } from '../../utils/logger';
import type { WalletSyncResult, WalletCreatedData, BalanceChangeData } from './types';

const log = createLogger('EVENT:SVC_WALLET');

/**
 * Emit wallet synced event
 * Triggers both internal event bus and WebSocket broadcast
 */
export function emitWalletSynced(data: WalletSyncResult): void {
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
export function emitWalletSyncStarted(walletId: string, fullResync: boolean = false): void {
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
export function emitWalletSyncFailed(walletId: string, error: string, retryCount: number = 0): void {
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
export function emitWalletCreated(data: WalletCreatedData): void {
  eventBus.emit('wallet:created', data);
  log.info('Emitted wallet:created', { walletId: data.walletId, type: data.type });
}

/**
 * Emit wallet deleted event
 */
export function emitWalletDeleted(walletId: string, userId: string): void {
  eventBus.emit('wallet:deleted', { walletId, userId });
  log.info('Emitted wallet:deleted', { walletId, userId });
}

/**
 * Emit balance changed event
 */
export function emitBalanceChanged(data: BalanceChangeData): void {
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
