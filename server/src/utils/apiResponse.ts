/**
 * Standardized API Response Utilities
 *
 * Provides consistent response formatting across all API endpoints.
 * Supports success responses, paginated responses, and error responses.
 *
 * ## Usage
 *
 * ```typescript
 * import { success, created, paginated } from '../utils/apiResponse';
 *
 * // Simple success response
 * success(res, { id: '123', name: 'Wallet' });
 *
 * // Created resource
 * created(res, newWallet);
 *
 * // Paginated list
 * paginated(res, wallets, { page: 1, pageSize: 20, total: 100 });
 * ```
 *
 * ## Response Format
 *
 * All responses follow a consistent envelope:
 * ```json
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "requestId": "...", "apiVersion": "1" }
 * }
 * ```
 */

import { Response } from 'express';
import { requestContext } from './requestContext';

// =============================================================================
// Types
// =============================================================================

/**
 * Metadata included in all responses
 */
export interface ResponseMeta {
  requestId?: string;
  apiVersion?: string;
  processingTimeMs?: number;
}

/**
 * Pagination information for list responses
 */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Standard success response envelope
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

/**
 * Paginated response envelope
 */
export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationInfo;
  meta?: ResponseMeta;
}

/**
 * Error response envelope (matches ApiError format)
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    type: string;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: ResponseMeta;
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Build response metadata
 */
function buildMeta(res: Response): ResponseMeta {
  const ctx = requestContext.get();
  const meta: ResponseMeta = {};

  if (ctx?.requestId) {
    meta.requestId = ctx.requestId;
  }

  // Get API version from request if available
  const apiVersion = (res.req as any)?.apiVersion;
  if (apiVersion) {
    meta.apiVersion = `${apiVersion.major}.${apiVersion.minor}`;
  }

  // Calculate processing time if available
  if (ctx?.startTime) {
    meta.processingTimeMs = Date.now() - ctx.startTime;
  }

  return Object.keys(meta).length > 0 ? meta : undefined as any;
}

/**
 * Send a success response
 *
 * @param res - Express response object
 * @param data - Response data
 * @param status - HTTP status code (default: 200)
 */
export function success<T>(res: Response, data: T, status = 200): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: buildMeta(res),
  };

  res.status(status).json(response);
}

/**
 * Send a created response (201)
 *
 * @param res - Express response object
 * @param data - Created resource data
 * @param location - Optional Location header URL
 */
export function created<T>(res: Response, data: T, location?: string): void {
  if (location) {
    res.setHeader('Location', location);
  }

  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: buildMeta(res),
  };

  res.status(201).json(response);
}

/**
 * Send a no-content response (204)
 *
 * @param res - Express response object
 */
export function noContent(res: Response): void {
  res.status(204).send();
}

/**
 * Send a paginated response
 *
 * @param res - Express response object
 * @param items - Array of items for current page
 * @param pagination - Pagination details
 */
export function paginated<T>(
  res: Response,
  items: T[],
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  }
): void {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);

  const response: PaginatedResponse<T> = {
    success: true,
    data: items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
    meta: buildMeta(res),
  };

  res.status(200).json(response);
}

/**
 * Send an accepted response (202) for async operations
 *
 * @param res - Express response object
 * @param data - Response data (e.g., job ID)
 */
export function accepted<T>(res: Response, data: T): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: buildMeta(res),
  };

  res.status(202).json(response);
}

// =============================================================================
// Pagination Helpers
// =============================================================================

/**
 * Default pagination values
 */
export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 20,
  maxPageSize: 100,
} as const;

/**
 * Parse pagination params from query string
 *
 * Supports two formats:
 * - page/pageSize: ?page=1&pageSize=20
 * - limit/offset: ?limit=20&offset=0 (legacy)
 */
export function parsePaginationParams(query: {
  page?: string;
  pageSize?: string;
  limit?: string;
  offset?: string;
}): {
  page: number;
  pageSize: number;
  skip: number;  // For Prisma
  take: number;  // For Prisma
} {
  let page: number;
  let pageSize: number;

  // Try page/pageSize format first
  if (query.page !== undefined || query.pageSize !== undefined) {
    page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    pageSize = Math.min(
      PAGINATION_DEFAULTS.maxPageSize,
      Math.max(1, parseInt(query.pageSize || String(PAGINATION_DEFAULTS.pageSize), 10) || PAGINATION_DEFAULTS.pageSize)
    );
  }
  // Fall back to limit/offset format
  else if (query.limit !== undefined || query.offset !== undefined) {
    const limit = Math.min(
      PAGINATION_DEFAULTS.maxPageSize,
      Math.max(1, parseInt(query.limit || String(PAGINATION_DEFAULTS.pageSize), 10) || PAGINATION_DEFAULTS.pageSize)
    );
    const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0);

    page = Math.floor(offset / limit) + 1;
    pageSize = limit;
  }
  // Use defaults
  else {
    page = PAGINATION_DEFAULTS.page;
    pageSize = PAGINATION_DEFAULTS.pageSize;
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,  // Prisma offset
    take: pageSize,                // Prisma limit
  };
}

/**
 * Calculate pagination info from results
 */
export function calculatePagination(
  page: number,
  pageSize: number,
  total: number
): PaginationInfo {
  const totalPages = Math.ceil(total / pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
