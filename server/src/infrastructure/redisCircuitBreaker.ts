/**
 * Redis Circuit Breaker
 *
 * Provides graceful degradation when Redis becomes unavailable.
 * Uses circuit breaker pattern to prevent cascading failures.
 *
 * ## States
 *
 * - CLOSED: Normal operation, all requests go to Redis
 * - OPEN: Redis failed, all requests use fallback
 * - HALF_OPEN: Testing if Redis recovered
 *
 * ## Usage
 *
 * ```typescript
 * import { withRedisCircuitBreaker } from './infrastructure/redisCircuitBreaker';
 *
 * const result = await withRedisCircuitBreaker(
 *   () => redis.get(key),           // Primary: Redis
 *   () => localCache.get(key),      // Fallback: Local cache
 *   'cache-get'
 * );
 * ```
 */

import { createLogger } from '../utils/logger';

const log = createLogger('RedisCircuit');

// =============================================================================
// Types
// =============================================================================

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting recovery (default: 30000) */
  recoveryTimeout: number;
  /** Number of successful calls in half-open to close (default: 3) */
  successThreshold: number;
  /** Called when circuit state changes */
  onStateChange?: (state: CircuitState, previousState: CircuitState) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  fallbackCalls: number;
  totalCalls: number;
}

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private lastStateChange: Date = new Date();
  private fallbackCalls = 0;
  private totalCalls = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      recoveryTimeout: config.recoveryTimeout ?? 30000,
      successThreshold: config.successThreshold ?? 3,
      onStateChange: config.onStateChange,
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    this.totalCalls++;

    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.lastFailure?.getTime() || 0);
      if (timeSinceLastFailure >= this.config.recoveryTimeout) {
        this.transitionTo('half_open');
      }
    }

    // If circuit is open, use fallback immediately
    if (this.state === 'open') {
      this.fallbackCalls++;
      log.debug('Circuit open, using fallback', { operation: operationName });
      return fallbackFn();
    }

    // Try primary operation
    try {
      const result = await primaryFn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error, operationName);

      // Use fallback
      this.fallbackCalls++;
      log.debug('Primary failed, using fallback', {
        operation: operationName,
        state: this.state,
        failures: this.failures,
      });
      return fallbackFn();
    }
  }

  /**
   * Record successful operation
   */
  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.failures = 0;

    if (this.state === 'half_open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
  }

  /**
   * Record failed operation
   */
  private onFailure(error: Error, operation: string): void {
    this.lastFailure = new Date();
    this.failures++;
    this.successes = 0;

    log.warn('Redis operation failed', {
      operation,
      failures: this.failures,
      threshold: this.config.failureThreshold,
      error: error.message,
    });

    if (this.state === 'half_open') {
      // Any failure in half-open goes back to open
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    if (newState === 'closed') {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === 'half_open') {
      this.successes = 0;
    }

    log.info('Circuit breaker state changed', {
      from: previousState,
      to: newState,
    });

    if (this.config.onStateChange) {
      this.config.onStateChange(newState, previousState);
    }
  }

  /**
   * Get current stats
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      fallbackCalls: this.fallbackCalls,
      totalCalls: this.totalCalls,
    };
  }

  /**
   * Force circuit to specific state (for testing/admin)
   */
  forceState(state: CircuitState): void {
    const previousState = this.state;
    this.state = state;
    this.lastStateChange = new Date();
    log.warn('Circuit breaker state forced', { from: previousState, to: state });
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.fallbackCalls = 0;
    this.totalCalls = 0;
    this.lastStateChange = new Date();
    log.info('Circuit breaker reset');
  }
}

// =============================================================================
// Global Instance
// =============================================================================

const redisCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeout: 30000,
  successThreshold: 3,
  onStateChange: (state, prev) => {
    if (state === 'open') {
      log.error('Redis circuit breaker OPEN - using local fallbacks');
    } else if (state === 'closed' && prev === 'half_open') {
      log.info('Redis circuit breaker CLOSED - Redis recovered');
    }
  },
});

/**
 * Execute operation with Redis circuit breaker
 */
export async function withRedisCircuitBreaker<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
  operationName: string = 'redis-operation'
): Promise<T> {
  return redisCircuitBreaker.execute(primaryFn, fallbackFn, operationName);
}

/**
 * Get circuit breaker stats
 */
export function getRedisCircuitBreakerStats(): CircuitBreakerStats {
  return redisCircuitBreaker.getStats();
}

/**
 * Reset circuit breaker (for testing/admin)
 */
export function resetRedisCircuitBreaker(): void {
  redisCircuitBreaker.reset();
}

/**
 * Force circuit breaker state (for testing/admin)
 */
export function forceRedisCircuitBreakerState(state: CircuitState): void {
  redisCircuitBreaker.forceState(state);
}

export { CircuitBreaker };
