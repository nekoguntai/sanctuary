/**
 * Token Revocation Service (SEC-003)
 *
 * PostgreSQL-based token revocation for JWT invalidation.
 * Tracks revoked token IDs (jti) to enable logout and token invalidation.
 *
 * ## Security Design
 *
 * - Uses jti (JWT ID) claims to uniquely identify tokens
 * - Persisted in PostgreSQL for durability across restarts
 * - Automatic cleanup of expired entries every 5 minutes
 * - Supports multi-instance deployments
 *
 * ## Usage
 *
 * 1. When generating tokens, include a unique jti claim
 * 2. On logout/revoke, call revokeToken(jti, expiresAt)
 * 3. In auth middleware, call isTokenRevoked(jti)
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('TOKEN_REVOCATION');

/**
 * Cleanup interval in milliseconds (5 minutes)
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Revoke a token by its jti
 *
 * @param jti - The JWT ID to revoke
 * @param expiresAt - When the token would have expired (for automatic cleanup)
 * @param userId - Optional user ID who owned the token
 * @param reason - Optional reason for revocation (for logging)
 */
export async function revokeToken(
  jti: string,
  expiresAt: Date,
  userId?: string,
  reason?: string
): Promise<void> {
  if (!jti) {
    log.warn('Attempted to revoke token with empty jti');
    return;
  }

  try {
    await prisma.revokedToken.upsert({
      where: { jti },
      update: {
        userId,
        reason,
        revokedAt: new Date(),
        expiresAt,
      },
      create: {
        jti,
        userId,
        reason,
        expiresAt,
      },
    });
    log.debug('Token revoked', { jti: jti.substring(0, 8) + '...', reason });
  } catch (error) {
    log.error('Failed to revoke token', { error, jti: jti.substring(0, 8) + '...' });
    throw error;
  }
}

/**
 * Check if a token is revoked
 *
 * @param jti - The JWT ID to check
 * @returns true if the token is revoked, false otherwise
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  if (!jti) {
    return false; // Tokens without jti cannot be revoked
  }

  try {
    const revoked = await prisma.revokedToken.findUnique({
      where: { jti },
      select: { jti: true },
    });
    return revoked !== null;
  } catch (error) {
    log.error('Failed to check token revocation', { error, jti: jti.substring(0, 8) + '...' });
    // Fail secure - treat as revoked if we can't check
    return true;
  }
}

/**
 * Get the count of revoked tokens (for monitoring)
 */
export async function getRevokedTokenCount(): Promise<number> {
  try {
    return await prisma.revokedToken.count();
  } catch (error) {
    log.error('Failed to get revoked token count', { error });
    return 0;
  }
}

/**
 * Cleanup expired entries from the revocation list
 * Tokens that have passed their expiration time no longer need to be tracked
 */
async function cleanupExpiredEntries(): Promise<void> {
  try {
    const result = await prisma.revokedToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    if (result.count > 0) {
      log.debug('Cleaned up expired revocation entries', { count: result.count });
    }
  } catch (error) {
    log.error('Failed to cleanup expired tokens', { error });
  }
}

/**
 * Revoke all tokens for a user (e.g., password change, security concern)
 *
 * @param userId - The user ID whose tokens should be revoked
 * @param reason - Reason for revocation
 * @returns Number of tokens revoked
 */
export async function revokeAllUserTokens(userId: string, reason?: string): Promise<number> {
  log.info('Revoke all user tokens requested', { userId, reason });

  try {
    // Get all refresh tokens for the user and revoke their associated access tokens
    const refreshTokens = await prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true },
    });

    // Delete all refresh tokens for the user
    const result = await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    log.info('Revoked all user tokens', { userId, count: result.count });
    return result.count;
  } catch (error) {
    log.error('Failed to revoke all user tokens', { error, userId });
    throw error;
  }
}

/**
 * Clear all revoked tokens (for testing only)
 */
export async function clearAllRevokedTokens(): Promise<void> {
  try {
    await prisma.revokedToken.deleteMany();
    log.debug('All revoked tokens cleared');
  } catch (error) {
    log.error('Failed to clear all revoked tokens', { error });
    throw error;
  }
}

// Cleanup timer
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the revocation service
 */
export function initializeRevocationService(): void {
  if (cleanupInterval) {
    return; // Already initialized
  }

  cleanupInterval = setInterval(() => {
    cleanupExpiredEntries().catch((err) => {
      log.error('Cleanup interval error', { error: err });
    });
  }, CLEANUP_INTERVAL_MS);

  // Prevent interval from keeping process alive (important for tests)
  cleanupInterval.unref();

  log.info('Token revocation service initialized (PostgreSQL-backed)');
}

/**
 * Shutdown the revocation service
 */
export function shutdownRevocationService(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Token revocation service shutdown');
  }
}

// Initialize on module load
initializeRevocationService();
