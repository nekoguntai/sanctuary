/**
 * Pagination Middleware
 *
 * Automatically parses pagination parameters from query string and
 * attaches them to the request object for use in route handlers.
 *
 * ## Usage
 *
 * ```typescript
 * import { paginationMiddleware } from '../middleware/pagination';
 *
 * // Apply to specific routes
 * router.get('/items', paginationMiddleware(), async (req, res) => {
 *   const { skip, take, page, pageSize } = req.pagination;
 *   const items = await prisma.item.findMany({ skip, take });
 *   // ...
 * });
 *
 * // Apply globally with custom defaults
 * app.use('/api', paginationMiddleware({ defaultPageSize: 50 }));
 * ```
 *
 * ## Query Parameters
 *
 * Supports two formats:
 * - Modern: `?page=1&pageSize=20`
 * - Legacy: `?limit=20&offset=0`
 *
 * The middleware normalizes both to the same internal representation.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { parsePaginationParams, PAGINATION_DEFAULTS } from '../utils/apiResponse';

// =============================================================================
// Types
// =============================================================================

/**
 * Pagination parameters attached to request
 */
export interface PaginationParams {
  /** Current page number (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Offset for database query (Prisma: skip) */
  skip: number;
  /** Limit for database query (Prisma: take) */
  take: number;
}

/**
 * Middleware configuration options
 */
export interface PaginationOptions {
  /** Default page size if not specified (default: 20) */
  defaultPageSize?: number;
  /** Maximum allowed page size (default: 100) */
  maxPageSize?: number;
  /** Minimum page size (default: 1) */
  minPageSize?: number;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      pagination: PaginationParams;
    }
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Pagination middleware factory
 *
 * @param options - Configuration options
 * @returns Express middleware that populates req.pagination
 */
export function paginationMiddleware(options: PaginationOptions = {}): RequestHandler {
  const {
    defaultPageSize = PAGINATION_DEFAULTS.pageSize,
    maxPageSize = PAGINATION_DEFAULTS.maxPageSize,
    minPageSize = 1,
  } = options;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const query = req.query as {
      page?: string;
      pageSize?: string;
      limit?: string;
      offset?: string;
    };

    // Parse with defaults
    let { page, pageSize, skip, take } = parsePaginationParams(query);

    // Apply custom limits
    pageSize = Math.min(maxPageSize, Math.max(minPageSize, pageSize));
    take = pageSize;

    // Recalculate skip if pageSize was clamped
    skip = (page - 1) * pageSize;

    // Attach to request
    req.pagination = {
      page,
      pageSize,
      skip,
      take,
    };

    next();
  };
}

/**
 * Helper to apply pagination to Prisma queries
 *
 * @param pagination - Pagination params from request
 * @returns Object with skip and take for Prisma
 */
export function toPrismaArgs(pagination: PaginationParams): { skip: number; take: number } {
  return {
    skip: pagination.skip,
    take: pagination.take,
  };
}

/**
 * Require pagination - returns 400 if pagination params are invalid
 */
export function requirePagination(options: PaginationOptions = {}): RequestHandler {
  const middleware = paginationMiddleware(options);

  return (req: Request, res: Response, next: NextFunction): void => {
    middleware(req, res, (err) => {
      if (err) {
        return next(err);
      }

      // Validate page number is reasonable
      if (req.pagination.page > 10000) {
        res.status(400).json({
          success: false,
          error: {
            type: 'ValidationError',
            code: 'INVALID_PAGINATION',
            message: 'Page number exceeds maximum allowed value (10000)',
          },
        });
        return;
      }

      next();
    });
  };
}

export default paginationMiddleware;
