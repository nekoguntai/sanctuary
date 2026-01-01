/**
 * Rate Limit Policies
 *
 * Pre-defined rate limit policies for different API endpoints.
 */

import type { RateLimitPolicy } from './types';

/**
 * Standard rate limit policies
 */
export const RATE_LIMIT_POLICIES: Record<string, RateLimitPolicy> = {
  // Authentication policies (strict)
  'auth:login': {
    name: 'auth:login',
    limit: 5,
    windowSeconds: 15 * 60, // 15 minutes
    keyStrategy: 'ip+user',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },

  'auth:register': {
    name: 'auth:register',
    limit: 10,
    windowSeconds: 60 * 60, // 1 hour
    keyStrategy: 'ip',
    message: 'Too many registration attempts. Please try again later.',
  },

  'auth:2fa': {
    name: 'auth:2fa',
    limit: 10,
    windowSeconds: 15 * 60, // 15 minutes
    keyStrategy: 'ip',
    message: 'Too many 2FA attempts. Please try again in 15 minutes.',
  },

  'auth:password-change': {
    name: 'auth:password-change',
    limit: 5,
    windowSeconds: 15 * 60, // 15 minutes
    keyStrategy: 'user',
    message: 'Too many password change attempts. Please try again later.',
  },

  // API policies (general)
  'api:default': {
    name: 'api:default',
    limit: 1000,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    skipFailedRequests: true,
    message: 'API rate limit exceeded. Please slow down.',
  },

  'api:heavy': {
    name: 'api:heavy',
    limit: 100,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many requests to this endpoint.',
  },

  'api:public': {
    name: 'api:public',
    limit: 60,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'ip',
    message: 'Rate limit exceeded. Please try again later.',
  },

  // Sync policies
  'sync:trigger': {
    name: 'sync:trigger',
    limit: 10,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many sync requests. Please wait before syncing again.',
  },

  'sync:batch': {
    name: 'sync:batch',
    limit: 5,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many batch sync requests.',
  },

  // Transaction policies
  'tx:create': {
    name: 'tx:create',
    limit: 30,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many transaction creation attempts.',
  },

  'tx:broadcast': {
    name: 'tx:broadcast',
    limit: 20,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many broadcast attempts. Please wait.',
  },

  // AI policies (resource intensive)
  'ai:analyze': {
    name: 'ai:analyze',
    limit: 20,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'AI analysis rate limit reached. Please wait.',
  },

  'ai:summarize': {
    name: 'ai:summarize',
    limit: 10,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'AI summary rate limit reached.',
  },

  // Admin policies (separate from regular users)
  'admin:default': {
    name: 'admin:default',
    limit: 500,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Admin API rate limit exceeded.',
  },

  // Payjoin policies
  'payjoin:create': {
    name: 'payjoin:create',
    limit: 10,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many PayJoin requests.',
  },

  // WebSocket policies
  'ws:connect': {
    name: 'ws:connect',
    limit: 10,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'ip',
    message: 'Too many WebSocket connection attempts.',
  },

  'ws:message': {
    name: 'ws:message',
    limit: 100,
    windowSeconds: 60, // 1 minute
    keyStrategy: 'user',
    message: 'Too many WebSocket messages.',
  },
};

/**
 * Get policy by name
 */
export function getPolicy(name: string): RateLimitPolicy | undefined {
  return RATE_LIMIT_POLICIES[name];
}

/**
 * Create a custom policy
 */
export function createPolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    ...policy,
    name: policy.name,
  };
}
