/**
 * Request Context
 *
 * Provides request-scoped context using AsyncLocalStorage.
 * This allows correlation IDs and other request metadata to be
 * automatically available throughout the request lifecycle without
 * explicit parameter passing.
 *
 * Usage:
 *   // In middleware (automatically set by correlationId middleware)
 *   requestContext.run({ requestId: 'abc123', userId: 'user1' }, next);
 *
 *   // Anywhere in request handling
 *   const ctx = requestContext.get();
 *   console.log(ctx?.requestId); // 'abc123'
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestContextData {
  /** Unique request correlation ID for tracing */
  requestId: string;
  /** User ID if authenticated */
  userId?: string;
  /** Username if authenticated */
  username?: string;
  /** Request start time for duration calculation */
  startTime: number;
  /** Request path */
  path?: string;
  /** Request method */
  method?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

/**
 * Request context utilities
 */
export const requestContext = {
  /**
   * Run a function within a request context
   */
  run<T>(context: RequestContextData, fn: () => T): T {
    return asyncLocalStorage.run(context, fn);
  },

  /**
   * Get the current request context (may be undefined outside request scope)
   */
  get(): RequestContextData | undefined {
    return asyncLocalStorage.getStore();
  },

  /**
   * Get the current request ID (returns 'no-request' if not in request scope)
   */
  getRequestId(): string {
    return asyncLocalStorage.getStore()?.requestId ?? 'no-request';
  },

  /**
   * Get the current user ID if available
   */
  getUserId(): string | undefined {
    return asyncLocalStorage.getStore()?.userId;
  },

  /**
   * Update context with user information (after authentication)
   */
  setUser(userId: string, username?: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.userId = userId;
      store.username = username;
    }
  },

  /**
   * Calculate request duration in milliseconds
   */
  getDuration(): number {
    const store = asyncLocalStorage.getStore();
    if (!store) return 0;
    return Date.now() - store.startTime;
  },

  /**
   * Generate a new request ID
   */
  generateRequestId(): string {
    // Short format: 8 characters from UUID for readability in logs
    return randomUUID().split('-')[0];
  },
};

export default requestContext;
