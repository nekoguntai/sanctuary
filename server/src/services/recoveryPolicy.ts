/**
 * Error Recovery Policies
 *
 * Defines retry behavior and recovery strategies for different operations.
 * Works with circuit breakers to provide comprehensive fault tolerance.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('RECOVERY');

export type ExhaustedAction = 'notify' | 'disable' | 'continue' | 'fallback';

export interface RecoveryPolicy {
  /** Unique identifier for this policy */
  name: string;
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Backoff delays in milliseconds for each retry */
  backoffMs: number[];
  /** Action to take when retries are exhausted */
  onExhausted: ExhaustedAction;
  /** Whether to add jitter to backoff delays */
  jitter?: boolean;
  /** Maximum jitter as percentage of delay (default 0.2 = 20%) */
  jitterFactor?: number;
}

export interface RecoveryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  totalTime: number;
  finalError?: Error;
  action?: ExhaustedAction;
}

/**
 * Pre-defined recovery policies for common scenarios
 */
export const RecoveryPolicies: Record<string, RecoveryPolicy> = {
  // Electrum connection - critical, aggressive retry
  'electrum:connection': {
    name: 'electrum:connection',
    maxRetries: 5,
    backoffMs: [1000, 2000, 5000, 10000, 30000],
    onExhausted: 'fallback',
    jitter: true,
  },

  // Real-time subscriptions - important but not blocking
  'sync:subscription': {
    name: 'sync:subscription',
    maxRetries: 3,
    backoffMs: [2000, 5000, 15000],
    onExhausted: 'notify',
    jitter: true,
  },

  // Price API - non-critical, can fail silently
  'price:fetch': {
    name: 'price:fetch',
    maxRetries: 2,
    backoffMs: [1000, 3000],
    onExhausted: 'continue',
    jitter: true,
  },

  // Transaction broadcast - critical, user should know
  'transaction:broadcast': {
    name: 'transaction:broadcast',
    maxRetries: 3,
    backoffMs: [1000, 3000, 5000],
    onExhausted: 'notify',
    jitter: false,
  },

  // Database operations - retry quickly, then fail
  'database:query': {
    name: 'database:query',
    maxRetries: 2,
    backoffMs: [100, 500],
    onExhausted: 'continue',
    jitter: false,
  },

  // Wallet sync - can retry over longer period
  'wallet:sync': {
    name: 'wallet:sync',
    maxRetries: 5,
    backoffMs: [5000, 15000, 30000, 60000, 120000],
    onExhausted: 'notify',
    jitter: true,
  },
};

/**
 * Sleep utility with optional jitter
 */
function sleep(ms: number, jitter: boolean = false, jitterFactor: number = 0.2): Promise<void> {
  let delay = ms;
  if (jitter) {
    const jitterAmount = ms * jitterFactor * (Math.random() * 2 - 1);
    delay = Math.max(0, ms + jitterAmount);
  }
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Execute an operation with retry according to a recovery policy
 */
export async function executeWithRecovery<T>(
  policy: RecoveryPolicy,
  operation: () => Promise<T>,
  options?: {
    onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    onExhausted?: (action: ExhaustedAction, error: Error) => void;
    fallback?: () => Promise<T>;
  }
): Promise<RecoveryResult<T>> {
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < policy.maxRetries) {
        const delayMs = policy.backoffMs[Math.min(attempt, policy.backoffMs.length - 1)];

        log.debug(`[${policy.name}] Attempt ${attempt + 1} failed, retrying in ${delayMs}ms`, {
          error: lastError.message,
        });

        if (options?.onRetry) {
          options.onRetry(attempt + 1, lastError, delayMs);
        }

        await sleep(delayMs, policy.jitter, policy.jitterFactor);
      }
    }
  }

  // All retries exhausted
  log.warn(`[${policy.name}] All ${policy.maxRetries + 1} attempts failed`, {
    action: policy.onExhausted,
    error: lastError?.message,
  });

  if (options?.onExhausted) {
    options.onExhausted(policy.onExhausted, lastError!);
  }

  // Handle exhausted action
  if (policy.onExhausted === 'fallback' && options?.fallback) {
    try {
      const fallbackResult = await options.fallback();
      return {
        success: true,
        result: fallbackResult,
        attempts: policy.maxRetries + 1,
        totalTime: Date.now() - startTime,
        action: 'fallback',
      };
    } catch (fallbackError) {
      log.error(`[${policy.name}] Fallback also failed`, { error: fallbackError });
    }
  }

  return {
    success: false,
    attempts: policy.maxRetries + 1,
    totalTime: Date.now() - startTime,
    finalError: lastError,
    action: policy.onExhausted,
  };
}

/**
 * Create a custom recovery policy
 */
export function createRecoveryPolicy(
  name: string,
  options: Omit<RecoveryPolicy, 'name'>
): RecoveryPolicy {
  return { name, ...options };
}

/**
 * Wrap a function with automatic recovery
 */
export function withRecovery<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  policy: RecoveryPolicy,
  options?: {
    onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    onExhausted?: (action: ExhaustedAction, error: Error) => void;
  }
): T {
  return (async (...args: Parameters<T>) => {
    const result = await executeWithRecovery(
      policy,
      () => fn(...args) as Promise<ReturnType<T>>,
      options
    );

    if (!result.success) {
      throw result.finalError || new Error(`${policy.name} failed after ${result.attempts} attempts`);
    }

    return result.result;
  }) as T;
}
