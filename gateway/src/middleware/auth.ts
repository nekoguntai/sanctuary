/**
 * Authentication Middleware
 *
 * Validates JWT tokens for mobile app requests. This is the gateway's
 * first line of defense - all protected routes must pass through here.
 *
 * ## How It Works
 *
 * 1. Mobile app includes `Authorization: Bearer <token>` header
 * 2. This middleware extracts and verifies the JWT
 * 3. If valid, attaches user info to request and continues
 * 4. If invalid/expired, returns 401 Unauthorized
 *
 * ## JWT Payload
 *
 * The JWT contains:
 * - `userId` - UUID of the authenticated user
 * - `username` - Username for logging/display
 * - `isAdmin` - Whether user has admin privileges (mostly unused in gateway)
 * - `iat` - Issued at timestamp
 * - `exp` - Expiration timestamp
 *
 * ## Security Notes
 *
 * - JWT_SECRET must match the backend's secret exactly
 * - Tokens are verified locally (no backend call needed)
 * - Expired tokens are rejected immediately
 * - Invalid signatures are rejected immediately
 *
 * ## Device ID Header
 *
 * Mobile apps can include `X-Device-Id` header to identify the device.
 * This is optional but useful for push notification management.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('AUTH');

export interface JwtPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  deviceId?: string;
}

/**
 * Extract JWT from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}

/**
 * Middleware to authenticate requests via JWT
 */
export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (!token) {
    log.warn('Missing authorization token', { ip: req.ip, path: req.path });
    res.status(401).json({ error: 'Unauthorized', message: 'Missing authorization token' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = payload;

    // Extract device ID from header if present (for push notifications)
    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId === 'string') {
      req.deviceId = deviceId;
    }

    log.debug('Request authenticated', { userId: payload.userId, path: req.path });
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      log.warn('Token expired', { ip: req.ip, path: req.path });
      res.status(401).json({ error: 'Unauthorized', message: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      log.warn('Invalid token', { ip: req.ip, path: req.path, error: (err as Error).message });
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    } else {
      log.error('Auth error', { error: (err as Error).message });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

/**
 * Optional authentication - doesn't fail if no token, but sets user if present
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
      req.user = payload;
    } catch {
      // Token invalid, but that's ok for optional auth
    }
  }

  next();
}
