/**
 * Firebase Cloud Messaging Provider
 *
 * Sends push notifications to Android devices using FCM HTTP v1 API.
 * Requires Firebase service account JSON configured via environment variable.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { BasePushProvider } from './base';
import { createLogger } from '../../../utils/logger';
import type { PushMessage, PushResult } from '../types';

const log = createLogger('FCM');

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export class FCMPushProvider extends BasePushProvider {
  private accessToken: { token: string; expires: number } | null = null;
  private serviceAccountCache: ServiceAccount | null = null;

  constructor() {
    super({
      name: 'fcm',
      priority: 100,
      platform: 'android',
    });
  }

  /**
   * Check if FCM is configured with service account
   */
  isConfigured(): boolean {
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
    if (!serviceAccountPath) return false;

    try {
      fs.accessSync(serviceAccountPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load and cache the service account JSON
   */
  private getServiceAccount(): ServiceAccount {
    if (this.serviceAccountCache) {
      return this.serviceAccountCache;
    }

    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
    if (!serviceAccountPath) {
      throw new Error('FCM not configured: missing FCM_SERVICE_ACCOUNT');
    }

    const content = fs.readFileSync(serviceAccountPath, 'utf8');
    this.serviceAccountCache = JSON.parse(content);
    return this.serviceAccountCache!;
  }

  /**
   * Get OAuth2 access token for FCM API
   * Tokens are cached and reused until near expiry
   */
  private async getAccessToken(): Promise<string> {
    // Reuse token if not expired
    if (this.accessToken && Date.now() < this.accessToken.expires) {
      return this.accessToken.token;
    }

    const serviceAccount = this.getServiceAccount();

    // Create JWT for OAuth2 token exchange
    const now = Math.floor(Date.now() / 1000);
    const jwtToken = jwt.sign(
      {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      serviceAccount.private_key,
      { algorithm: 'RS256' }
    );

    // Exchange JWT for access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FCM OAuth failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = {
      token: data.access_token,
      // Refresh 60 seconds before expiry
      expires: Date.now() + (data.expires_in - 60) * 1000,
    };

    log.debug('Obtained new FCM access token');
    return this.accessToken.token;
  }

  /**
   * Send push notification to Android device
   */
  protected async sendNotification(
    deviceToken: string,
    message: PushMessage
  ): Promise<PushResult> {
    const serviceAccount = this.getServiceAccount();
    const projectId = serviceAccount.project_id;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const payload = {
      message: {
        token: deviceToken,
        notification: {
          title: message.title,
          body: message.body,
        },
        data: message.data || {},
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'transactions',
          },
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await this.getAccessToken()}`,
        'Content-Type': 'application/json',
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

      const errorMsg = (errorJson as { error?: { message?: string } }).error?.message ||
                       errorBody ||
                       `HTTP ${response.status}`;
      throw new Error(`FCM ${response.status}: ${errorMsg}`);
    }

    const result = await response.json() as { name: string };
    log.debug(`FCM notification sent to device ${deviceToken.slice(0, 8)}...`);
    return {
      success: true,
      messageId: result.name,
    };
  }
}

// Export legacy function for backward compatibility
export function isFCMConfigured(): boolean {
  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
  if (!serviceAccountPath) return false;

  try {
    fs.accessSync(serviceAccountPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
