/**
 * Apple Push Notification Service (APNs)
 *
 * Sends push notifications to iOS devices.
 */

import apn from '@parse/node-apn';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('APNS');

let apnsProvider: apn.Provider | null = null;

/**
 * Initialize APNs provider
 */
export function initializeAPNs(): boolean {
  if (apnsProvider) return true;

  if (!config.apns.keyId || !config.apns.teamId || !config.apns.privateKey) {
    log.warn('APNs not configured - iOS push notifications disabled');
    return false;
  }

  try {
    apnsProvider = new apn.Provider({
      token: {
        key: config.apns.privateKey,
        keyId: config.apns.keyId,
        teamId: config.apns.teamId,
      },
      production: config.apns.production,
    });
    log.info('APNs initialized successfully', { production: config.apns.production });
    return true;
  } catch (err) {
    log.error('Failed to initialize APNs', { error: (err as Error).message });
    return false;
  }
}

/**
 * Check if APNs is available
 */
export function isAPNsAvailable(): boolean {
  return apnsProvider !== null;
}

/**
 * Shutdown APNs provider (call on process exit)
 */
export function shutdownAPNs(): void {
  if (apnsProvider) {
    apnsProvider.shutdown();
    apnsProvider = null;
    log.info('APNs provider shutdown');
  }
}

export interface APNsNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string;
}

/**
 * Send push notification to a single iOS device
 */
export async function sendToDevice(
  pushToken: string,
  notification: APNsNotification
): Promise<{ success: boolean; error?: string }> {
  if (!apnsProvider) {
    return { success: false, error: 'APNs not initialized' };
  }

  try {
    const note = new apn.Notification();
    note.alert = {
      title: notification.title,
      body: notification.body,
    };
    note.topic = config.apns.bundleId;
    note.sound = notification.sound || 'default';
    if (notification.badge !== undefined) {
      note.badge = notification.badge;
    }
    note.payload = notification.data || {};
    note.pushType = 'alert';

    const result = await apnsProvider.send(note, pushToken);

    if (result.failed.length > 0) {
      const failure = result.failed[0];
      const reason = failure.response?.reason || 'unknown';
      log.error('APNs send failed', { reason, device: failure.device });

      // Handle invalid/expired tokens
      if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
        return { success: false, error: 'invalid_token' };
      }

      return { success: false, error: reason };
    }

    log.debug('APNs notification sent');
    return { success: true };
  } catch (err) {
    log.error('APNs send error', { error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Send push notification to multiple iOS devices
 */
export async function sendToDevices(
  pushTokens: string[],
  notification: APNsNotification
): Promise<{ success: number; failed: number; invalidTokens: string[] }> {
  if (!apnsProvider) {
    return { success: 0, failed: pushTokens.length, invalidTokens: [] };
  }

  if (pushTokens.length === 0) {
    return { success: 0, failed: 0, invalidTokens: [] };
  }

  try {
    const note = new apn.Notification();
    note.alert = {
      title: notification.title,
      body: notification.body,
    };
    note.topic = config.apns.bundleId;
    note.sound = notification.sound || 'default';
    if (notification.badge !== undefined) {
      note.badge = notification.badge;
    }
    note.payload = notification.data || {};
    note.pushType = 'alert';

    const result = await apnsProvider.send(note, pushTokens);

    const invalidTokens: string[] = [];
    result.failed.forEach((failure) => {
      const reason = failure.response?.reason;
      if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
        invalidTokens.push(failure.device);
      }
    });

    log.debug('APNs multicast sent', {
      success: result.sent.length,
      failed: result.failed.length,
    });

    return {
      success: result.sent.length,
      failed: result.failed.length,
      invalidTokens,
    };
  } catch (err) {
    log.error('APNs multicast error', { error: (err as Error).message });
    return { success: 0, failed: pushTokens.length, invalidTokens: [] };
  }
}
