import { vi, Mock } from 'vitest';
/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting middleware behavior, especially fail-closed on errors.
 */

// Unmock the rate limit middleware to test the real implementation
// (global setup.ts mocks it to bypass Redis in other tests)
vi.unmock('../../../src/middleware/rateLimit');

import { Request, Response, NextFunction } from 'express';
import { rateLimit, rateLimitByUser, rateLimitByIpAndKey, rateLimitByKey } from '../../../src/middleware/rateLimit';
import { rateLimitService } from '../../../src/services/rateLimiting';

// Mock the rate limit service
vi.mock('../../../src/services/rateLimiting', () => ({
  rateLimitService: {
    consume: vi.fn(),
    getPolicy: vi.fn().mockReturnValue({ message: 'Rate limit exceeded' }),
  },
}));

// Mock logger to avoid console output during tests
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Rate Limit Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: Mock;
  let setHeaderMock: Mock;
  let statusMock: Mock;

  beforeEach(() => {
    jsonMock = vi.fn();
    setHeaderMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
      body: {},
    };

    mockRes = {
      setHeader: setHeaderMock,
      status: statusMock,
      json: jsonMock,
    };

    mockNext = vi.fn();

    vi.clearAllMocks();
  });

  describe('rateLimit (by IP)', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should block request when rate limit is exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(429);
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });
  });

  describe('rateLimitByUser', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      (mockReq as any).user = { userId: 'user-123' };

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'user:user-123');
    });

    it('should fall back to IP when no user ID', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:127.0.0.1');
    });

    it('should return 503 when rate limit service throws error (fail-closed) - with user', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));
      (mockReq as any).user = { userId: 'user-123' };

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });

    it('should return 503 when rate limit service throws error (fail-closed) - IP fallback', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
    });
  });

  describe('rateLimitByIpAndKey', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      mockReq.body = { username: 'testuser' };

      const middleware = rateLimitByIpAndKey('test-policy', (req) => req.body?.username);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', '127.0.0.1:testuser');
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByIpAndKey('test-policy', (req) => req.body?.username);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
    });
  });

  describe('rateLimitByKey', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimitByKey('test-policy', () => 'custom-key');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'custom-key');
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByKey('test-policy', () => 'custom-key');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });
  });

  describe('Rate limit headers', () => {
    it('should set rate limit headers on successful request', async () => {
      const resetAt = Date.now() + 60000;
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    });

    it('should set Retry-After header when rate limited', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', 60);
    });
  });
});
