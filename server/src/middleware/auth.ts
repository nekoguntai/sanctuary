/**
 * Authentication Middleware
 *
 * Middleware to protect routes and verify JWT tokens
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader, JWTPayload } from '../utils/jwt';
import { requestContext } from '../utils/requestContext';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Middleware to verify JWT token and attach user to request
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from Authorization header
    const token = extractTokenFromHeader(req.headers.authorization);

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided',
      });
    }

    // Verify token
    const payload = verifyToken(token);

    // Attach user to request
    req.user = payload;

    // Set user in request context for logging correlation
    requestContext.setUser(payload.userId, payload.username);

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Middleware to check if authenticated user is an admin
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }

  next();
}

/**
 * Optional authentication - attaches user if token is present but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);

    if (token) {
      const payload = verifyToken(token);
      req.user = payload;
      // Set user in request context for logging correlation
      requestContext.setUser(payload.userId, payload.username);
    }

    next();
  } catch (error) {
    // Token invalid, but optional so just continue
    next();
  }
}
