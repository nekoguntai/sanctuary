/**
 * Rate Limiting Types
 *
 * Interfaces and types for the distributed rate limiting service.
 */

/**
 * Key generation strategy for rate limiting
 */
export type KeyStrategy = 'ip' | 'user' | 'ip+user' | 'api-key' | 'custom';

/**
 * Rate limit policy configuration
 */
export interface RateLimitPolicy {
  /** Unique policy name */
  name: string;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** How to generate the rate limit key */
  keyStrategy: KeyStrategy;
  /** Don't count failed requests (4xx/5xx) toward the limit */
  skipFailedRequests?: boolean;
  /** Allow short bursts above the limit */
  burstLimit?: number;
  /** Custom message when rate limited */
  message?: string;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Total limit for the policy */
  limit: number;
  /** When the current window resets (ms since epoch) */
  resetAt: number;
  /** Seconds until retry is allowed (only set when not allowed) */
  retryAfter?: number;
}

/**
 * Rate limiter interface for different backends
 */
export interface IRateLimiter {
  /**
   * Check and consume a rate limit token
   * @param key - The rate limit key (e.g., "ip:192.168.1.1")
   * @param limit - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   * @param cost - Number of tokens to consume (default: 1)
   */
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
    cost?: number
  ): Promise<RateLimitResult>;

  /**
   * Check rate limit without consuming
   */
  check(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult>;

  /**
   * Reset rate limit for a key
   */
  reset(key: string): Promise<void>;

  /**
   * Get remaining quota for a key
   */
  getRemaining(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<number>;

  /**
   * Check if the limiter is healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get limiter type name
   */
  getType(): string;
}

/**
 * Rate limit service interface
 */
export interface IRateLimitService {
  /**
   * Register a rate limit policy
   */
  registerPolicy(policy: RateLimitPolicy): void;

  /**
   * Check and consume against a policy
   */
  consume(policyName: string, key: string, cost?: number): Promise<RateLimitResult>;

  /**
   * Check without consuming
   */
  check(policyName: string, key: string): Promise<RateLimitResult>;

  /**
   * Reset rate limit for a policy and key
   */
  reset(policyName: string, key: string): Promise<void>;

  /**
   * Get remaining quota
   */
  getRemaining(policyName: string, key: string): Promise<number>;

  /**
   * Get service health status
   */
  getHealth(): Promise<{
    healthy: boolean;
    backend: string;
    latencyMs?: number;
  }>;
}
