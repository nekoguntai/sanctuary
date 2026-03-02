/**
 * Electrum Manager - Barrel Export
 *
 * Re-exports the public API so that existing imports
 * (e.g., `from './electrumManager'`) continue to work unchanged.
 */

export { ElectrumSubscriptionManager } from './electrumManager';
export type { BitcoinNetwork, ElectrumManagerCallbacks } from './types';
