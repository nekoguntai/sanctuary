/**
 * Firebase Cloud Messaging Provider
 *
 * Sends push notifications to Android devices using FCM HTTP v1 API.
 * Requires Firebase service account JSON configured via environment variable.
 */

import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { createLogger } from '../../utils/logger';

const log = createLogger('FCM');

let accessToken: { token: string; expires: number } | null = null;
let serviceAccountCache: {
  client_email: string;
  private_key: string;
  project_id: string;
} | null = null;

export interface FCMMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Check if FCM is configured
 */
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

/**
 * Load and cache the service account JSON
 */
function getServiceAccount(): {
  client_email: string;
  private_key: string;
  project_id: string;
} {
  if (serviceAccountCache) {
    return serviceAccountCache;
  }

  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
  if (!serviceAccountPath) {
    throw new Error('FCM not configured: missing FCM_SERVICE_ACCOUNT');
  }

  try {
    const content = fs.readFileSync(serviceAccountPath, 'utf8');
    serviceAccountCache = JSON.parse(content);
    return serviceAccountCache!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load FCM service account: ${msg}`);
  }
}

/**
 * Get OAuth2 access token for FCM API
 * Tokens are cached and reused until near expiry
 */
async function getFCMAccessToken(): Promise<string> {
  // Reuse token if not expired
  if (accessToken && Date.now() < accessToken.expires) {
    return accessToken.token;
  }

  const serviceAccount = getServiceAccount();

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
  accessToken = {
    token: data.access_token,
    // Refresh 60 seconds before expiry
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };

  log.debug('Obtained new FCM access token');
  return accessToken.token;
}

/**
 * Send a push notification to an Android device
 *
 * @param deviceToken - The FCM registration token
 * @param message - The notification content
 * @returns true if sent successfully, false if FCM not configured
 * @throws Error if send fails (including invalid token errors)
 */
export async function sendToFCM(
  deviceToken: string,
  message: FCMMessage
): Promise<boolean> {
  if (!isFCMConfigured()) {
    log.debug('FCM not configured, skipping');
    return false;
  }

  const serviceAccount = getServiceAccount();
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

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await getFCMAccessToken()}`,
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

    log.debug(`FCM notification sent to device ${deviceToken.slice(0, 8)}...`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`FCM send failed: ${msg}`);
    throw err;
  }
}
