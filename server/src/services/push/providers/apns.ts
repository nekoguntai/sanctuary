/**
 * Apple Push Notification Service Provider
 *
 * Sends push notifications to iOS devices using token-based authentication.
 * Requires APNs credentials configured via environment variables.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { BasePushProvider } from './base';
import { createLogger } from '../../../utils/logger';
import type { PushMessage, PushResult } from '../types';

const log = createLogger('APNS');

const APNS_HOST_PRODUCTION = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

export class APNsPushProvider extends BasePushProvider {
  private cachedToken: { token: string; expires: number } | null = null;

  constructor() {
    super({
      name: 'apns',
      priority: 100,
      platform: 'ios',
    });
  }

  /**
   * Check if APNs is configured with required credentials
   */
  isConfigured(): boolean {
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
  private getToken(): string {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const keyPath = process.env.APNS_KEY_PATH;

    if (!keyId || !teamId || !keyPath) {
      throw new Error('APNs not configured: missing APNS_KEY_ID, APNS_TEAM_ID, or APNS_KEY_PATH');
    }

    // Reuse token if not expired (tokens valid for 1 hour)
    if (this.cachedToken && Date.now() < this.cachedToken.expires) {
      return this.cachedToken.token;
    }

    const key = fs.readFileSync(keyPath, 'utf8');
    const token = jwt.sign({}, key, {
      algorithm: 'ES256',
      keyid: keyId,
      issuer: teamId,
      expiresIn: '55m', // Refresh 5 min before expiry
    });

    this.cachedToken = {
      token,
      expires: Date.now() + 55 * 60 * 1000,
    };

    log.debug('Generated new APNs JWT token');
    return token;
  }

  /**
   * Send push notification to iOS device
   */
  protected async sendNotification(
    deviceToken: string,
    message: PushMessage
  ): Promise<PushResult> {
    const bundleId = process.env.APNS_BUNDLE_ID;
    const isProduction = process.env.APNS_PRODUCTION === 'true';

    if (!bundleId) {
      return {
        success: false,
        error: 'APNs not configured (missing APNS_BUNDLE_ID)',
      };
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${this.getToken()}`,
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
    return {
      success: true,
      messageId: response.headers.get('apns-id') || undefined,
    };
  }
}

// Export legacy function for backward compatibility
export function isAPNsConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_PATH &&
    process.env.APNS_BUNDLE_ID
  );
}
