/**
 * Proxy Routes
 *
 * This is the heart of the gateway's security model. Only routes explicitly
 * listed in ALLOWED_ROUTES are proxied to the backend. Everything else is blocked.
 *
 * ## Why Whitelist Instead of Blacklist?
 *
 * A whitelist approach is more secure because:
 * - New endpoints aren't accidentally exposed
 * - Admin/sensitive routes are blocked by default
 * - We explicitly choose what mobile apps can access
 *
 * ## How It Works
 *
 * 1. Request comes in from mobile app
 * 2. `checkWhitelist` middleware checks if route matches ALLOWED_ROUTES
 * 3. If not matched, return 403 Forbidden
 * 4. If matched, proxy to backend with extra headers
 *
 * ## Proxy Headers
 *
 * The proxy adds these headers to backend requests:
 * - `X-Gateway-Request: true` - Identifies request as coming from gateway
 * - `X-Gateway-User-Id` - Authenticated user's ID
 * - `X-Gateway-Username` - Authenticated user's username
 *
 * ## Adding New Routes
 *
 * To expose a new endpoint to mobile apps:
 * 1. Add pattern to ALLOWED_ROUTES array below
 * 2. Use regex to match dynamic segments (e.g., `[a-f0-9-]+` for UUIDs)
 * 3. Consider security implications before adding
 *
 * ## Routes NOT to Expose
 *
 * - Admin routes (`/api/v1/admin/*`)
 * - User management (`DELETE /api/v1/users/*`)
 * - Node configuration (`/api/v1/nodes/*`)
 * - Backup/restore operations
 * - Internal gateway endpoints
 */

