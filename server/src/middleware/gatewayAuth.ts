/**
 * Gateway Authentication Middleware (SEC-002)
 *
 * Verifies that requests to internal endpoints come from the authenticated gateway.
 * Uses HMAC-SHA256 signatures to prevent header spoofing attacks.
 *
 * ## Security Design
 *
 * - Replaces simple X-Gateway-Request header with cryptographic verification
 * - Uses HMAC-SHA256 with timestamp to prevent replay attacks
 * - Signature includes: method, path, timestamp, optional body hash
 *
 * ## Headers Required
 *
 * - X-Gateway-Signature: HMAC-SHA256 signature
 * - X-Gateway-Timestamp: Unix timestamp (must be within 5 minutes)
 * - X-Gateway-Request: 'true' (for backwards compatibility during migration)
 *
 * ## Signature Format
 *
 * signature = HMAC-SHA256(secret, method + path + timestamp + bodyHash)
 * bodyHash = SHA256(body) or empty string if no body
 */

import { Request, Response, NextFunction } from 'express';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import config from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('GATEWAY_AUTH');

/**
 * Maximum age for request signatures (5 minutes)
 */
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

/**
 * Create HMAC signature for verification
 */
function createSignature(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
  secret: string
): string {
  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Create SHA256 hash of request body
 */
function hashBody(body: unknown): string {
  if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
    return '';
  }
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(bodyStr).digest('hex');
}

/**
 * Time-safe comparison of signatures
 */
function compareSignatures(provided: string, expected: string): boolean {
  try {
    const providedBuf = Buffer.from(provided, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Middleware to verify gateway requests using HMAC signatures
 *
 * Rejects requests that:
 * - Missing signature headers
 * - Have expired timestamps (> 5 minutes)
 * - Have invalid signatures
 */
export function verifyGatewayRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If gateway secret is not configured, fall back to legacy header check
  // This allows gradual migration
  if (!config.gatewaySecret) {
    log.warn('GATEWAY_SECRET not configured, using legacy header check');
    if (req.headers['x-gateway-request'] !== 'true') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint is for internal gateway use only',
      });
      return;
    }
    next();
    return;
  }

  const signature = req.headers['x-gateway-signature'] as string | undefined;
  const timestamp = req.headers['x-gateway-timestamp'] as string | undefined;

  // Check required headers
  if (!signature || !timestamp) {
    log.warn('Gateway request missing signature headers', {
      path: req.path,
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Missing gateway authentication headers',
    });
    return;
  }

  // Validate timestamp to prevent replay attacks
  const requestTime = parseInt(timestamp, 10);
  const now = Date.now();

  if (isNaN(requestTime) || Math.abs(now - requestTime) > MAX_SIGNATURE_AGE_MS) {
    log.warn('Gateway request timestamp expired or invalid', {
      path: req.path,
      timestamp,
      age: now - requestTime,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Request timestamp expired or invalid',
    });
    return;
  }

  // Calculate expected signature
  const bodyHash = hashBody(req.body);
  const expectedSignature = createSignature(
    req.method,
    req.path,
    timestamp,
    bodyHash,
    config.gatewaySecret
  );

  // Compare signatures using timing-safe comparison
  if (!compareSignatures(signature, expectedSignature)) {
    log.warn('Gateway request signature mismatch', {
      path: req.path,
      method: req.method,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid gateway signature',
    });
    return;
  }

  log.debug('Gateway request authenticated', { path: req.path });
  next();
}

/**
 * Helper function to generate signature for gateway requests (used by gateway)
 * This is exported for use in the gateway service
 */
export function generateGatewaySignature(
  method: string,
  path: string,
  body: unknown,
  secret: string
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const bodyHash = hashBody(body);
  const signature = createSignature(method, path, timestamp, bodyHash, secret);
  return { signature, timestamp };
}
