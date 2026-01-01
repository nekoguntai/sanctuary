/**
 * Database-Backed Feature Flag Service
 *
 * Extends the environment-based feature flag system with database storage
 * for runtime toggling without server restart.
 *
 * ## Priority (highest to lowest)
 *
 * 1. Database override (if exists and not null)
 * 2. Environment variable
 * 3. Default value
 *
 * ## Features
 *
 * - Runtime toggle via admin API
 * - Per-user targeting (beta users, percentage rollout)
 * - Audit trail of flag changes
 * - Cache with TTL for performance
 *
 * ## Usage
 *
 * ```typescript
 * const flagService = getFeatureFlagService();
 *
 * // Check if feature is enabled globally
 * const enabled = await flagService.isEnabled('payjoinSupport');
 *
 * // Check if feature is enabled for a specific user
 * const enabledForUser = await flagService.isEnabledForUser('payjoinSupport', userId);
 *
 * // Toggle feature (admin only)
 * await flagService.setFlag('priceAlerts', true);
 * ```
 */

import { createLogger } from '../../utils/logger';
import { cache } from '../cache';
import { eventBus } from '../../events';
import type { FeatureFlagKey } from '../../config/types';
import { getConfig } from '../../config';

const log = createLogger('FeatureFlags');

// =============================================================================
// Types
// =============================================================================

/**
 * Feature flag override from database
 */
export interface FeatureFlagOverride {
  flag: string;
  enabled: boolean | null; // null means use default
  rolloutPercentage: number | null; // 0-100, null means 100% if enabled
  targetUserIds: string[] | null; // specific users, null means all
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * Feature flag status with source information
 */
export interface FeatureFlagStatus {
  flag: string;
  enabled: boolean;
  source: 'database' | 'environment' | 'default';
  rolloutPercentage: number | null;
  targetUserIds: string[] | null;
  updatedAt: Date | null;
}

/**
 * Feature flag change event
 */
export interface FeatureFlagChangeEvent {
  flag: string;
  previousValue: boolean;
  newValue: boolean;
  changedBy: string;
  timestamp: Date;
}

// =============================================================================
// Cache Keys
// =============================================================================

const CACHE_TTL_SECONDS = 60; // 1 minute cache

function getCacheKey(flag: string): string {
  return `feature:${flag}`;
}

function getUserCacheKey(flag: string, userId: string): string {
  return `feature:${flag}:user:${userId}`;
}

// =============================================================================
// In-Memory Storage (for now - can be replaced with Prisma)
// =============================================================================

/**
 * In-memory storage for feature flag overrides
 * In production, this would be backed by the database
 */
class FeatureFlagStore {
  private overrides = new Map<string, FeatureFlagOverride>();

  async get(flag: string): Promise<FeatureFlagOverride | null> {
    return this.overrides.get(flag) || null;
  }

  async set(flag: string, override: FeatureFlagOverride): Promise<void> {
    this.overrides.set(flag, override);
  }

  async delete(flag: string): Promise<void> {
    this.overrides.delete(flag);
  }

  async getAll(): Promise<FeatureFlagOverride[]> {
    return Array.from(this.overrides.values());
  }
}

const flagStore = new FeatureFlagStore();

// =============================================================================
// Feature Flag Service
// =============================================================================

class FeatureFlagService {
  private configFlags: ReturnType<typeof getConfig>['features'];

  constructor() {
    this.configFlags = getConfig().features;
  }

  /**
   * Check if a feature is enabled globally
   */
  async isEnabled(flag: FeatureFlagKey): Promise<boolean> {
    // Check cache first
    const cached = await cache.get<boolean>(getCacheKey(flag));
    if (cached !== null) {
      return cached;
    }

    // Check database override
    const override = await flagStore.get(flag);
    if (override && override.enabled !== null) {
      await cache.set(getCacheKey(flag), override.enabled, CACHE_TTL_SECONDS);
      return override.enabled;
    }

    // Fall back to config (env var or default)
    const configValue = this.getConfigValue(flag);
    await cache.set(getCacheKey(flag), configValue, CACHE_TTL_SECONDS);
    return configValue;
  }

  /**
   * Check if a feature is enabled for a specific user
   * Takes into account user targeting and rollout percentage
   */
  async isEnabledForUser(flag: FeatureFlagKey, userId: string): Promise<boolean> {
    // Check user-specific cache first
    const cached = await cache.get<boolean>(getUserCacheKey(flag, userId));
    if (cached !== null) {
      return cached;
    }

    // Check database override
    const override = await flagStore.get(flag);

    if (override && override.enabled !== null) {
      let enabled = override.enabled;

      // Check user targeting
      if (override.targetUserIds && override.targetUserIds.length > 0) {
        enabled = override.targetUserIds.includes(userId);
      }

      // Check rollout percentage
      if (enabled && override.rolloutPercentage !== null && override.rolloutPercentage < 100) {
        enabled = this.isUserInRollout(userId, flag, override.rolloutPercentage);
      }

      await cache.set(getUserCacheKey(flag, userId), enabled, CACHE_TTL_SECONDS);
      return enabled;
    }

    // Fall back to global config
    const globalEnabled = await this.isEnabled(flag);
    await cache.set(getUserCacheKey(flag, userId), globalEnabled, CACHE_TTL_SECONDS);
    return globalEnabled;
  }

