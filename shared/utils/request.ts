/**
 * Shared Request Utility Functions
 *
 * These functions are used across backend and gateway
 * for request handling and logging.
 */

/**
 * Generate a short unique request ID
 * Uses first segment of UUID for brevity while maintaining uniqueness
 */
export function generateRequestId(): string {
  // Use crypto.randomUUID if available, otherwise fall back to random hex
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  // Fallback for environments without crypto.randomUUID
  return Math.random().toString(16).substring(2, 10);
}

/**
 * Extract client IP address from request headers
 * Handles X-Forwarded-For header for proxied requests
 */
export function extractClientIp(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined
): string {
  if (forwardedFor) {
    const ips = (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0]).split(',');
    return ips[0].trim();
  }
  return remoteAddress || 'unknown';
}

/**
 * Sanitize path to prevent log injection attacks
 * Removes control characters and truncates to max length
 */
export function sanitizePath(path: string, maxLength: number = 200): string {
  // Remove control characters (ASCII 0-31 and 127)
  return path.replace(/[\x00-\x1f\x7f]/g, '').substring(0, maxLength);
}

/**
 * Check if a path is a sensitive endpoint that should have reduced logging
 */
export function isSensitivePath(path: string): boolean {
  const sensitivePatterns = [
    '/auth/login',
    '/auth/register',
    '/auth/password',
    '/auth/2fa',
    '/admin/node-config',
  ];
  return sensitivePatterns.some((pattern) => path.includes(pattern));
}
