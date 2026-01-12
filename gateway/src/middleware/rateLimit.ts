/**
 * Rate Limiting Middleware
 *
 * Protects the gateway from abuse with configurable rate limits.
 * All rate limit violations are logged as security events for auditing.
 *
 * ## Rate Limit Tiers
 *
 * 1. **Default** (60/min) - Normal API requests with exponential backoff
 * 2. **Strict** (10/hour) - Sensitive operations like device registration
 * 3. **Auth** (15/15min) - Login attempts to prevent brute force
 *
 * ## Exponential Backoff
 *
 * When rate limited, the retry-after time doubles with each subsequent violation:
 * - 1st violation: 60 seconds
 * - 2nd violation: 120 seconds
 * - 3rd violation: 240 seconds
 * - ... up to max of 3600 seconds (1 hour)
 *
 * Backoff state resets after successful request or window expiry.
 *
 * ## Security Logging
 *
 * Rate limit violations are logged with:
 * - Client IP address
 * - User ID (if authenticated)
 * - Endpoint that was rate limited
 * - User agent
 *
 * These logs should be monitored for:
 * - Brute force attacks (repeated auth rate limits)
 * - API abuse (repeated default rate limits)
 * - Automated scanning (many different endpoints hit)
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logSecurityEvent } from './requestLogger';
import { AuthenticatedRequest } from './auth';

/**
 * Exponential backoff tracker for rate-limited clients
 * Maps client key to { violations: number, lastViolation: timestamp }
 */
const backoffTracker = new Map<string, { violations: number; lastViolation: number }>();

/**
 * Calculate exponential backoff retry-after time
 */
function calculateBackoff(key: string): number {
  const { baseRetryAfter, maxRetryAfter, multiplier } = config.rateLimit.backoff;
  const tracker = backoffTracker.get(key);

  if (!tracker) {
    // First violation
    backoffTracker.set(key, { violations: 1, lastViolation: Date.now() });
    return baseRetryAfter;
  }

  // Check if previous violation has expired (reset after window + retry period)
  const windowMs = config.rateLimit.windowMs;
  if (Date.now() - tracker.lastViolation > windowMs + tracker.violations * baseRetryAfter * 1000) {
    // Reset backoff
    backoffTracker.set(key, { violations: 1, lastViolation: Date.now() });
    return baseRetryAfter;
  }

  // Increment violations and calculate backoff
  tracker.violations++;
  tracker.lastViolation = Date.now();

  const retryAfter = Math.min(
    baseRetryAfter * Math.pow(multiplier, tracker.violations - 1),
    maxRetryAfter
  );

  return Math.ceil(retryAfter);
}

/**
 * Reset backoff for a client (call on successful request after rate limit)
 */
export function resetBackoff(key: string): void {
  backoffTracker.delete(key);
}

/**
 * Clean up old backoff entries (call periodically)
 */
export function cleanupBackoffTracker(): void {
  const maxAge = config.rateLimit.windowMs * 2; // Clean entries older than 2x window
  const now = Date.now();

  for (const [key, tracker] of backoffTracker.entries()) {
    if (now - tracker.lastViolation > maxAge) {
      backoffTracker.delete(key);
    }
  }
}

/**
 * Default rate limiter - applies to all authenticated routes
 * Uses exponential backoff: retry-after doubles with each violation
 */
export const defaultRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const key = authReq.user?.userId || req.ip || 'unknown';
    const retryAfter = calculateBackoff(key);

    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'default',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      retryAfter,
      backoffViolations: backoffTracker.get(key)?.violations || 1,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
      retryAfter,
    });
  },
});

/**
 * Strict rate limiter - for sensitive operations like device registration
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'strict',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many attempts. Please try again later.',
      retryAfter: 3600,
    });
  },
});

/**
 * Auth rate limiter - for login attempts
 * Uses exponential backoff: retry-after doubles with each violation
 *
 * SECURITY: This is critical for preventing brute force attacks.
 * Monitor logs for repeated violations from the same IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (req, res) => {
    const key = `auth:${req.ip || 'unknown'}`;
    const retryAfter = calculateBackoff(key);

    logSecurityEvent('AUTH_RATE_LIMIT_EXCEEDED', {
      tier: 'auth',
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      retryAfter,
      backoffViolations: backoffTracker.get(key)?.violations || 1,
      // This is a potential brute force attack
      severity: 'high',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Too many login attempts. Please try again in ${retryAfter} seconds.`,
      retryAfter,
    });
  },
});

// =============================================================================
// Mobile-Specific Rate Limiters
// =============================================================================

/**
 * Transaction creation rate limiter
 *
 * Limits transaction creation/estimation to prevent abuse.
 * Mobile users can create up to 10 transactions per minute.
 */
export const transactionCreateRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 transactions per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'transaction_create',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      severity: 'medium',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Transaction creation rate limit exceeded (10/min). Please try again later.',
      retryAfter: 60,
    });
  },
});

/**
 * Transaction broadcast rate limiter
 *
 * Strictly limits broadcasting to prevent abuse and costly chain spam.
 * Mobile users can broadcast up to 5 transactions per minute.
 */
export const broadcastRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 broadcasts per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'broadcast',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      severity: 'high',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Broadcast rate limit exceeded (5/min). Please try again later.',
      retryAfter: 60,
    });
  },
});

/**
 * Device registration rate limiter
 *
 * Very strict limit on device registration to prevent abuse.
 * Users can only register 3 new push notification devices per hour.
 */
export const deviceRegistrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 device registrations per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'device_registration',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      severity: 'medium',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Device registration rate limit exceeded (3/hr). Please try again later.',
      retryAfter: 3600,
    });
  },
});

/**
 * Address generation rate limiter
 *
 * Limits address generation to prevent address exhaustion attacks.
 * Mobile users can generate up to 20 addresses per minute.
 */
export const addressGenerationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 addresses per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.userId || req.ip || 'unknown';
  },
  handler: (req, res) => {
    const authReq = req as AuthenticatedRequest;
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'address_generation',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      severity: 'low',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Address generation rate limit exceeded (20/min). Please try again later.',
      retryAfter: 60,
    });
  },
});
