/**
 * Token Revocation Service (SEC-003)
 *
 * In-memory token revocation list for JWT invalidation.
 * Tracks revoked token IDs (jti) to enable logout and token invalidation.
 *
 * ## Security Design
 *
 * - Uses jti (JWT ID) claims to uniquely identify tokens
 * - LRU cache with configurable max size (default: 100,000 entries)
 * - Automatic cleanup of expired entries every 5 minutes
 * - Prevents memory leaks on high-traffic instances via LRU eviction
 * - No Redis dependency - suitable for single-instance deployments
 *
 * ## Configuration
 *
 * - TOKEN_REVOCATION_MAX_SIZE: Maximum cache entries (default: 100,000)
 *
 * ## Limitations
 *
 * - Revocation list is lost on server restart
 * - Not suitable for multi-instance deployments without sticky sessions
 * - Consider Redis-based implementation for horizontal scaling
 *
 * ## Usage
 *
 * 1. When generating tokens, include a unique jti claim
 * 2. On logout/revoke, call revokeToken(jti, expiresAt)
 * 3. In auth middleware, call isTokenRevoked(jti)
 */

import { LRUCache } from 'lru-cache';
import { createLogger } from '../utils/logger';

const log = createLogger('TOKEN_REVOCATION');

/**
 * Revoked token entry with expiration time
 */
interface RevokedToken {
  jti: string;
  revokedAt: Date;
  expiresAt: Date; // When the original token would have expired
  reason?: string;
}

/**
 * Maximum number of entries in the revocation cache
 * Configurable via TOKEN_REVOCATION_MAX_SIZE environment variable
 * Default: 100,000 entries to prevent memory leaks on high-traffic instances
 */
const MAX_REVOCATION_ENTRIES = parseInt(process.env.TOKEN_REVOCATION_MAX_SIZE || '100000', 10);

/**
 * In-memory revocation list using LRU cache
 * Automatically evicts least recently used entries when max size is reached
 * This prevents unbounded memory growth on high-traffic instances
 */
const revokedTokens = new LRUCache<string, RevokedToken>({
  max: MAX_REVOCATION_ENTRIES,
  // No TTL set here - we handle expiration manually via cleanup interval
  // This allows us to keep tokens until they naturally expire
});

/**
 * Cleanup interval in milliseconds (5 minutes)
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Revoke a token by its jti
 *
 * @param jti - The JWT ID to revoke
 * @param expiresAt - When the token would have expired (for automatic cleanup)
 * @param reason - Optional reason for revocation (for logging)
 */
export function revokeToken(jti: string, expiresAt: Date, reason?: string): void {
  if (!jti) {
    log.warn('Attempted to revoke token with empty jti');
    return;
  }

  const entry: RevokedToken = {
    jti,
    revokedAt: new Date(),
    expiresAt,
    reason,
  };

  revokedTokens.set(jti, entry);
  log.debug('Token revoked', { jti: jti.substring(0, 8) + '...', reason });
}

/**
 * Check if a token is revoked
 *
 * @param jti - The JWT ID to check
 * @returns true if the token is revoked, false otherwise
 */
export function isTokenRevoked(jti: string): boolean {
  if (!jti) {
    return false; // Tokens without jti cannot be revoked
  }
  return revokedTokens.has(jti);
}

/**
 * Get the count of revoked tokens (for monitoring)
 */
export function getRevokedTokenCount(): number {
  return revokedTokens.size;
}

/**
 * Cleanup expired entries from the revocation list
 * Tokens that have passed their expiration time no longer need to be tracked
 */
function cleanupExpiredEntries(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [jti, entry] of revokedTokens.entries()) {
    if (entry.expiresAt < now) {
      revokedTokens.delete(jti);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.debug('Cleaned up expired revocation entries', { count: cleaned });
  }
}

/**
 * Revoke all tokens for a user (e.g., password change, security concern)
 * This is a placeholder - requires storing user -> jti mappings
 *
 * @param userId - The user ID whose tokens should be revoked
 * @param reason - Reason for revocation
 */
export function revokeAllUserTokens(userId: string, reason?: string): void {
  // Note: Current implementation does not track user -> jti mappings
  // To implement this, you would need to either:
  // 1. Store jti -> userId mapping when tokens are created
  // 2. Use a different revocation strategy (e.g., user version number)
  log.info('Revoke all user tokens requested', { userId, reason });
  // This would be implemented with Redis or database in production
}

/**
 * Clear all revoked tokens (for testing only)
 */
export function clearAllRevokedTokens(): void {
  revokedTokens.clear();
  log.debug('All revoked tokens cleared');
}

// Start cleanup timer
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the revocation service
 */
export function initializeRevocationService(): void {
  if (cleanupInterval) {
    return; // Already initialized
  }

  cleanupInterval = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);
  log.info('Token revocation service initialized');
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
