/**
 * JWT Utilities
 *
 * Helper functions for creating and verifying JWT tokens
 */

import jwt from 'jsonwebtoken';
import config from '../config';

export interface JWTPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  pending2FA?: boolean; // True when awaiting 2FA verification
  usingDefaultPassword?: boolean; // True when using default 'sanctuary' password
}

/**
 * Generate a JWT token for a user
 * @param payload - User payload data
 * @param expiresIn - Optional custom expiry (e.g., '5m', '1h', '7d')
 */
export function generateToken(payload: JWTPayload, expiresIn?: string): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: expiresIn || (config.jwtExpiresIn as string | number),
  } as jwt.SignOptions);
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
