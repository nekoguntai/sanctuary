/**
 * WebSocket Event Types
 *
 * Typed event definitions using discriminated unions for type-safe
 * WebSocket communication between server and clients.
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
    channel: string; // e.g., 'wallet:uuid', 'global', 'model:download'
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

export interface PongMessage {
  type: 'pong';
}

/**
 * All possible client-to-server messages
 */
export type ClientMessage =
  | AuthMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage
  | PongMessage;

// =============================================================================
// Server-to-Client Events
// =============================================================================

/**
 * Connection established
 */
export interface ConnectedEvent {
  type: 'connected';
  data: {
    message: string;
  };
}

/**
 * Authentication successful
 */
export interface AuthenticatedEvent {
  type: 'authenticated';
  data: {
    userId: string;
    message: string;
  };
}

/**
 * Subscription confirmed
 */
export interface SubscribedEvent {
  type: 'subscribed';
  data: {
    channel: string;
  };
}

/**
 * Unsubscription confirmed
 */
export interface UnsubscribedEvent {
  type: 'unsubscribed';
  data: {
    channel: string;
  };
}

/**
 * Error occurred
 */
export interface ErrorEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

/**
 * New transaction received or sent
 */
export interface TransactionEvent {
  type: 'transaction';
  walletId: string;
  data: {
    txid: string;
    type: 'received' | 'sent' | 'consolidation';
    amount: number; // satoshis
    confirmations: number;
    blockHeight?: number;
    timestamp: Date | string;
  };
}

/**
 * Wallet balance updated
 */
export interface BalanceEvent {
  type: 'balance';
  walletId: string;
  data: {
    balance: number; // satoshis (confirmed)
    unconfirmed: number; // satoshis
    change: number; // difference from previous
    timestamp: Date | string;
  };
}

/**
 * Transaction confirmation count changed
 */
export interface ConfirmationEvent {
  type: 'confirmation';
  walletId: string;
  data: {
    txid: string;
    confirmations: number;
    previousConfirmations?: number;
    timestamp: Date | string;
  };
}

/**
 * New block received (full details)
 */
export interface BlockEvent {
  type: 'block';
  data: {
    height: number;
    hash: string;
    timestamp: Date | string;
    transactionCount: number;
  };
}

/**
 * New block received (minimal - just height)
 */
export interface NewBlockEvent {
  type: 'newBlock';
  data: {
    height: number;
    timestamp: Date | string;
  };
}

/**
 * Mempool transaction update
 */
export interface MempoolEvent {
  type: 'mempool';
  data: {
    txid: string;
    fee: number; // satoshis
    size: number; // bytes
    feeRate: number; // sat/vB
  };
}

/**
 * Wallet sync status update
 */
export interface SyncEvent {
  type: 'sync';
  walletId: string;
  data: {
    inProgress: boolean;
    status?: string;
    error?: string;
    lastSyncedAt?: Date | string;
    retryCount?: number;
    maxRetries?: number;
    retryingIn?: number;
    retriesExhausted?: boolean;
    timestamp: Date | string;
  };
}

/**
 * Real-time wallet log entry
 */
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

/**
 * AI model download progress
 */
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
 * All possible server-to-client events (broadcast events)
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
 * Broadcast events (sent to subscribed clients)
 */
export type BroadcastEvent =
  | TransactionEvent
  | BalanceEvent
  | ConfirmationEvent
  | BlockEvent
  | NewBlockEvent
  | MempoolEvent
  | SyncEvent
  | LogEvent
  | ModelDownloadEvent;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is a valid client message
 */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'auth' ||
    m.type === 'subscribe' ||
    m.type === 'unsubscribe' ||
    m.type === 'ping' ||
    m.type === 'pong'
  );
}

/**
 * Check if an event is wallet-specific (requires walletId)
 */
export function isWalletEvent(
  event: ServerEvent
): event is TransactionEvent | BalanceEvent | ConfirmationEvent | SyncEvent | LogEvent {
  return (
    event.type === 'transaction' ||
    event.type === 'balance' ||
    event.type === 'confirmation' ||
    event.type === 'sync' ||
    event.type === 'log'
  );
}

/**
 * Check if an event is global (no walletId)
 */
export function isGlobalEvent(
  event: ServerEvent
): event is BlockEvent | NewBlockEvent | MempoolEvent | ModelDownloadEvent {
  return (
    event.type === 'block' ||
    event.type === 'newBlock' ||
    event.type === 'mempool' ||
    event.type === 'modelDownload'
  );
}

// =============================================================================
// Event Builders (type-safe factory functions)
// =============================================================================

export const EventBuilders = {
  transaction(
    walletId: string,
    data: TransactionEvent['data']
  ): TransactionEvent {
    return { type: 'transaction', walletId, data };
  },

  balance(walletId: string, data: BalanceEvent['data']): BalanceEvent {
    return { type: 'balance', walletId, data };
  },

  confirmation(
    walletId: string,
    data: ConfirmationEvent['data']
  ): ConfirmationEvent {
    return { type: 'confirmation', walletId, data };
  },

  block(data: BlockEvent['data']): BlockEvent {
    return { type: 'block', data };
  },

  newBlock(data: NewBlockEvent['data']): NewBlockEvent {
    return { type: 'newBlock', data };
  },

  mempool(data: MempoolEvent['data']): MempoolEvent {
    return { type: 'mempool', data };
  },

  sync(walletId: string, data: SyncEvent['data']): SyncEvent {
    return { type: 'sync', walletId, data };
  },

  log(walletId: string, data: LogEvent['data']): LogEvent {
    return { type: 'log', walletId, data };
  },

  modelDownload(data: ModelDownloadEvent['data']): ModelDownloadEvent {
    return { type: 'modelDownload', data };
  },

  error(message: string, code?: string): ErrorEvent {
    return { type: 'error', data: { message, code } };
  },
};
