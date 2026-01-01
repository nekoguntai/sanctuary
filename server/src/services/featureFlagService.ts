/**
 * Feature Flag Service
 *
 * Persistent feature flags with database storage and audit trail.
 * Supports runtime toggling while respecting environment defaults.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │                   Feature Flag Service                   │
 * ├─────────────────────────────────────────────────────────┤
 * │  1. Environment defaults (config)                       │
 * │  2. Database overrides (persistent)                     │
 * │  3. Runtime cache (fast lookups)                        │
 * └─────────────────────────────────────────────────────────┘
 *                           │
 *                           ▼
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Audit Trail                           │
 * │  - Who changed what                                      │
 * │  - Previous/new values                                   │
 * │  - Timestamps & IP addresses                             │
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * // Check if feature is enabled
 * const enabled = await featureFlagService.isEnabled('aiAssistant');
 *
 * // Toggle a feature (admin only)
 * await featureFlagService.setFlag('aiAssistant', true, {
 *   userId: 'admin-123',
 *   reason: 'Enabling AI for beta testing',
 *   ipAddress: req.ip,
 * });
 *
 * // Get audit history
 * const history = await featureFlagService.getAuditLog('aiAssistant');
 * ```
 */

import { getConfig, type FeatureFlags, type FeatureFlagKey, type ExperimentalFeatures } from '../config';
import prisma from '../models/prisma';
import { getDistributedCache } from '../infrastructure';
import { createLogger } from '../utils/logger';

const log = createLogger('FeatureFlags');

// =============================================================================
// Types
// =============================================================================

export interface FeatureFlagInfo {
  key: string;
  enabled: boolean;
  description: string | null;
  category: string;
  source: 'environment' | 'database';
  modifiedBy: string | null;
  updatedAt: Date | null;
}

export interface SetFlagOptions {
  userId: string;
  reason?: string;
  ipAddress?: string;
}

export interface AuditEntry {
  id: string;
  key: string;
  previousValue: boolean;
  newValue: boolean;
  changedBy: string;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

// =============================================================================
// Feature Flag Definitions
// =============================================================================

const FEATURE_DESCRIPTIONS: Record<string, { description: string; category: string }> = {
  hardwareWalletSigning: { description: 'Enable hardware wallet signing support', category: 'general' },
  qrCodeSigning: { description: 'Enable QR code based transaction signing', category: 'general' },
  multisigWallets: { description: 'Enable multi-signature wallet support', category: 'general' },
  batchSync: { description: 'Enable batch synchronization of wallets', category: 'general' },
  payjoinSupport: { description: 'Enable PayJoin (BIP78) transaction support', category: 'general' },
  batchTransactions: { description: 'Enable batch transaction creation', category: 'general' },
  rbfTransactions: { description: 'Enable Replace-By-Fee transaction support', category: 'general' },
  priceAlerts: { description: 'Enable price alert notifications', category: 'general' },
  aiAssistant: { description: 'Enable AI-powered transaction analysis', category: 'general' },
  telegramNotifications: { description: 'Enable Telegram bot notifications', category: 'general' },
  websocketV2Events: { description: 'Enable WebSocket v2 event format', category: 'general' },
  'experimental.taprootAddresses': { description: 'Enable Taproot (P2TR) address support', category: 'experimental' },
  'experimental.silentPayments': { description: 'Enable Silent Payments (BIP352)', category: 'experimental' },
  'experimental.coinJoin': { description: 'Enable CoinJoin transaction support', category: 'experimental' },
};

// =============================================================================
// Cache
// =============================================================================

const CACHE_KEY = 'feature:flags';
const CACHE_TTL = 60; // 1 minute cache

// =============================================================================
// Service
// =============================================================================

class FeatureFlagService {
  private initialized = false;
  private localCache: Map<string, boolean> = new Map();

  /**
   * Initialize the service - sync environment defaults to database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing feature flag service');

    try {
      const config = getConfig();

      // Get all environment-defined flags
      const envFlags = this.getEnvironmentFlags(config.features);

      // Sync to database (insert if not exists)
      for (const [key, enabled] of Object.entries(envFlags)) {
        const existing = await prisma.featureFlag.findUnique({ where: { key } });

        if (!existing) {
          const meta = FEATURE_DESCRIPTIONS[key] || { description: null, category: 'general' };
          await prisma.featureFlag.create({
            data: {
              key,
              enabled,
              description: meta.description,
              category: meta.category,
              modifiedBy: 'system',
            },
          });
          log.debug(`Created feature flag: ${key} = ${enabled}`);
        }
      }

      // Load all flags into local cache
      await this.refreshCache();

      this.initialized = true;
      log.info('Feature flag service initialized', {
        flagCount: this.localCache.size,
      });
    } catch (error) {
      log.error('Failed to initialize feature flag service', { error });
      // Fall back to environment-only mode
      this.initialized = true;
    }
  }

  /**
   * Get environment-defined flags as flat key-value pairs
   */
  private getEnvironmentFlags(features: FeatureFlags): Record<string, boolean> {
    const flags: Record<string, boolean> = {};

    // Top-level flags
    const topLevel = ['hardwareWalletSigning', 'qrCodeSigning', 'multisigWallets',
      'batchSync', 'payjoinSupport', 'batchTransactions', 'rbfTransactions',
      'priceAlerts', 'aiAssistant', 'telegramNotifications', 'websocketV2Events'] as const;

    for (const key of topLevel) {
      flags[key] = features[key];
    }

    // Experimental flags
    const experimental = ['taprootAddresses', 'silentPayments', 'coinJoin'] as const;
    for (const key of experimental) {
      flags[`experimental.${key}`] = features.experimental[key];
    }

    return flags;
  }

