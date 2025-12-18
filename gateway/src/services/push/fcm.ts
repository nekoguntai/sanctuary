/**
 * Firebase Cloud Messaging (FCM) Service
 *
 * Sends push notifications to Android devices.
 */

import admin from 'firebase-admin';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('FCM');

let fcmInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
export function initializeFCM(): boolean {
  if (fcmInitialized) return true;

  if (!config.fcm.projectId || !config.fcm.privateKey || !config.fcm.clientEmail) {
    log.warn('FCM not configured - Android push notifications disabled');
    return false;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.fcm.projectId,
        privateKey: config.fcm.privateKey,
        clientEmail: config.fcm.clientEmail,
      }),
    });
    fcmInitialized = true;
    log.info('FCM initialized successfully');
    return true;
  } catch (err) {
    log.error('Failed to initialize FCM', { error: (err as Error).message });
    return false;
  }
}

/**
 * Check if FCM is available
 */
export function isFCMAvailable(): boolean {
  return fcmInitialized;
}

export interface FCMNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send push notification to a single Android device
 */
export async function sendToDevice(
  pushToken: string,
  notification: FCMNotification
): Promise<{ success: boolean; error?: string }> {
  if (!fcmInitialized) {
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const message: admin.messaging.Message = {
      token: pushToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'sanctuary_transactions',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await admin.messaging().send(message);
    log.debug('FCM notification sent', { messageId: response });
    return { success: true };
  } catch (err) {
    const error = err as admin.FirebaseError;
    log.error('FCM send error', { error: error.message, code: error.code });

    // Handle invalid/expired tokens
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      return { success: false, error: 'invalid_token' };
    }

    return { success: false, error: error.message };
  }
}

/**
 * Send push notification to multiple Android devices
 */
export async function sendToDevices(
  pushTokens: string[],
  notification: FCMNotification
): Promise<{ success: number; failed: number; invalidTokens: string[] }> {
  if (!fcmInitialized) {
    return { success: 0, failed: pushTokens.length, invalidTokens: [] };
  }

  if (pushTokens.length === 0) {
    return { success: 0, failed: 0, invalidTokens: [] };
  }

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens: pushTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'sanctuary_transactions',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    const invalidTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const code = resp.error.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(pushTokens[idx]);
        }
      }
    });

    log.debug('FCM multicast sent', {
      success: response.successCount,
      failed: response.failureCount,
    });

    return {
      success: response.successCount,
      failed: response.failureCount,
      invalidTokens,
    };
  } catch (err) {
    log.error('FCM multicast error', { error: (err as Error).message });
    return { success: 0, failed: pushTokens.length, invalidTokens: [] };
  }
}
