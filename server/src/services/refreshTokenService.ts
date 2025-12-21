/**
 * Refresh Token Service
 *
 * Manages refresh tokens with PostgreSQL persistence for durability.
 * Supports session management across multiple devices.
 *
 * ## Security Design
 *
 * - Stores SHA256 hash of refresh tokens (never raw tokens)
 * - Supports token rotation for enhanced security
 * - Tracks device info for session management
 * - Enables "logout from all devices" functionality
 */

import prisma from '../models/prisma';
import { generateRefreshToken, hashToken, decodeToken } from '../utils/jwt';
import { createLogger } from '../utils/logger';

const log = createLogger('REFRESH_TOKEN');

export interface DeviceInfo {
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface Session {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
}

/**
 * Create a new refresh token and store its hash in the database
 */
export async function createRefreshToken(
  userId: string,
  deviceInfo?: DeviceInfo
): Promise<string> {
  // Generate the actual refresh token
  const refreshToken = generateRefreshToken(userId);
  const tokenHash = hashToken(refreshToken);

  // Decode to get expiration
  const decoded = decodeToken(refreshToken);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days default

  try {
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        deviceId: deviceInfo?.deviceId || null,
        deviceName: deviceInfo?.deviceName || null,
        userAgent: deviceInfo?.userAgent || null,
        ipAddress: deviceInfo?.ipAddress || null,
        expiresAt,
      },
    });

    log.debug('Refresh token created', { userId, deviceId: deviceInfo?.deviceId });
    return refreshToken;
  } catch (error) {
    log.error('Failed to create refresh token', { error, userId });
    throw error;
  }
}

/**
 * Verify a refresh token exists in the database and update lastUsedAt
 */
export async function verifyRefreshTokenExists(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  try {
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, expiresAt: true },
    });

    if (!existing) {
      return false;
    }

    // Check if expired
    if (existing.expiresAt < new Date()) {
      // Clean up expired token
      await prisma.refreshToken.delete({ where: { tokenHash } });
      return false;
    }

    // Update last used time
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { lastUsedAt: new Date() },
    });

    return true;
  } catch (error) {
    log.error('Failed to verify refresh token', { error });
    return false;
  }
}

/**
 * Rotate refresh token - delete old token and create new one
 * This provides enhanced security by limiting token reuse
 */
export async function rotateRefreshToken(
  oldToken: string,
  deviceInfo?: DeviceInfo
): Promise<string | null> {
  const oldTokenHash = hashToken(oldToken);

  try {
    // Find and delete the old token atomically
    const oldTokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash: oldTokenHash },
      select: { userId: true, deviceId: true, deviceName: true },
    });

    if (!oldTokenRecord) {
      log.warn('Attempted to rotate non-existent refresh token');
      return null;
    }

    // Delete old token
    await prisma.refreshToken.delete({
      where: { tokenHash: oldTokenHash },
    });

    // Create new token with same device info (or updated info if provided)
    const newDeviceInfo: DeviceInfo = {
      deviceId: deviceInfo?.deviceId || oldTokenRecord.deviceId || undefined,
      deviceName: deviceInfo?.deviceName || oldTokenRecord.deviceName || undefined,
      userAgent: deviceInfo?.userAgent,
      ipAddress: deviceInfo?.ipAddress,
    };

    const newToken = await createRefreshToken(oldTokenRecord.userId, newDeviceInfo);
    log.debug('Refresh token rotated', { userId: oldTokenRecord.userId });

    return newToken;
  } catch (error) {
    log.error('Failed to rotate refresh token', { error });
    return null;
  }
}

/**
 * Revoke a specific refresh token by its hash
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  try {
    await prisma.refreshToken.delete({
      where: { tokenHash },
    });
    log.debug('Refresh token revoked');
    return true;
  } catch (error) {
    // Token may not exist (already revoked or expired)
    log.debug('Refresh token not found for revocation');
    return false;
  }
}

/**
 * Revoke a specific session by its ID
 */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        id: sessionId,
        userId, // Ensure user can only revoke their own sessions
      },
    });
    return result.count > 0;
  } catch (error) {
    log.error('Failed to revoke session', { error, sessionId });
    return false;
  }
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<number> {
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: { userId },
    });
    log.info('All user refresh tokens revoked', { userId, count: result.count });
    return result.count;
  } catch (error) {
    log.error('Failed to revoke all user refresh tokens', { error, userId });
    throw error;
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(
  userId: string,
  currentTokenHash?: string
): Promise<Session[]> {
  try {
    const tokens = await prisma.refreshToken.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() }, // Only non-expired tokens
      },
      select: {
        id: true,
        tokenHash: true,
        deviceId: true,
        deviceName: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    return tokens.map((token: {
      id: string;
      tokenHash: string;
      deviceId: string | null;
      deviceName: string | null;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      lastUsedAt: Date;
    }) => ({
      id: token.id,
      deviceId: token.deviceId,
      deviceName: token.deviceName,
      userAgent: token.userAgent,
      ipAddress: token.ipAddress,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      isCurrent: currentTokenHash ? token.tokenHash === currentTokenHash : false,
    }));
  } catch (error) {
    log.error('Failed to get user sessions', { error, userId });
    throw error;
  }
}

/**
 * Clean up expired refresh tokens
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    if (result.count > 0) {
      log.debug('Cleaned up expired refresh tokens', { count: result.count });
    }

    return result.count;
  } catch (error) {
    log.error('Failed to cleanup expired refresh tokens', { error });
    return 0;
  }
}

/**
 * Get the count of active sessions for a user
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  try {
    return await prisma.refreshToken.count({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
    });
  } catch (error) {
    log.error('Failed to get active session count', { error, userId });
    return 0;
  }
}
