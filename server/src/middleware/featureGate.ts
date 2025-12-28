/**
 * Feature Gate Middleware
 *
 * Middleware for gating API endpoints behind feature flags.
 * Returns 403 if the requested feature is not enabled.
 *
 * Usage:
 *   router.post('/payjoin', requireFeature('payjoinSupport'), handler);
 *   router.post('/taproot', requireFeature('experimental.taprootAddresses'), handler);
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config';
import type { FeatureFlagKey, FeatureFlags, ExperimentalFeatures } from '../config/types';
import { createLogger } from '../utils/logger';

const log = createLogger('FEATURE');

/**
 * Get the value of a feature flag by key
 * Supports nested experimental flags via dot notation
 */
function getFeatureValue(flags: FeatureFlags, key: FeatureFlagKey): boolean {
  if (key.startsWith('experimental.')) {
    const experimentalKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
    return flags.experimental[experimentalKey] ?? false;
  }
  return flags[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
}

/**
 * Middleware that requires a feature flag to be enabled
 *
 * @param flag - The feature flag key to check
 * @returns Express middleware that blocks request if feature is disabled
 *
 * @example
 * // Simple feature check
 * router.post('/payjoin', requireFeature('payjoinSupport'), payjoinHandler);
 *
 * // Experimental feature check
 * router.post('/taproot', requireFeature('experimental.taprootAddresses'), taprootHandler);
 */
export function requireFeature(flag: FeatureFlagKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();
    const isEnabled = getFeatureValue(config.features, flag);

    if (!isEnabled) {
      log.info(`Feature gate blocked request`, {
        feature: flag,
        path: req.path,
        method: req.method,
      });

      return res.status(403).json({
        error: 'Feature not available',
        feature: flag,
        message: `The ${flag} feature is not enabled on this server`,
      });
    }

    next();
  };
}

/**
 * Middleware that requires ALL specified features to be enabled
 *
 * @param flags - Array of feature flag keys that must all be enabled
 */
export function requireAllFeatures(flags: FeatureFlagKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();

    const disabledFlags = flags.filter(flag => !getFeatureValue(config.features, flag));

    if (disabledFlags.length > 0) {
      log.info(`Feature gate blocked request (missing features)`, {
        required: flags,
        disabled: disabledFlags,
        path: req.path,
      });

      return res.status(403).json({
        error: 'Features not available',
        requiredFeatures: flags,
        disabledFeatures: disabledFlags,
        message: `This endpoint requires all of these features: ${flags.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * Middleware that requires ANY of the specified features to be enabled
 *
 * @param flags - Array of feature flag keys where at least one must be enabled
 */
export function requireAnyFeature(flags: FeatureFlagKey[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();

    const hasAnyEnabled = flags.some(flag => getFeatureValue(config.features, flag));

    if (!hasAnyEnabled) {
      log.info(`Feature gate blocked request (no matching features)`, {
        anyOf: flags,
        path: req.path,
      });

      return res.status(403).json({
        error: 'Features not available',
        requiredAnyOf: flags,
        message: `This endpoint requires at least one of these features: ${flags.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * Check if a feature is enabled (for use in service code)
 *
 * @param flag - The feature flag key to check
 * @returns boolean indicating if the feature is enabled
 *
 * @example
 * if (isFeatureEnabled('payjoinSupport')) {
 *   // Include payjoin-specific logic
 * }
 */
export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  const config = getConfig();
  return getFeatureValue(config.features, flag);
}

/**
 * Get all enabled features (for diagnostics/admin)
 */
export function getEnabledFeatures(): FeatureFlagKey[] {
  const config = getConfig();
  const enabled: FeatureFlagKey[] = [];

  // Check top-level flags
  const topLevelFlags: (keyof Omit<FeatureFlags, 'experimental'>)[] = [
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
  ];

  for (const flag of topLevelFlags) {
    if (config.features[flag]) {
      enabled.push(flag);
    }
  }

  // Check experimental flags
  const experimentalFlags: (keyof ExperimentalFeatures)[] = [
    'taprootAddresses',
    'silentPayments',
    'coinJoin',
  ];

  for (const flag of experimentalFlags) {
    if (config.features.experimental[flag]) {
      enabled.push(`experimental.${flag}` as FeatureFlagKey);
    }
  }

  return enabled;
}

/**
 * Get feature flags summary (for health/admin endpoints)
 */
export function getFeatureFlagsSummary(): {
  total: number;
  enabled: number;
  disabled: number;
  experimental: {
    total: number;
    enabled: number;
  };
  flags: Record<string, boolean>;
} {
  const config = getConfig();
  const flags: Record<string, boolean> = {};

  // Top-level flags
  const topLevelFlags: (keyof Omit<FeatureFlags, 'experimental'>)[] = [
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
  ];

  let enabledCount = 0;
  for (const flag of topLevelFlags) {
    flags[flag] = config.features[flag];
    if (config.features[flag]) enabledCount++;
  }

  // Experimental flags
  const experimentalFlags: (keyof ExperimentalFeatures)[] = [
    'taprootAddresses',
    'silentPayments',
    'coinJoin',
  ];

  let experimentalEnabled = 0;
  for (const flag of experimentalFlags) {
    flags[`experimental.${flag}`] = config.features.experimental[flag];
    if (config.features.experimental[flag]) {
      enabledCount++;
      experimentalEnabled++;
    }
  }

  const total = topLevelFlags.length + experimentalFlags.length;

  return {
    total,
    enabled: enabledCount,
    disabled: total - enabledCount,
    experimental: {
      total: experimentalFlags.length,
      enabled: experimentalEnabled,
    },
    flags,
  };
}
