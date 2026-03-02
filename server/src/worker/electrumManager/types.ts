/**
 * Electrum Manager Types
 *
 * Shared types, interfaces, and configuration constants for
 * the Electrum subscription manager modules.
 */

import type { ElectrumClient } from '../../services/bitcoin/electrum';

export type BitcoinNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';

export interface ElectrumManagerCallbacks {
  /** Called when a new block is received */
  onNewBlock: (network: BitcoinNetwork, height: number, hash: string) => void;
  /** Called when address activity is detected */
  onAddressActivity: (network: BitcoinNetwork, walletId: string, address: string) => void;
}

export interface NetworkState {
  network: BitcoinNetwork;
  client: ElectrumClient;
  connected: boolean;
  subscribedToHeaders: boolean;
  subscribedAddresses: Set<string>;
  lastBlockHeight: number;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
}

// Configuration constants
export const RECONNECT_BASE_DELAY_MS = 5000; // 5 seconds
export const RECONNECT_MAX_DELAY_MS = 60000; // 1 minute
export const RECONNECT_MAX_ATTEMPTS = 10; // After this, log error but keep trying
export const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
export const SUBSCRIPTION_BATCH_SIZE = 500; // Max addresses per batch subscription
export const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';
export const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 2 * 60 * 1000;
export const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = 60 * 1000;