  /**
   * Set a feature flag override
   */
  async setFlag(
    flag: FeatureFlagKey,
    enabled: boolean | null,
    options?: {
      rolloutPercentage?: number;
      targetUserIds?: string[];
      metadata?: Record<string, unknown>;
      changedBy?: string;
    }
  ): Promise<void> {
    const previousValue = await this.isEnabled(flag);

    const override: FeatureFlagOverride = {
      flag,
      enabled,
      rolloutPercentage: options?.rolloutPercentage ?? null,
      targetUserIds: options?.targetUserIds ?? null,
      metadata: options?.metadata ?? null,
      updatedAt: new Date(),
      updatedBy: options?.changedBy ?? null,
    };

    await flagStore.set(flag, override);

    // Clear cache
    await cache.deletePattern(`feature:${flag}*`);

    // Emit change event
    const newValue = enabled ?? this.getConfigValue(flag);
    if (previousValue !== newValue) {
      log.info(`Feature flag changed: ${flag}`, {
        previousValue,
        newValue,
        changedBy: options?.changedBy,
      });

      eventBus.emit('system:config.changed', {
        key: `feature.${flag}`,
        previousValue: String(previousValue),
        newValue: String(newValue),
        changedBy: options?.changedBy || 'system',
      });
    }
  }

  /**
   * Remove a feature flag override (revert to default)
   */
  async removeOverride(flag: FeatureFlagKey): Promise<void> {
    await flagStore.delete(flag);
    await cache.deletePattern(`feature:${flag}*`);
    log.info(`Feature flag override removed: ${flag}`);
  }

  /**
   * Get detailed status of a feature flag
   */
  async getStatus(flag: FeatureFlagKey): Promise<FeatureFlagStatus> {
    const override = await flagStore.get(flag);

    if (override && override.enabled !== null) {
      return {
        flag,
        enabled: override.enabled,
        source: 'database',
        rolloutPercentage: override.rolloutPercentage,
        targetUserIds: override.targetUserIds,
        updatedAt: override.updatedAt,
      };
    }

    return {
      flag,
      enabled: this.getConfigValue(flag),
      source: this.hasEnvOverride(flag) ? 'environment' : 'default',
      rolloutPercentage: null,
      targetUserIds: null,
      updatedAt: null,
    };
  }

  /**
   * Get status of all feature flags
   */
  async getAllStatus(): Promise<FeatureFlagStatus[]> {
    const flags: FeatureFlagKey[] = [
      'hardwareWalletSigning',
      'qrCodeSigning',
      'multisigWallets',
      'batchSync',
      'payjoinSupport',
      'batchTransactions',
      'rbfTransactions',
      'priceAlerts',
      'aiAssistant',
      'telegramNotifications',
      'websocketV2Events',
      'experimental.taprootAddresses',
      'experimental.silentPayments',
      'experimental.coinJoin',
    ];

    return Promise.all(flags.map(flag => this.getStatus(flag)));
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private getConfigValue(flag: FeatureFlagKey): boolean {
    if (flag.startsWith('experimental.')) {
      const expFlag = flag.replace('experimental.', '') as keyof typeof this.configFlags.experimental;
      return this.configFlags.experimental[expFlag] ?? false;
    }
    // For non-experimental flags, we can safely access as direct properties
    type NonExperimentalKey = keyof Omit<typeof this.configFlags, 'experimental'>;
    return this.configFlags[flag as NonExperimentalKey] ?? false;
  }

  private hasEnvOverride(flag: FeatureFlagKey): boolean {
    // Map flag names to environment variable names
    const envMapping: Record<string, string> = {
      hardwareWalletSigning: 'FEATURE_HARDWARE_WALLET',
      qrCodeSigning: 'FEATURE_QR_SIGNING',
      multisigWallets: 'FEATURE_MULTISIG',
      batchSync: 'FEATURE_BATCH_SYNC',
      payjoinSupport: 'FEATURE_PAYJOIN',
      batchTransactions: 'FEATURE_BATCH_TX',
      rbfTransactions: 'FEATURE_RBF',
      priceAlerts: 'FEATURE_PRICE_ALERTS',
      aiAssistant: 'FEATURE_AI_ASSISTANT',
      telegramNotifications: 'FEATURE_TELEGRAM',
      websocketV2Events: 'FEATURE_WS_V2',
      'experimental.taprootAddresses': 'FEATURE_EXP_TAPROOT',
      'experimental.silentPayments': 'FEATURE_EXP_SILENT_PAYMENTS',
      'experimental.coinJoin': 'FEATURE_EXP_COINJOIN',
    };

    const envVar = envMapping[flag];
    return envVar ? process.env[envVar] !== undefined : false;
  }

  /**
   * Deterministic check if a user is in a rollout percentage
   * Uses consistent hashing so the same user always gets the same result
   */
  private isUserInRollout(userId: string, flag: string, percentage: number): boolean {
    // Simple hash: sum of character codes modulo 100
    const hash = `${userId}:${flag}`.split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0) % 100;
    return hash < percentage;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let featureFlagService: FeatureFlagService | null = null;

export function getFeatureFlagService(): FeatureFlagService {
  if (!featureFlagService) {
    featureFlagService = new FeatureFlagService();
  }
  return featureFlagService;
}

/**
 * Convenience function for checking if a feature is enabled
 */
export async function isFeatureEnabled(flag: FeatureFlagKey): Promise<boolean> {
  return getFeatureFlagService().isEnabled(flag);
}

/**
 * Convenience function for checking if a feature is enabled for a user
 */
export async function isFeatureEnabledForUser(
  flag: FeatureFlagKey,
  userId: string
): Promise<boolean> {
  return getFeatureFlagService().isEnabledForUser(flag, userId);
}
