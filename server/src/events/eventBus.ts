/**
 * Internal Event Bus
 *
 * Type-safe event emitter for decoupled service-to-service communication.
 * Enables loose coupling between services while maintaining type safety.
 *
 * ## Usage
 *
 * ```typescript
 * // Subscribe to events
 * eventBus.on('wallet:synced', ({ walletId, balance }) => {
 *   console.log(`Wallet ${walletId} synced with balance ${balance}`);
 * });
 *
 * // Emit events
 * eventBus.emit('wallet:synced', { walletId: 'abc', balance: 100000n });
 *
 * // One-time listener
 * eventBus.once('transaction:confirmed', handler);
 *
 * // Unsubscribe
 * const unsubscribe = eventBus.on('wallet:synced', handler);
 * unsubscribe();
 * ```
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const log = createLogger('EventBus');

// =============================================================================
// Event Type Definitions
// =============================================================================

/**
 * Wallet-related events
 */
export interface WalletEvents {
  'wallet:created': {
    walletId: string;
    userId: string;
    name: string;
    type: 'single' | 'multisig';
    network: string;
  };
  'wallet:deleted': {
    walletId: string;
    userId: string;
  };
  'wallet:synced': {
    walletId: string;
    balance: bigint;
    unconfirmedBalance: bigint;
    transactionCount: number;
    duration: number;
  };
  'wallet:syncStarted': {
    walletId: string;
    fullResync: boolean;
  };
  'wallet:syncFailed': {
    walletId: string;
    error: string;
    retryCount: number;
  };
  'wallet:balanceChanged': {
    walletId: string;
    previousBalance: bigint;
    newBalance: bigint;
    difference: bigint;
  };
}

/**
 * Transaction-related events
 */
export interface TransactionEvents {
  'transaction:received': {
    walletId: string;
    txid: string;
    amount: bigint;
    address: string;
    confirmations: number;
  };
  'transaction:sent': {
    walletId: string;
    txid: string;
    amount: bigint;
    fee: bigint;
    recipients: Array<{ address: string; amount: bigint }>;
  };
  'transaction:confirmed': {
    walletId: string;
    txid: string;
    confirmations: number;
    blockHeight: number;
  };
  'transaction:rbfReplaced': {
    walletId: string;
    originalTxid: string;
    replacementTxid: string;
  };
  'transaction:broadcast': {
    walletId: string;
    txid: string;
    rawTx: string;
  };
}

/**
 * Device-related events
 */
export interface DeviceEvents {
  'device:registered': {
    deviceId: string;
    userId: string;
    type: string;
    fingerprint: string;
  };
  'device:deleted': {
    deviceId: string;
    userId: string;
  };
  'device:shared': {
    deviceId: string;
    ownerId: string;
    sharedWithUserId: string;
    role: 'owner' | 'viewer';
  };
}

/**
 * User-related events
 */
export interface UserEvents {
  'user:created': {
    userId: string;
    username: string;
  };
  'user:login': {
    userId: string;
    username: string;
    ipAddress?: string;
  };
  'user:logout': {
    userId: string;
  };
  'user:passwordChanged': {
    userId: string;
  };
  'user:twoFactorEnabled': {
    userId: string;
  };
  'user:twoFactorDisabled': {
    userId: string;
  };
}

/**
 * System-related events
 */
export interface SystemEvents {
  'system:startup': {
    version: string;
    environment: string;
  };
  'system:shutdown': {
    reason: string;
  };
  'system:healthCheck': {
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: Record<string, boolean>;
  };
  'system:maintenanceStarted': {
    task: string;
  };
  'system:maintenanceCompleted': {
    task: string;
    duration: number;
    success: boolean;
  };
  'system:config.changed': {
    key: string;
    previousValue: string;
    newValue: string;
    changedBy: string;
  };
}

/**
 * Blockchain-related events
 */
export interface BlockchainEvents {
  'blockchain:newBlock': {
    network: string;
    height: number;
    hash: string;
  };
  'blockchain:feeEstimateUpdated': {
    network: string;
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
  };
  'blockchain:priceUpdated': {
    btcUsd: number;
    source: string;
  };
}

/**
 * All event types combined
 */
export type EventTypes = WalletEvents &
  TransactionEvents &
  DeviceEvents &
  UserEvents &
  SystemEvents &
  BlockchainEvents;

/**
 * Event names
 */
export type EventName = keyof EventTypes;

/**
 * Event handler type
 */
export type EventHandler<E extends EventName> = (data: EventTypes[E]) => void | Promise<void>;

// =============================================================================
// Event Bus Implementation
// =============================================================================

/**
 * Type-safe event bus for internal service communication
 */
class TypedEventBus {
  private emitter = new EventEmitter();
  private metrics = {
    emitted: new Map<string, number>(),
    errors: new Map<string, number>(),
  };

  constructor() {
    // Increase max listeners to handle many subscribers
    this.emitter.setMaxListeners(100);
  }

  /**
   * Subscribe to an event
   * Returns unsubscribe function
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      try {
        await handler(data);
      } catch (error) {
        log.error(`Error in event handler for ${event}`, { error });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    };

    this.emitter.on(event, wrappedHandler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(event, wrappedHandler);
    };
  }

  /**
   * Subscribe to an event (one-time)
   */
  once<E extends EventName>(event: E, handler: EventHandler<E>): void {
    const wrappedHandler = async (data: EventTypes[E]) => {
      try {
        await handler(data);
      } catch (error) {
        log.error(`Error in one-time event handler for ${event}`, { error });
        this.metrics.errors.set(event, (this.metrics.errors.get(event) || 0) + 1);
      }
    };

    this.emitter.once(event, wrappedHandler);
  }

  /**
   * Emit an event
   */
  emit<E extends EventName>(event: E, data: EventTypes[E]): void {
    log.debug(`Event emitted: ${event}`, { data });
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);
    this.emitter.emit(event, data);
  }

  /**
   * Emit an event and wait for all handlers to complete
   */
  async emitAsync<E extends EventName>(event: E, data: EventTypes[E]): Promise<void> {
    log.debug(`Async event emitted: ${event}`, { data });
    this.metrics.emitted.set(event, (this.metrics.emitted.get(event) || 0) + 1);

    const listeners = this.emitter.listeners(event) as Array<(data: EventTypes[E]) => Promise<void>>;
    await Promise.all(listeners.map(listener => listener(data)));
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<E extends EventName>(event?: E): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount<E extends EventName>(event: E): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): {
    emitted: Record<string, number>;
    errors: Record<string, number>;
    listenerCounts: Record<string, number>;
  } {
    const listenerCounts: Record<string, number> = {};
    for (const event of this.emitter.eventNames()) {
      listenerCounts[event as string] = this.emitter.listenerCount(event);
    }

    return {
      emitted: Object.fromEntries(this.metrics.emitted),
      errors: Object.fromEntries(this.metrics.errors),
      listenerCounts,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics.emitted.clear();
    this.metrics.errors.clear();
  }
}

/**
 * Global event bus singleton
 */
export const eventBus = new TypedEventBus();

/**
 * Create a scoped event bus for testing
 */
export function createTestEventBus(): TypedEventBus {
  return new TypedEventBus();
}
