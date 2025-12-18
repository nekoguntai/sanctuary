/**
 * Rate Limiting Middleware
 *
 * Protects the gateway from abuse with configurable rate limits.
 */

import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import { AuthenticatedRequest } from './auth';

const log = createLogger('RATE_LIMIT');

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
    log.warn('Rate limit exceeded', {
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
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
    log.warn('Strict rate limit exceeded', {
      userId: authReq.user?.userId,
      ip: req.ip,
      path: req.path,
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
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (req, res) => {
    log.warn('Auth rate limit exceeded', { ip: req.ip });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many login attempts. Please try again in 15 minutes.',
      retryAfter: 900,
    });
  },
});
