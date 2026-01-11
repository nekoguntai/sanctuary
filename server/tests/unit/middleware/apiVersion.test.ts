/**
 * API Versioning Middleware Tests
 *
 * Tests version parsing from headers, query params, and URLs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  apiVersionMiddleware,
  requireApiVersion,
  maxApiVersion,
  isApiVersion,
  isApiVersionAtLeast,
} from '../../../src/middleware/apiVersion';

describe('API Version Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let setHeaderMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    setHeaderMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      headers: {},
      query: {},
      path: '/api/v1/test',
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
    };

    mockNext = vi.fn();
  });

  describe('apiVersionMiddleware', () => {
    describe('version parsing precedence', () => {
      it('should use default version when no version specified', () => {
        const middleware = apiVersionMiddleware({ defaultVersion: 1 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 1, minor: 0 });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should parse version from Accept header', () => {
        mockReq.headers = { accept: 'application/vnd.sanctuary.v2+json' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version with minor from Accept header', () => {
        mockReq.headers = { accept: 'application/vnd.sanctuary.v2.1+json' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 1 });
      });

      it('should parse version from X-API-Version header', () => {
        mockReq.headers = { 'x-api-version': '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version with minor from X-API-Version header', () => {
        mockReq.headers = { 'x-api-version': '2.3' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 3 });
      });

      it('should parse version from query parameter', () => {
        mockReq.query = { api_version: '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version from URL path', () => {
        mockReq.path = '/api/v2/wallets';
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should prefer Accept header over X-API-Version', () => {
        mockReq.headers = {
          accept: 'application/vnd.sanctuary.v3+json',
          'x-api-version': '2',
        };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion.major).toBe(3);
      });

      it('should prefer X-API-Version over query parameter', () => {
        mockReq.headers = { 'x-api-version': '3' };
        mockReq.query = { api_version: '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect((mockReq as Request).apiVersion.major).toBe(3);
      });
    });

    describe('version validation', () => {
      it('should reject version below minimum', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({ minVersion: 2, currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unsupported API Version',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject version above current', () => {
        mockReq.headers = { 'x-api-version': '5' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unknown API Version',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('response headers', () => {
      it('should set X-API-Version header', () => {
        const middleware = apiVersionMiddleware();

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Version', '1.0');
      });

      it('should set X-API-Current-Version header', () => {
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Current-Version', '3');
      });

      it('should set deprecation warning for deprecated versions', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({
          deprecatedVersions: [1],
          currentVersion: 2,
        });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Deprecated', 'true');
        expect(setHeaderMock).toHaveBeenCalledWith(
          'Warning',
          expect.stringContaining('deprecated')
        );
      });

      it('should set sunset header for sunset versions', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({
          sunsetVersions: [{ version: 1, date: '2025-01-01' }],
          currentVersion: 2,
        });

        middleware(mockReq as Request, mockRes as Response, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('Sunset', expect.any(String));
      });
    });
  });

  describe('requireApiVersion', () => {
    it('should pass when version meets requirement', () => {
      (mockReq as Request).apiVersion = { major: 2, minor: 0 };
      const middleware = requireApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should pass when version exceeds requirement', () => {
      (mockReq as Request).apiVersion = { major: 3, minor: 0 };
      const middleware = requireApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when major version is too low', () => {
      (mockReq as Request).apiVersion = { major: 1, minor: 5 };
      const middleware = requireApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'API Version Too Low',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should check minor version when major matches', () => {
      (mockReq as Request).apiVersion = { major: 2, minor: 0 };
      const middleware = requireApiVersion(2, 1);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass when minor version meets requirement', () => {
      (mockReq as Request).apiVersion = { major: 2, minor: 1 };
      const middleware = requireApiVersion(2, 1);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('maxApiVersion', () => {
    it('should pass when version is below max', () => {
      (mockReq as Request).apiVersion = { major: 1, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass when version equals max', () => {
      (mockReq as Request).apiVersion = { major: 2, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when version exceeds max', () => {
      (mockReq as Request).apiVersion = { major: 3, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(410);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Endpoint Removed',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('helper functions', () => {
    describe('isApiVersion', () => {
      it('should return true for exact major match', () => {
        (mockReq as Request).apiVersion = { major: 2, minor: 0 };

        expect(isApiVersion(mockReq as Request, 2)).toBe(true);
      });

      it('should return true when minor is equal or higher', () => {
        (mockReq as Request).apiVersion = { major: 2, minor: 3 };

        expect(isApiVersion(mockReq as Request, 2, 1)).toBe(true);
        expect(isApiVersion(mockReq as Request, 2, 3)).toBe(true);
      });

      it('should return false for different major', () => {
        (mockReq as Request).apiVersion = { major: 2, minor: 0 };

        expect(isApiVersion(mockReq as Request, 1)).toBe(false);
        expect(isApiVersion(mockReq as Request, 3)).toBe(false);
      });
    });

    describe('isApiVersionAtLeast', () => {
      it('should return true when version exceeds requirement', () => {
        (mockReq as Request).apiVersion = { major: 3, minor: 0 };

        expect(isApiVersionAtLeast(mockReq as Request, 2)).toBe(true);
      });

      it('should return true when version equals requirement', () => {
        (mockReq as Request).apiVersion = { major: 2, minor: 1 };

        expect(isApiVersionAtLeast(mockReq as Request, 2, 1)).toBe(true);
      });

      it('should return false when version is below requirement', () => {
        (mockReq as Request).apiVersion = { major: 2, minor: 0 };

        expect(isApiVersionAtLeast(mockReq as Request, 2, 1)).toBe(false);
        expect(isApiVersionAtLeast(mockReq as Request, 3)).toBe(false);
      });
    });
  });
});