  /**
   * Refresh the local cache from database
   */
  private async refreshCache(): Promise<void> {
    try {
      const flags = await prisma.featureFlag.findMany();

      this.localCache.clear();
      for (const flag of flags) {
        this.localCache.set(flag.key, flag.enabled);
      }

      // Also update distributed cache
      const cache = getDistributedCache();
      await cache.set(CACHE_KEY, Object.fromEntries(this.localCache), CACHE_TTL);
    } catch (error) {
      log.error('Failed to refresh feature flag cache', { error });
    }
  }

  /**
   * Check if a feature is enabled
   */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    // Try local cache first
    if (this.localCache.has(key)) {
      return this.localCache.get(key)!;
    }

    // Try distributed cache
    try {
      const cache = getDistributedCache();
      const cached = await cache.get<Record<string, boolean>>(CACHE_KEY);
      if (cached && key in cached) {
        this.localCache.set(key, cached[key]);
        return cached[key];
      }
    } catch {
      // Continue to database lookup
    }

    // Fall back to database
    try {
      const flag = await prisma.featureFlag.findUnique({ where: { key } });
      if (flag) {
        this.localCache.set(key, flag.enabled);
        return flag.enabled;
      }
    } catch {
      // Continue to environment fallback
    }

    // Final fallback: environment config
    const config = getConfig();
    if (key.startsWith('experimental.')) {
      const expKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
      return config.features.experimental[expKey] ?? false;
    }
    return config.features[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
  }

  /**
   * Set a feature flag value
   */
  async setFlag(key: FeatureFlagKey, enabled: boolean, options: SetFlagOptions): Promise<void> {
    // Get current value
    const current = await prisma.featureFlag.findUnique({ where: { key } });
    if (!current) {
      throw new Error(`Feature flag '${key}' does not exist`);
    }

    const previousValue = current.enabled;
    if (previousValue === enabled) {
      log.debug(`Feature flag ${key} already set to ${enabled}`);
      return;
    }

    // Update flag and create audit entry in a transaction
    await prisma.$transaction([
      prisma.featureFlag.update({
        where: { key },
        data: {
          enabled,
          modifiedBy: options.userId,
        },
      }),
      prisma.featureFlagAudit.create({
        data: {
          featureFlagId: current.id,
          key,
          previousValue,
          newValue: enabled,
          changedBy: options.userId,
          reason: options.reason,
          ipAddress: options.ipAddress,
        },
      }),
    ]);

    // Invalidate caches
    this.localCache.set(key, enabled);
    const cache = getDistributedCache();
    await cache.delete(CACHE_KEY);

    log.info('Feature flag updated', {
      key,
      previousValue,
      newValue: enabled,
      changedBy: options.userId,
      reason: options.reason,
    });
  }

  /**
   * Get all feature flags with metadata
   */
  async getAllFlags(): Promise<FeatureFlagInfo[]> {
    const flags = await prisma.featureFlag.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    return flags.map((flag) => ({
      key: flag.key,
      enabled: flag.enabled,
      description: flag.description,
      category: flag.category,
      source: 'database' as const,
      modifiedBy: flag.modifiedBy,
      updatedAt: flag.updatedAt,
    }));
  }

  /**
   * Get audit log for a specific flag or all flags
   */
  async getAuditLog(key?: string, limit = 50): Promise<AuditEntry[]> {
    const where = key ? { key } : undefined;
    const entries = await prisma.featureFlagAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return entries.map((entry) => ({
      id: entry.id,
      key: entry.key,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      changedBy: entry.changedBy,
      reason: entry.reason,
      ipAddress: entry.ipAddress,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Get flag info by key
   */
  async getFlag(key: FeatureFlagKey): Promise<FeatureFlagInfo | null> {
    const flag = await prisma.featureFlag.findUnique({ where: { key } });

    if (!flag) return null;

    return {
      key: flag.key,
      enabled: flag.enabled,
      description: flag.description,
      category: flag.category,
      source: 'database',
      modifiedBy: flag.modifiedBy,
      updatedAt: flag.updatedAt,
    };
  }

  /**
   * Reset a flag to its environment default
   */
  async resetToDefault(key: FeatureFlagKey, options: SetFlagOptions): Promise<void> {
    const config = getConfig();
    let defaultValue: boolean;

    if (key.startsWith('experimental.')) {
      const expKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
      defaultValue = config.features.experimental[expKey] ?? false;
    } else {
      defaultValue = config.features[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
    }

    await this.setFlag(key, defaultValue, {
      ...options,
      reason: options.reason || 'Reset to environment default',
    });
  }

  /**
   * Bulk update multiple flags
   */
  async bulkUpdate(
    updates: Array<{ key: FeatureFlagKey; enabled: boolean }>,
    options: SetFlagOptions
  ): Promise<void> {
    for (const update of updates) {
      await this.setFlag(update.key, update.enabled, options);
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

export const featureFlagService = new FeatureFlagService();

export default featureFlagService;
