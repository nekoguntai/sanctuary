/**
 * Apple Push Notification Service Provider
 *
 * Sends push notifications to iOS devices using token-based authentication.
 * Requires APNs credentials configured via environment variables.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { createLogger } from '../../utils/logger';

const log = createLogger('APNS');

const APNS_HOST_PRODUCTION = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

let cachedToken: { token: string; expires: number } | null = null;

export interface APNsMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Check if APNs is configured
 */
export function isAPNsConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_PATH &&
    process.env.APNS_BUNDLE_ID
  );
}

/**
 * Generate a JWT token for APNs authentication
 * Tokens are cached and reused until near expiry
 */
function getAPNsToken(): string {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyPath = process.env.APNS_KEY_PATH;

  if (!keyId || !teamId || !keyPath) {
    throw new Error('APNs not configured: missing APNS_KEY_ID, APNS_TEAM_ID, or APNS_KEY_PATH');
  }

  // Reuse token if not expired (tokens valid for 1 hour)
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  try {
    const key = fs.readFileSync(keyPath, 'utf8');
    const token = jwt.sign({}, key, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      expiresIn: '55m', // Refresh 5 min before expiry
    });

    cachedToken = {
      token,
      expires: Date.now() + 55 * 60 * 1000,
    };

    log.debug('Generated new APNs JWT token');
    return token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to generate APNs token: ${msg}`);
  }
}

/**
 * Send a push notification to an iOS device
 *
 * @param deviceToken - The APNs device token
 * @param message - The notification content
 * @returns true if sent successfully, false if APNs not configured
 * @throws Error if send fails (including invalid token errors)
 */
export async function sendToAPNs(
  deviceToken: string,
  message: APNsMessage
): Promise<boolean> {
  const bundleId = process.env.APNS_BUNDLE_ID;
  const isProduction = process.env.APNS_PRODUCTION === 'true';

  if (!bundleId) {
    log.debug('APNs not configured (missing APNS_BUNDLE_ID), skipping');
    return false;
  }

  const host = isProduction ? APNS_HOST_PRODUCTION : APNS_HOST_SANDBOX;
  const url = `https://${host}/3/device/${deviceToken}`;

  const payload = {
    aps: {
      alert: {
        title: message.title,
        body: message.body,
      },
      sound: 'default',
      'mutable-content': 1,
    },
    // Include custom data at root level (APNs convention)
    ...message.data,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${getAPNsToken()}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorJson: Record<string, unknown> = {};
      try {
        errorJson = JSON.parse(errorBody);
      } catch {
        // Not JSON
      }

      const reason = (errorJson as { reason?: string }).reason || errorBody || `HTTP ${response.status}`;
      throw new Error(`APNs ${response.status}: ${reason}`);
    }

    log.debug(`APNs notification sent to device ${deviceToken.slice(0, 8)}...`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`APNs send failed: ${msg}`);
    throw err;
  }
}
