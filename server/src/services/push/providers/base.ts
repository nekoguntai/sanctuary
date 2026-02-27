/**
 * Base Push Provider
 *
 * Abstract base class implementing common push provider functionality.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { IPushProvider, PushMessage, PushResult, PushPlatform } from '../types';

export interface BasePushProviderConfig {
  name: string;
  priority: number;
  platform: PushPlatform;
}

const log = createLogger('PushProvider');

export abstract class BasePushProvider implements IPushProvider {
  readonly name: string;
  readonly priority: number;
  readonly platform: PushPlatform;

  constructor(config: BasePushProviderConfig) {
    this.name = config.name;
    this.priority = config.priority;
    this.platform = config.platform;
  }

  /**
   * Health check - verifies provider is configured
   */
  async healthCheck(): Promise<boolean> {
    return this.isConfigured();
  }

  /**
   * Check if the provider is properly configured
   */
  abstract isConfigured(): boolean;

  /**
   * Send push notification
   */
  async send(deviceToken: string, message: PushMessage): Promise<PushResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: `${this.name} provider not configured`,
      };
    }

    try {
      return await this.sendNotification(deviceToken, message);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      log.error(`${this.name} send failed`, { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Implement actual send logic in subclasses
   */
  protected abstract sendNotification(
    deviceToken: string,
    message: PushMessage
  ): Promise<PushResult>;
}
