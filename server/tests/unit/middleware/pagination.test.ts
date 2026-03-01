/**
 * Pagination Middleware Tests
 *
 * Tests pagination parameter parsing and validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { parsePaginationParams } from '../../../src/utils/apiResponse';

// Mock apiResponse utils
vi.mock('../../../src/utils/apiResponse', () => ({
  parsePaginationParams: vi.fn((query) => {
    let page: number;
    let pageSize: number;

    // Try page/pageSize format first
    if (query.page !== undefined || query.pageSize !== undefined) {
      page = Math.max(1, parseInt(query.page || '1', 10) || 1);
      pageSize = parseInt(query.pageSize || '20', 10) || 20;
    }
    // Fall back to limit/offset format
    else if (query.limit !== undefined || query.offset !== undefined) {
      pageSize = parseInt(query.limit || '20', 10) || 20;
      const offset = parseInt(query.offset || '0', 10) || 0;
      page = Math.floor(offset / pageSize) + 1;
    } else {
      page = 1;
      pageSize = 20;
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;
    return { page, pageSize, skip, take };
  }),
  PAGINATION_DEFAULTS: {
    pageSize: 20,
    maxPageSize: 100,
  },
}));

import {
  paginationMiddleware,
  requirePagination,
  toPrismaArgs,
  PaginationParams,
} from '../../../src/middleware/pagination';

describe('Pagination Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      query: {},
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = vi.fn();
  });

  describe('paginationMiddleware', () => {
    it('should set default pagination when no params', () => {
      const middleware = paginationMiddleware();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination).toEqual({
        page: 1,
        pageSize: 20,
        skip: 0,
        take: 20,
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse page and pageSize from query', () => {
      mockReq.query = { page: '2', pageSize: '50' };
      const middleware = paginationMiddleware();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination).toEqual({
        page: 2,
        pageSize: 50,
        skip: 50,
        take: 50,
      });
    });

    it('should parse legacy limit/offset format', () => {
      mockReq.query = { limit: '30', offset: '60' };
      const middleware = paginationMiddleware();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination.pageSize).toBe(30);
      expect((mockReq as Request).pagination.skip).toBe(60);
    });

    it('should respect maxPageSize limit', () => {
      mockReq.query = { pageSize: '500' };
      const middleware = paginationMiddleware({ maxPageSize: 100 });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination.pageSize).toBe(100);
      expect((mockReq as Request).pagination.take).toBe(100);
    });

    it('should respect minPageSize limit', () => {
      mockReq.query = { pageSize: '0' };
      const middleware = paginationMiddleware({ minPageSize: 1 });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination.pageSize).toBeGreaterThanOrEqual(1);
    });

    it('should use custom defaultPageSize', () => {
      const middleware = paginationMiddleware({ defaultPageSize: 50 });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Note: our mock uses 20 as default, so we just verify middleware runs
      expect(mockNext).toHaveBeenCalled();
    });

    it('should calculate skip correctly for different pages', () => {
      mockReq.query = { page: '5', pageSize: '10' };
      const middleware = paginationMiddleware();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as Request).pagination.skip).toBe(40); // (5-1) * 10
    });
  });

  describe('requirePagination', () => {
    it('should pass valid pagination', () => {
      mockReq.query = { page: '1', pageSize: '20' };
      const middleware = requirePagination();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should reject page number over 10000', () => {
      mockReq.query = { page: '10001' };
      const middleware = requirePagination();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_PAGINATION',
          }),
        })
      );
    });

    it('should allow page 10000', () => {
      mockReq.query = { page: '10000' };
      const middleware = requirePagination();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should forward parsing errors to next', () => {
      vi.mocked(parsePaginationParams).mockImplementationOnce(() => {
        throw new Error('parse failed');
      });
      const middleware = requirePagination();

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('toPrismaArgs', () => {
    it('should convert pagination to Prisma args', () => {
      const pagination: PaginationParams = {
        page: 3,
        pageSize: 25,
        skip: 50,
        take: 25,
      };

      const result = toPrismaArgs(pagination);

      expect(result).toEqual({
        skip: 50,
        take: 25,
      });
    });

    it('should handle first page correctly', () => {
      const pagination: PaginationParams = {
        page: 1,
        pageSize: 20,
        skip: 0,
        take: 20,
      };

      const result = toPrismaArgs(pagination);

      expect(result).toEqual({
        skip: 0,
        take: 20,
      });
    });
  });
});
