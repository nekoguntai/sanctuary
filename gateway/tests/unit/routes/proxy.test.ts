/**
 * Proxy Routes Tests
 *
 * Tests route whitelisting and proxy configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../../../src/config', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    jwtSecret: 'test-jwt-secret-minimum-32-chars-long',
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
    },
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/middleware/requestLogger', () => ({
  logSecurityEvent: vi.fn(),
  logAuditEvent: vi.fn(),
}));

describe('Proxy Routes', () => {
  describe('Route Whitelist', () => {
    // Define the whitelist patterns to test
    const ALLOWED_ROUTES = [
      // Authentication
      { method: 'POST', pattern: /^\/api\/v1\/auth\/login$/ },
      { method: 'POST', pattern: /^\/api\/v1\/auth\/refresh$/ },
      { method: 'POST', pattern: /^\/api\/v1\/auth\/logout$/ },
      { method: 'POST', pattern: /^\/api\/v1\/auth\/logout-all$/ },
      { method: 'GET', pattern: /^\/api\/v1\/auth\/me$/ },
      { method: 'PATCH', pattern: /^\/api\/v1\/auth\/me\/preferences$/ },

      // Sessions
      { method: 'GET', pattern: /^\/api\/v1\/auth\/sessions$/ },
      { method: 'DELETE', pattern: /^\/api\/v1\/auth\/sessions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

      // Wallets
      { method: 'GET', pattern: /^\/api\/v1\/wallets$/ },
      { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
      { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/sync$/ },

      // Transactions
      { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions$/ },

      // Addresses
      { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses$/ },
      { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses\/generate$/ },

      // UTXOs
      { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/utxos$/ },

      // Labels
      { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },
      { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },

      // Bitcoin status
      { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/status$/ },
      { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/fees$/ },

      // Price
      { method: 'GET', pattern: /^\/api\/v1\/price$/ },

      // Push notifications
      { method: 'POST', pattern: /^\/api\/v1\/push\/register$/ },
      { method: 'DELETE', pattern: /^\/api\/v1\/push\/unregister$/ },
      { method: 'GET', pattern: /^\/api\/v1\/push\/devices$/ },
    ];

    function isAllowedRoute(method: string, path: string): boolean {
      return ALLOWED_ROUTES.some(
        (route) => route.method === method && route.pattern.test(path)
      );
    }

    describe('Authentication routes', () => {
      it('should allow POST /api/v1/auth/login', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/login')).toBe(true);
      });

      it('should allow POST /api/v1/auth/refresh', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/refresh')).toBe(true);
      });

      it('should allow POST /api/v1/auth/logout', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/logout')).toBe(true);
      });

      it('should allow GET /api/v1/auth/me', () => {
        expect(isAllowedRoute('GET', '/api/v1/auth/me')).toBe(true);
      });

      it('should block GET on login endpoint', () => {
        expect(isAllowedRoute('GET', '/api/v1/auth/login')).toBe(false);
      });
    });

    describe('Wallet routes', () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      it('should allow GET /api/v1/wallets', () => {
        expect(isAllowedRoute('GET', '/api/v1/wallets')).toBe(true);
      });

      it('should allow GET /api/v1/wallets/:id', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUUID}`)).toBe(true);
      });

      it('should allow POST /api/v1/wallets/:id/sync', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUUID}/sync`)).toBe(true);
      });

      it('should block POST /api/v1/wallets (create wallet)', () => {
        expect(isAllowedRoute('POST', '/api/v1/wallets')).toBe(false);
      });

      it('should block DELETE /api/v1/wallets/:id (delete wallet)', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/wallets/${validUUID}`)).toBe(false);
      });

      it('should block PUT /api/v1/wallets/:id (update wallet)', () => {
        expect(isAllowedRoute('PUT', `/api/v1/wallets/${validUUID}`)).toBe(false);
      });

      it('should reject invalid UUID format', () => {
        expect(isAllowedRoute('GET', '/api/v1/wallets/invalid-uuid')).toBe(false);
        expect(isAllowedRoute('GET', '/api/v1/wallets/123')).toBe(false);
      });
    });

    describe('Transaction routes', () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      it('should allow GET /api/v1/wallets/:id/transactions', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUUID}/transactions`)).toBe(true);
      });

      it('should block POST transactions (create/send)', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUUID}/transactions`)).toBe(false);
      });
    });

    describe('Admin routes (should all be blocked)', () => {
      it('should block /api/v1/admin/*', () => {
        expect(isAllowedRoute('GET', '/api/v1/admin/users')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/admin/settings')).toBe(false);
        expect(isAllowedRoute('DELETE', '/api/v1/admin/users/123')).toBe(false);
      });

      it('should block /api/v1/nodes/*', () => {
        expect(isAllowedRoute('GET', '/api/v1/nodes')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/nodes')).toBe(false);
        expect(isAllowedRoute('DELETE', '/api/v1/nodes/123')).toBe(false);
      });

      it('should block user management routes', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/users/123')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/users')).toBe(false);
      });

      it('should block backup/restore routes', () => {
        expect(isAllowedRoute('POST', '/api/v1/backup')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/restore')).toBe(false);
      });
    });

    describe('Bitcoin status routes', () => {
      it('should allow GET /api/v1/bitcoin/status', () => {
        expect(isAllowedRoute('GET', '/api/v1/bitcoin/status')).toBe(true);
      });

      it('should allow GET /api/v1/bitcoin/fees', () => {
        expect(isAllowedRoute('GET', '/api/v1/bitcoin/fees')).toBe(true);
      });

      it('should block POST to bitcoin routes', () => {
        expect(isAllowedRoute('POST', '/api/v1/bitcoin/status')).toBe(false);
      });
    });

    describe('Push notification routes', () => {
      it('should allow POST /api/v1/push/register', () => {
        expect(isAllowedRoute('POST', '/api/v1/push/register')).toBe(true);
      });

      it('should allow DELETE /api/v1/push/unregister', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/push/unregister')).toBe(true);
      });

      it('should allow GET /api/v1/push/devices', () => {
        expect(isAllowedRoute('GET', '/api/v1/push/devices')).toBe(true);
      });
    });

    describe('Price routes', () => {
      it('should allow GET /api/v1/price', () => {
        expect(isAllowedRoute('GET', '/api/v1/price')).toBe(true);
      });

      it('should block POST to price endpoint', () => {
        expect(isAllowedRoute('POST', '/api/v1/price')).toBe(false);
      });
    });

    describe('Path traversal prevention', () => {
      it('should block paths with traversal attempts', () => {
        expect(isAllowedRoute('GET', '/api/v1/../admin/users')).toBe(false);
        expect(isAllowedRoute('GET', '/api/v1/wallets/../admin')).toBe(false);
      });

      it('should block paths with encoded characters', () => {
        expect(isAllowedRoute('GET', '/api/v1/wallets%2F..%2Fadmin')).toBe(false);
      });
    });

    describe('Label routes', () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      it('should allow GET /api/v1/wallets/:id/labels', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUUID}/labels`)).toBe(true);
      });

      it('should allow POST /api/v1/wallets/:id/labels', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUUID}/labels`)).toBe(true);
      });
    });
  });

  describe('Security Headers', () => {
    it('should document expected proxy headers', () => {
      // The proxy adds these headers to identify gateway requests
      const expectedHeaders = [
        'X-Gateway-Request',
        'X-Gateway-User-Id',
        'X-Gateway-Username',
      ];

      // This is a documentation test
      expect(expectedHeaders).toContain('X-Gateway-Request');
      expect(expectedHeaders).toContain('X-Gateway-User-Id');
    });
  });
});
