/**
 * API Response Utilities Tests
 *
 * Tests for standardized API response formatting including:
 * - Success responses
 * - Created responses
 * - No content responses
 * - Paginated responses
 * - Accepted responses
 * - Pagination parameter parsing
 * - Pagination calculation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock request context
const mockRequestContext = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue({
    requestId: 'test-request-123',
    startTime: Date.now() - 100, // 100ms ago
  }),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: mockRequestContext,
}));

import {
  success,
  created,
  noContent,
  paginated,
  accepted,
  parsePaginationParams,
  calculatePagination,
  PAGINATION_DEFAULTS,
} from '../../../src/utils/apiResponse';

describe('API Response Utilities', () => {
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      req: {
        apiVersion: { major: 1, minor: 0 },
      },
    };
  });

  describe('success', () => {
    it('should send success response with data', () => {
      const data = { id: '123', name: 'Test Wallet' };

      success(res, data);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data,
        meta: expect.objectContaining({
          requestId: 'test-request-123',
          apiVersion: '1.0',
        }),
      });
    });

    it('should allow custom status code', () => {
      success(res, { ok: true }, 200);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should include processing time in meta', () => {
      success(res, {});

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            processingTimeMs: expect.any(Number),
          }),
        })
      );
    });

    it('should handle missing request context', () => {
      mockRequestContext.get.mockReturnValueOnce(null);

      success(res, { test: true });

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { test: true },
        meta: expect.objectContaining({
          apiVersion: '1.0',
        }),
      });
    });
  });

  describe('created', () => {
    it('should send 201 response with data', () => {
      const data = { id: 'new-123', name: 'New Resource' };

      created(res, data);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data,
        meta: expect.any(Object),
      });
    });

    it('should set Location header when provided', () => {
      const data = { id: 'new-123' };
      const location = '/api/v1/wallets/new-123';

      created(res, data, location);

      expect(res.setHeader).toHaveBeenCalledWith('Location', location);
    });

    it('should not set Location header when not provided', () => {
      created(res, { id: 'new-123' });

      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('noContent', () => {
    it('should send 204 response', () => {
      noContent(res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('paginated', () => {
    it('should send paginated response with items', () => {
      const items = [{ id: '1' }, { id: '2' }];

      paginated(res, items, { page: 1, pageSize: 20, total: 50 });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: items,
        pagination: {
          page: 1,
          pageSize: 20,
          total: 50,
          totalPages: 3,
          hasNext: true,
          hasPrev: false,
        },
        meta: expect.any(Object),
      });
    });

    it('should calculate hasNext correctly', () => {
      paginated(res, [], { page: 3, pageSize: 20, total: 50 });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({
            hasNext: false, // Page 3 is last (50/20 = 2.5, ceil = 3)
          }),
        })
      );
    });

    it('should calculate hasPrev correctly', () => {
      paginated(res, [], { page: 2, pageSize: 10, total: 30 });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({
            hasPrev: true,
          }),
        })
      );
    });

    it('should handle single page result', () => {
      paginated(res, [{ id: '1' }], { page: 1, pageSize: 20, total: 1 });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: {
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        })
      );
    });

    it('should handle empty result', () => {
      paginated(res, [], { page: 1, pageSize: 20, total: 0 });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          },
        })
      );
    });
  });

  describe('accepted', () => {
    it('should send 202 response for async operations', () => {
      const data = { jobId: 'job-123', status: 'queued' };

      accepted(res, data);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data,
        meta: expect.any(Object),
      });
    });
  });

  describe('parsePaginationParams', () => {
    describe('page/pageSize format', () => {
      it('should parse valid page and pageSize', () => {
        const result = parsePaginationParams({ page: '2', pageSize: '25' });

        expect(result).toEqual({
          page: 2,
          pageSize: 25,
          skip: 25, // (2-1) * 25
          take: 25,
        });
      });

      it('should use defaults when only page provided', () => {
        const result = parsePaginationParams({ page: '3' });

        expect(result).toEqual({
          page: 3,
          pageSize: PAGINATION_DEFAULTS.pageSize,
          skip: 40, // (3-1) * 20
          take: 20,
        });
      });

      it('should use defaults when only pageSize provided', () => {
        const result = parsePaginationParams({ pageSize: '50' });

        expect(result).toEqual({
          page: 1,
          pageSize: 50,
          skip: 0,
          take: 50,
        });
      });

      it('should enforce maxPageSize limit', () => {
        const result = parsePaginationParams({ pageSize: '500' });

        expect(result.pageSize).toBe(PAGINATION_DEFAULTS.maxPageSize);
        expect(result.take).toBe(PAGINATION_DEFAULTS.maxPageSize);
      });

      it('should enforce minimum page of 1', () => {
        const result = parsePaginationParams({ page: '0' });

        expect(result.page).toBe(1);
      });

      it('should enforce minimum page of 1 for negative values', () => {
        const result = parsePaginationParams({ page: '-5' });

        expect(result.page).toBe(1);
      });

      it('should enforce minimum pageSize of 1', () => {
        const result = parsePaginationParams({ pageSize: '0' });

        expect(result.pageSize).toBe(PAGINATION_DEFAULTS.pageSize);
      });
    });

    describe('limit/offset format (legacy)', () => {
      it('should parse valid limit and offset', () => {
        const result = parsePaginationParams({ limit: '25', offset: '50' });

        expect(result).toEqual({
          page: 3, // floor(50/25) + 1
          pageSize: 25,
          skip: 50,
          take: 25,
        });
      });

      it('should use defaults when only limit provided', () => {
        const result = parsePaginationParams({ limit: '10' });

        expect(result).toEqual({
          page: 1,
          pageSize: 10,
          skip: 0,
          take: 10,
        });
      });

      it('should use defaults when only offset provided', () => {
        const result = parsePaginationParams({ offset: '20' });

        expect(result).toEqual({
          page: 2, // floor(20/20) + 1
          pageSize: PAGINATION_DEFAULTS.pageSize,
          skip: 20,
          take: 20,
        });
      });

      it('should enforce maxPageSize for limit', () => {
        const result = parsePaginationParams({ limit: '500' });

        expect(result.pageSize).toBe(PAGINATION_DEFAULTS.maxPageSize);
      });

      it('should handle zero offset', () => {
        const result = parsePaginationParams({ limit: '20', offset: '0' });

        expect(result.page).toBe(1);
        expect(result.skip).toBe(0);
      });
    });

    describe('default values', () => {
      it('should return defaults when no params provided', () => {
        const result = parsePaginationParams({});

        expect(result).toEqual({
          page: PAGINATION_DEFAULTS.page,
          pageSize: PAGINATION_DEFAULTS.pageSize,
          skip: 0,
          take: PAGINATION_DEFAULTS.pageSize,
        });
      });

      it('should handle NaN values gracefully', () => {
        const result = parsePaginationParams({ page: 'invalid', pageSize: 'abc' });

        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(PAGINATION_DEFAULTS.pageSize);
      });
    });

    describe('priority', () => {
      it('should prefer page/pageSize over limit/offset when both provided', () => {
        const result = parsePaginationParams({
          page: '3',
          pageSize: '15',
          limit: '10',
          offset: '50',
        });

        expect(result).toEqual({
          page: 3,
          pageSize: 15,
          skip: 30, // Uses page/pageSize calculation
          take: 15,
        });
      });
    });
  });

  describe('calculatePagination', () => {
    it('should calculate pagination info correctly', () => {
      const result = calculatePagination(2, 20, 100);

      expect(result).toEqual({
        page: 2,
        pageSize: 20,
        total: 100,
        totalPages: 5,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('should handle first page', () => {
      const result = calculatePagination(1, 20, 100);

      expect(result.hasPrev).toBe(false);
      expect(result.hasNext).toBe(true);
    });

    it('should handle last page', () => {
      const result = calculatePagination(5, 20, 100);

      expect(result.hasPrev).toBe(true);
      expect(result.hasNext).toBe(false);
    });

    it('should handle single page', () => {
      const result = calculatePagination(1, 20, 15);

      expect(result).toEqual({
        page: 1,
        pageSize: 20,
        total: 15,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('should handle empty results', () => {
      const result = calculatePagination(1, 20, 0);

      expect(result).toEqual({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('should handle non-even division of items', () => {
      const result = calculatePagination(1, 20, 55);

      expect(result.totalPages).toBe(3); // ceil(55/20)
    });
  });

  describe('PAGINATION_DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(PAGINATION_DEFAULTS.page).toBe(1);
      expect(PAGINATION_DEFAULTS.pageSize).toBe(20);
      expect(PAGINATION_DEFAULTS.maxPageSize).toBe(100);
    });
  });
});
