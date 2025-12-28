/**
 * WebSocket Event Types (Frontend)
 *
 * Typed event definitions for type-safe WebSocket communication.
 * These types mirror the server-side definitions for consistency.
 */

// =============================================================================
// Client-to-Server Messages
// =============================================================================

export interface AuthMessage {
  type: 'auth';
  data: {
    token: string;
  };
}

export interface SubscribeMessage {
  type: 'subscribe';
  data: {
    channel: string;
  };
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  data: {
    channel: string;
  };
}

export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | AuthMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage;

// =============================================================================
// Server-to-Client Events
// =============================================================================

export interface ConnectedEvent {
  type: 'connected';
  data: {
    message: string;
  };
}

export interface AuthenticatedEvent {
  type: 'authenticated';
  data: {
    userId: string;
    message: string;
  };
}

export interface SubscribedEvent {
  type: 'subscribed';
  data: {
    channel: string;
  };
}

export interface UnsubscribedEvent {
  type: 'unsubscribed';
  data: {
    channel: string;
  };
}

export interface ErrorEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

export interface TransactionEvent {
  type: 'transaction';
  walletId: string;
  data: {
    txid: string;
    type: 'received' | 'sent' | 'consolidation';
    amount: number;
    confirmations: number;
    blockHeight?: number;
    timestamp: string;
  };
}

export interface BalanceEvent {
  type: 'balance';
  walletId: string;
  data: {
    balance: number;
    unconfirmed: number;
    change: number;
    timestamp: string;
  };
}

export interface ConfirmationEvent {
  type: 'confirmation';
  walletId: string;
  data: {
    txid: string;
    confirmations: number;
    previousConfirmations?: number;
    timestamp: string;
  };
}

export interface BlockEvent {
  type: 'block';
  data: {
    height: number;
    hash: string;
    timestamp: string;
    transactionCount: number;
  };
}

export interface NewBlockEvent {
  type: 'newBlock';
  data: {
    height: number;
    timestamp: string;
  };
}

export interface MempoolEvent {
  type: 'mempool';
  data: {
    txid: string;
    fee: number;
    size: number;
    feeRate: number;
  };
}

export interface SyncEvent {
  type: 'sync';
  walletId: string;
  data: {
    inProgress: boolean;
    status?: string;
    error?: string;
    lastSyncedAt?: string;
    retryCount?: number;
    maxRetries?: number;
    retryingIn?: number;
    retriesExhausted?: boolean;
    timestamp: string;
  };
}

export interface LogEvent {
  type: 'log';
  walletId: string;
  data: {
    id: string;
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    module: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ModelDownloadEvent {
  type: 'modelDownload';
  data: {
    model: string;
    status: 'pulling' | 'downloading' | 'verifying' | 'complete' | 'error';
    completed: number;
    total: number;
    percent: number;
    digest?: string;
    error?: string;
  };
}

/**
 * All server-to-client events
 */
export type ServerEvent =
  | ConnectedEvent
  | AuthenticatedEvent
  | SubscribedEvent
  | UnsubscribedEvent
  | ErrorEvent
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | BlockEvent
  | NewBlockEvent
  | MempoolEvent
  | SyncEvent
  | LogEvent
  | ModelDownloadEvent;

/**
 * Events that are wallet-specific
 */
export type WalletEvent =
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | SyncEvent
  | LogEvent;

/**
 * Events that are global (no walletId)
 */
export type GlobalEvent =
  | BlockEvent
  | NewBlockEvent
  | MempoolEvent
  | ModelDownloadEvent;

// =============================================================================
// Type Guards
// =============================================================================

export function isServerEvent(event: unknown): event is ServerEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  return typeof e.type === 'string';
}

export function isWalletEvent(event: ServerEvent): event is WalletEvent {
  return (
    event.type === 'transaction' ||
    event.type === 'balance' ||
    event.type === 'confirmation' ||
    event.type === 'sync' ||
    event.type === 'log'
  );
}

export function isTransactionEvent(event: ServerEvent): event is TransactionEvent {
  return event.type === 'transaction';
}

export function isBalanceEvent(event: ServerEvent): event is BalanceEvent {
  return event.type === 'balance';
}

export function isConfirmationEvent(event: ServerEvent): event is ConfirmationEvent {
  return event.type === 'confirmation';
}

export function isSyncEvent(event: ServerEvent): event is SyncEvent {
  return event.type === 'sync';
}

export function isNewBlockEvent(event: ServerEvent): event is NewBlockEvent {
  return event.type === 'newBlock';
}

export function isModelDownloadEvent(event: ServerEvent): event is ModelDownloadEvent {
  return event.type === 'modelDownload';
}
