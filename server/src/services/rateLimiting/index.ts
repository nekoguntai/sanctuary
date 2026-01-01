/**
 * Rate Limiting Service
 *
 * Distributed rate limiting with Redis backend and in-memory fallback.
 *
 * @module services/rateLimiting
 */

export { rateLimitService } from './rateLimitService';
export { RATE_LIMIT_POLICIES, getPolicy, createPolicy } from './policies';
export type {
  RateLimitPolicy,
  RateLimitResult,
  KeyStrategy,
  IRateLimiter,
  IRateLimitService,
} from './types';