import { Router, Request, Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { config } from '../config';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import {
  defaultRateLimiter,
  transactionCreateRateLimiter,
  broadcastRateLimiter,
  deviceRegistrationRateLimiter,
  addressGenerationRateLimiter,
} from '../middleware/rateLimit';
import { validateRequest } from '../middleware/validateRequest';
import { requireMobilePermission } from '../middleware/mobilePermission';
import { createLogger } from '../utils/logger';
import { logSecurityEvent } from '../middleware/requestLogger';

const log = createLogger('PROXY');
const router = Router();

/**
 * Whitelist of allowed API routes
 *
 * Format: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: RegExp }
 *
 * SECURITY: Only add routes that are safe for mobile app access.
 * Admin routes and sensitive operations should NOT be exposed.
 */
const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  // Authentication
  { method: 'POST', pattern: /^\/api\/v1\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/refresh$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/logout$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/logout-all$/ },
  { method: 'GET', pattern: /^\/api\/v1\/auth\/me$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/auth\/me\/preferences$/ },

  // Session management
  { method: 'GET', pattern: /^\/api\/v1\/auth\/sessions$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/auth\/sessions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Wallets (read-only + sync)
  { method: 'GET', pattern: /^\/api\/v1\/wallets$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/sync$/ },

  // Transactions (read-only)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Addresses (read-only + generate)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses\/generate$/ },

  // UTXOs (read-only)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/utxos$/ },

  // Labels (read + write)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/labels\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/labels\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Bitcoin status
  { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/status$/ },
  { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/fees$/ },

  // Price
  { method: 'GET', pattern: /^\/api\/v1\/price$/ },

  // Pending transactions
  { method: 'GET', pattern: /^\/api\/v1\/transactions\/pending$/ },

  // Push notifications (device registration)
  { method: 'POST', pattern: /^\/api\/v1\/push\/register$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/push\/unregister$/ },
  { method: 'GET', pattern: /^\/api\/v1\/push\/devices$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/push\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Transaction building & broadcasting
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/create$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/estimate$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/broadcast$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/psbt\/create$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/psbt\/broadcast$/ },

  // Hardware wallet device management
  { method: 'GET', pattern: /^\/api\/v1\/devices$/ },
  { method: 'POST', pattern: /^\/api\/v1\/devices$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Draft transactions (multisig)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/sign$/ },

  // Mobile permissions
  { method: 'GET', pattern: /^\/api\/v1\/mobile-permissions$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/caps$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
];

/**
 * Check if a request matches the whitelist
 * Exported for testing
 */
export function isAllowedRoute(method: string, path: string): boolean {
  return ALLOWED_ROUTES.some(
    (route) => route.method === method && route.pattern.test(path)
  );
}

// Export for testing
export { ALLOWED_ROUTES };

/**
 * Middleware to check if route is whitelisted
 *
 * SECURITY: Blocked routes are logged as security events.
 * Repeated attempts to access non-whitelisted routes may indicate
 * reconnaissance or an attempt to find vulnerabilities.
 *
 * Exported for testing
 */
export function checkWhitelist(req: Request, res: Response, next: () => void): void {
  const { method, path } = req;
  const authReq = req as AuthenticatedRequest;

  if (!isAllowedRoute(method, path)) {
    logSecurityEvent('ROUTE_BLOCKED', {
      method,
      path,
      ip: req.ip,
      userId: authReq.user?.userId,
      userAgent: req.headers['user-agent'],
      // Could indicate probing for vulnerabilities
      severity: 'low',
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint is not available via the mobile API',
    });
    return;
  }

  next();
}

/**
 * Proxy configuration
 */
const proxyOptions: Options = {
  target: config.backendUrl,
  changeOrigin: true,
  logLevel: 'silent',
  onProxyReq: (proxyReq, req) => {
    const authReq = req as AuthenticatedRequest;

    // Forward user info to backend
    if (authReq.user) {
      proxyReq.setHeader('X-Gateway-User-Id', authReq.user.userId);
      proxyReq.setHeader('X-Gateway-Username', authReq.user.username);
    }

    // Mark request as coming from gateway
    proxyReq.setHeader('X-Gateway-Request', 'true');

    log.debug('Proxying request', {
      method: req.method,
      path: req.path,
      userId: authReq.user?.userId,
    });
  },
  onProxyRes: (proxyRes, req) => {
    log.debug('Proxy response', {
      method: req.method,
      path: req.path,
      status: proxyRes.statusCode,
    });
  },
  onError: (err, req, res) => {
    log.error('Proxy error', { error: err.message, path: req.path });
    (res as Response).status(502).json({
      error: 'Bad Gateway',
      message: 'Unable to reach backend service',
    });
  },
};

// Create proxy middleware
const proxy = createProxyMiddleware(proxyOptions);

// Public routes (no auth required)
router.post('/api/v1/auth/login', checkWhitelist, validateRequest, proxy);
router.post('/api/v1/auth/refresh', checkWhitelist, validateRequest, proxy);

// =============================================================================
// Protected routes with mobile permission checks
// =============================================================================

// Transaction operations
router.post(
  '/api/v1/wallets/:id/transactions/create',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/transactions/estimate',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/transactions/broadcast',
  authenticate,
  broadcastRateLimiter,
  checkWhitelist,
  requireMobilePermission('broadcast'),
  validateRequest,
  proxy
);

// PSBT operations
router.post(
  '/api/v1/wallets/:id/psbt/create',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/psbt/broadcast',
  authenticate,
  broadcastRateLimiter,
  checkWhitelist,
  requireMobilePermission('broadcast'),
  validateRequest,
  proxy
);

// Address generation
router.post(
  '/api/v1/wallets/:id/addresses/generate',
  authenticate,
  addressGenerationRateLimiter,
  checkWhitelist,
  requireMobilePermission('generateAddress'),
  validateRequest,
  proxy
);

// Label management (create - has walletId in path)
router.post(
  '/api/v1/wallets/:id/labels',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('manageLabels'),
  validateRequest,
  proxy
);

// Note: PATCH/DELETE /api/v1/labels/:id routes don't have walletId in path.
// Permission checking for these is handled by the backend after looking up
// which wallet the label belongs to.

// Note: Device management routes (/api/v1/devices) are user-scoped, not wallet-scoped,
// so they don't use mobile permission middleware. Access control is handled by the
// backend based on user authentication.

// Push notification device registration (strict rate limit)
router.post(
  '/api/v1/push/register',
  authenticate,
  deviceRegistrationRateLimiter,
  checkWhitelist,
  validateRequest,
  proxy
);

// Draft signing (multisig)
router.post(
  '/api/v1/wallets/:id/drafts/:draftId/sign',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('signPsbt'),
  validateRequest,
  proxy
);

// =============================================================================
// Protected routes (general - no special permission checks)
// =============================================================================

router.use(
  '/api/v1',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  validateRequest,
  proxy
);

export default router;
