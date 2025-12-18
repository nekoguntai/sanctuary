/**
 * Request Logger Middleware
 *
 * Logs all incoming requests and outgoing responses for auditing purposes.
 * This is critical for security monitoring and debugging.
 *
 * ## What Gets Logged
 *
 * **Every Request:**
 * - Timestamp
 * - Request ID (for tracing across services)
 * - HTTP method and path
 * - Client IP address
 * - User agent
 * - User ID (if authenticated)
 * - Device ID (if provided)
 *
 * **Every Response:**
 * - Status code
 * - Response time in milliseconds
 *
 * **Security Events (logged at WARN level):**
 * - Failed authentication attempts
 * - Rate limit exceeded
 * - Blocked routes (not whitelisted)
 * - Suspicious patterns
 *
 * ## Request ID
 *
 * Each request gets a unique ID that can be used to trace it through
 * the system. The ID is added to the response headers as X-Request-Id.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { AuthenticatedRequest } from './auth';
import crypto from 'crypto';

const log = createLogger('REQUEST');

/**
 * Generate a short unique request ID
 */
function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Extract client IP, handling proxies
 */
function getClientIp(req: Request): string {
  // Check for forwarded IP (if behind proxy/load balancer)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Sanitize path to avoid log injection
 */
function sanitizePath(path: string): string {
  // Remove any control characters and limit length
  return path.replace(/[\x00-\x1f\x7f]/g, '').substring(0, 200);
}

/**
 * Check if this is a sensitive endpoint that needs extra logging
 */
function isSensitiveEndpoint(path: string): boolean {
  const sensitivePatterns = [
    /^\/api\/v1\/auth\//,      // Auth endpoints
    /^\/api\/v1\/push\//,      // Push device registration
    /\/sync$/,                  // Wallet sync
  ];
  return sensitivePatterns.some(pattern => pattern.test(path));
}

/**
 * Request logging middleware
 *
 * Add this early in the middleware chain to capture all requests.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const clientIp = getClientIp(req);
  const path = sanitizePath(req.path);
  const method = req.method;
  const userAgent = req.headers['user-agent']?.substring(0, 200) || 'unknown';
  const deviceId = req.headers['x-device-id'] as string | undefined;

  // Attach request ID to request object for downstream use
  (req as AuthenticatedRequest & { requestId: string }).requestId = requestId;

  // Add request ID to response headers for client-side tracing
  res.setHeader('X-Request-Id', requestId);

  // Log incoming request
  const requestMeta: Record<string, unknown> = {
    requestId,
    method,
    path,
    ip: clientIp,
    userAgent,
  };

  if (deviceId) {
    requestMeta.deviceId = deviceId;
  }

  // For sensitive endpoints, log at info level; others at debug
  if (isSensitiveEndpoint(path)) {
    log.info('Incoming request', requestMeta);
  } else {
    log.debug('Incoming request', requestMeta);
  }

  // Capture response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Get user ID if authenticated (set by auth middleware)
    const userId = (req as AuthenticatedRequest).user?.userId;

    const responseMeta: Record<string, unknown> = {
      requestId,
      method,
      path,
      status: statusCode,
      duration: `${duration}ms`,
      ip: clientIp,
    };

    if (userId) {
      responseMeta.userId = userId;
    }

    // Log based on status code
    if (statusCode >= 500) {
      log.error('Request failed', responseMeta);
    } else if (statusCode >= 400) {
      // 4xx errors are often security-relevant
      log.warn('Request error', responseMeta);
    } else if (isSensitiveEndpoint(path)) {
      log.info('Request completed', responseMeta);
    } else {
      log.debug('Request completed', responseMeta);
    }
  });

  next();
}

/**
 * Log a security event
 *
 * Use this for security-relevant events that need to be audited:
 * - Failed login attempts
 * - Rate limit exceeded
 * - Blocked routes
 * - Suspicious activity
 */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>
): void {
  log.warn(`SECURITY: ${event}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log an audit event
 *
 * Use this for successful operations that need an audit trail:
 * - User login
 * - Device registration
 * - Configuration changes
 */
export function logAuditEvent(
  event: string,
  details: Record<string, unknown>
): void {
  log.info(`AUDIT: ${event}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}
