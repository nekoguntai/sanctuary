/**
 * Rate Limiting Middleware
 *
 * Protects the gateway from abuse with configurable rate limits.
 * All rate limit violations are logged as security events for auditing.
 *
 * ## Rate Limit Tiers
 *
 * 1. **Default** (60/min) - Normal API requests
 * 2. **Strict** (10/hour) - Sensitive operations like device registration
 * 3. **Auth** (5/15min) - Login attempts to prevent brute force
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
 * Default rate limiter - applies to all authenticated routes
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
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      tier: 'default',
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
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
 * Auth rate limiter - for login attempts (very strict)
 *
 * SECURITY: This is critical for preventing brute force attacks.
 * Monitor logs for repeated violations from the same IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (req, res) => {
    logSecurityEvent('AUTH_RATE_LIMIT_EXCEEDED', {
      tier: 'auth',
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
      // This is a potential brute force attack
      severity: 'high',
    });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: 900,
    });
  },
});
