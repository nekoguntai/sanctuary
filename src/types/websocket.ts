/**
 * WebSocket Event Types (Frontend)
 *
 * Re-exports shared WebSocket types and adds frontend-specific type guards.
 */

// Import and re-export all shared types
export type {
  // Client messages
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  PingMessage,
  PongMessage,
  ClientMessage,
  // Server events
  ConnectedEvent,
  AuthenticatedEvent,
  SubscribedEvent,
  UnsubscribedEvent,
  ErrorEvent,
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  BlockEvent,
  NewBlockEvent,
  MempoolEvent,
  SyncEvent,
  LogEvent,
  ModelDownloadEvent,
  ServerEvent,
  WalletEvent,
  GlobalEvent,
  BroadcastEvent,
} from '@shared/types/websocket';

// Re-export type guards as values
export {
  isServerEvent,
  isClientMessage,
  isWalletEvent,
  isGlobalEvent,
} from '@shared/types/websocket';

import type {
  ServerEvent,
  TransactionEvent,
  BalanceEvent,
  ConfirmationEvent,
  SyncEvent,
  NewBlockEvent,
  ModelDownloadEvent,
} from '@shared/types/websocket';

// =============================================================================
// Frontend-Specific Type Guards
// =============================================================================

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
