/**
 * Feature Flags Middleware
 *
 * Middleware for enforcing feature flags on routes.
 * Use this to gate access to features that can be enabled/disabled at runtime.
 *
 * @deprecated Use `requireFeature` from `./featureGate` instead for full support
 *             of nested experimental features (e.g., 'experimental.taprootAddresses').
 *             This module only supports top-level boolean flags.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig, type FeatureFlags, type ExperimentalFeatures } from '../config';

/**
 * Type for top-level boolean feature flags only
 * Excludes the nested 'experimental' object
 */
type TopLevelFeatureFlag = Exclude<keyof FeatureFlags, 'experimental'>;

/**
 * Require a specific feature flag to be enabled
 * Returns 403 if the feature is disabled
 *
 * @deprecated Use `requireFeature` from `./featureGate` for full nested support
 *
 * Usage:
 *   router.post('/sign/qr', requireFeature('qrCodeSigning'), signWithQRHandler);
 */
export function requireFeature(flag: TopLevelFeatureFlag) {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = getConfig();
    const enabled = config.features[flag];

    if (!enabled) {
      return res.status(403).json({
        error: 'Feature not enabled',
        feature: flag,
        message: `The ${flag} feature is currently disabled.`,
      });
    }

    next();
  };
}

/**
 * Check if a feature is enabled
 * Useful for conditional logic within handlers
 *
 * @deprecated Use `isFeatureEnabled` from `./featureGate` for full nested support
 *
 * Usage:
 *   if (isFeatureEnabled('priceAlerts')) {
 *     // do something
 *   }
 */
export function isFeatureEnabled(flag: TopLevelFeatureFlag): boolean {
  return getConfig().features[flag];
}

/**
 * Get all feature flags
 * Useful for exposing feature state to frontend
 */
export function getAllFeatureFlags(): FeatureFlags {
  return getConfig().features;
}
