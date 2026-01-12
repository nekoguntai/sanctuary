/**
 * Auth API Routes
 *
 * Authentication, authorization, and user management endpoints
 *
 * Route domains extracted to ./auth/ subdirectory:
 * - login.ts      - Registration status, register, login (public)
 * - profile.ts    - User profile and preferences
 * - password.ts   - Password change
 * - twoFactor.ts  - 2FA setup, verification, backup codes
 * - telegram.ts   - Telegram notification integration
 * - tokens.ts     - Token refresh, logout
 * - sessions.ts   - Session management
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';

// Domain routers
import { createLoginRouter } from './auth/login';
import profileRouter from './auth/profile';
import { createPasswordRouter } from './auth/password';
import { createTwoFactorRouter } from './auth/twoFactor';
import telegramRouter from './auth/telegram';
import tokensRouter from './auth/tokens';
import sessionsRouter from './auth/sessions';

const router = Router();

// ========================================
// RATE LIMITERS (centralized configuration)
// ========================================

// Express app has trust proxy enabled; disable all validations (we know our proxy setup is correct)
// This suppresses the IPv6 warnings when running behind nginx
const rateLimitValidations = false;

// Rate limit can be configured via environment variable for testing
// Default: 5 attempts per 15 minutes (production)
// Set LOGIN_RATE_LIMIT=100 for testing environments
const loginRateLimit = parseInt(process.env.LOGIN_RATE_LIMIT || '5', 10);

// Strict limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: loginRateLimit,
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
  keyGenerator: (req) => {
    // Use IP + username combination to prevent targeted attacks
    const username = req.body?.username?.toLowerCase() || 'unknown';
    return `${req.ip}-${username}`;
  },
});

// Limiter for registration (10 attempts per hour per IP)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: {
    error: 'Too Many Requests',
    message: 'Too many registration attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
});

// Limiter for 2FA verification (10 attempts per 15 minutes)
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  message: {
    error: 'Too Many Requests',
    message: 'Too many 2FA attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
});

// Password change rate limit can be configured via environment variable for testing
// Default: 5 attempts per 15 minutes (production)
// Set PASSWORD_CHANGE_RATE_LIMIT=100 for testing environments
const passwordChangeRateLimit = parseInt(process.env.PASSWORD_CHANGE_RATE_LIMIT || '5', 10);

// Limiter for password change
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: passwordChangeRateLimit,
  message: {
    error: 'Too Many Requests',
    message: 'Too many password change attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidations,
});

// ========================================
// ROUTE CONFIGURATION
// ========================================

// Public routes (no auth required)
// Login router handles: /registration-status, /register, /login
router.use('/', createLoginRouter(loginLimiter, registerLimiter));

// Token management (partially public - /refresh doesn't need auth, but logout* do)
router.use('/', tokensRouter);

// 2FA routes - mixed auth requirements:
// - /2fa/verify uses temp token (rate-limited, no auth middleware)
// - Other 2FA routes require authentication
router.use('/', createTwoFactorRouter(twoFactorLimiter));

// Protected routes (require authentication)
router.use('/', authenticate, profileRouter);
router.use('/', authenticate, createPasswordRouter(passwordChangeLimiter));
router.use('/', authenticate, telegramRouter);
router.use('/', authenticate, sessionsRouter);

export default router;
