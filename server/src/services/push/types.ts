/**
 * Push Provider Types
 *
 * Type definitions for the push notification provider registry architecture.
 */

import type { IProvider } from '../../providers/types';

/**
 * Push message payload
 */
export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Push notification result
 */
export interface PushResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Platform types supported by push providers
 */
export type PushPlatform = 'ios' | 'android';

/**
 * Push provider interface
 * Extends base IProvider with push-specific methods
 */
export interface IPushProvider extends IProvider {
  /**
   * The platform this provider handles
   */
  readonly platform: PushPlatform;

  /**
   * Check if the provider is configured with required credentials
   */
  isConfigured(): boolean;

  /**
   * Send a push notification to a device
   * @param deviceToken - The device registration token
   * @param message - The notification content
   * @returns Push result with success status
   */
  send(deviceToken: string, message: PushMessage): Promise<PushResult>;
}

/**
 * Check if an error indicates the device token is invalid/expired
 * Used to determine if the token should be removed from the database
 */
export function isInvalidTokenError(err: unknown): boolean {
  const msg = String(err);

  // APNs error codes for invalid tokens
  // - 410 Gone: device token is no longer active
  // - BadDeviceToken: token is invalid
  // - Unregistered: token is not registered
  if (
    msg.includes('410') ||
    msg.includes('BadDeviceToken') ||
    msg.includes('Unregistered')
  ) {
    return true;
  }

  // FCM error codes for invalid tokens
  // - messaging/registration-token-not-registered: token is not registered
  // - messaging/invalid-registration-token: token is malformed
  // - InvalidRegistration: legacy error code
  if (
    msg.includes('registration-token-not-registered') ||
    msg.includes('invalid-registration-token') ||
    msg.includes('InvalidRegistration')
  ) {
    return true;
  }

  return false;
}
