/**
 * Request Logger Middleware
 *
 * Provides request correlation IDs and request lifecycle logging.
 * - Assigns unique request ID to each incoming request
 * - Logs request start and completion with duration
 * - Makes request context available throughout the request lifecycle
 * - Sets X-Request-ID response header for client correlation
 */

import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../utils/requestContext';
import { createLogger } from '../utils/logger';

const log = createLogger('HTTP');

/**
 * Paths to exclude from detailed logging (health checks, etc.)
 */
const EXCLUDED_PATHS = ['/health', '/api/v1/health', '/favicon.ico'];

/**
 * Paths with sensitive data that should have reduced logging
 */
const SENSITIVE_PATHS = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/admin/node-config'];

/**
 * Request logger middleware
 *
 * Wraps each request in a context with a unique request ID.
 * Logs request start and completion with timing information.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Generate or use existing request ID (from load balancer/proxy)
  const requestId =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    requestContext.generateRequestId();

  // Create request context
  const context = {
    requestId,
    startTime: Date.now(),
    path: req.path,
    method: req.method,
    userId: undefined as string | undefined,
    username: undefined as string | undefined,
  };

  // Set response header for client correlation
  res.setHeader('X-Request-ID', requestId);

  // Check if this is an excluded path
  const isExcluded = EXCLUDED_PATHS.some((p) => req.path === p || req.path.startsWith(p));
  const isSensitive = SENSITIVE_PATHS.some((p) => req.path.startsWith(p));

  // Run the rest of the request in the context
  requestContext.run(context, () => {
    // Log request start (skip for excluded paths)
    if (!isExcluded) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      log.info(`${req.method} ${req.path}`, {
        requestId,
        ip: clientIp,
        userAgent: req.headers['user-agent']?.substring(0, 50),
      });
    }

    // Capture response finish for duration logging
    res.on('finish', () => {
      if (!isExcluded) {
        const duration = requestContext.getDuration();
        const ctx = requestContext.get();

        // Determine log level based on status code
        const statusCode = res.statusCode;
        const logData = {
          requestId,
          status: statusCode,
          duration: `${duration}ms`,
          userId: ctx?.userId,
        };

        if (statusCode >= 500) {
          log.error(`${req.method} ${req.path} completed`, logData);
        } else if (statusCode >= 400) {
          log.warn(`${req.method} ${req.path} completed`, logData);
        } else {
          log.info(`${req.method} ${req.path} completed`, logData);
        }
      }
    });

    next();
  });
}

/**
 * Get the current request ID from context
 * Can be called from anywhere in the request lifecycle
 */
export function getRequestId(): string {
  return requestContext.getRequestId();
}

export default requestLogger;
