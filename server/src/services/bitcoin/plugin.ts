/**
 * Bitcoin Service Plugin Interface
 *
 * Defines extensible interfaces for Bitcoin-related services.
 * Allows adding new blockchain providers, fee estimators, and price sources.
 *
 * ## Architecture
 *
 * Plugins implement specific interfaces and register with the plugin manager.
 * The application uses plugins through the manager, enabling runtime switching.
 *
 * ## Plugin Types
 *
 * - BlockchainProvider: Electrum, Bitcoin Core RPC, etc.
 * - FeeEstimator: Mempool.space, Blockstream, local node
 * - PriceProvider: CoinGecko, Kraken, custom sources
 *
 * ## Usage
 *
 * ```typescript
 * // Register a plugin
 * registerPlugin('blockchain', 'electrum', new ElectrumProvider(config));
 *
 * // Use through manager
 * const provider = getPlugin<BlockchainProvider>('blockchain');
 * const balance = await provider.getAddressBalance(address);
 * ```
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('BitcoinPlugin');

// =============================================================================
// Core Interfaces
// =============================================================================

/**
 * Base plugin interface
 */
export interface Plugin {
  /** Unique plugin identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Plugin version */
  readonly version: string;
  /** Initialize plugin */
  initialize(): Promise<void>;
  /** Shutdown plugin */
  shutdown(): Promise<void>;
  /** Health check */
  healthCheck(): Promise<PluginHealthStatus>;
}

export interface PluginHealthStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Blockchain Provider Interface
// =============================================================================

export interface UTXO {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: string;
  confirmations: number;
}

export interface TransactionInfo {
  txid: string;
  confirmations: number;
  blockHeight?: number;
  blockTime?: Date;
  fee?: bigint;
  size?: number;
  vsize?: number;
}

export interface AddressHistory {
  txid: string;
  height: number;
}

/**
 * Blockchain data provider interface
 */
export interface BlockchainProvider extends Plugin {
  readonly type: 'blockchain';

  /** Get UTXOs for an address */
  getAddressUtxos(address: string): Promise<UTXO[]>;

  /** Get transaction history for an address */
  getAddressHistory(address: string): Promise<AddressHistory[]>;

  /** Get transaction details */
  getTransaction(txid: string): Promise<TransactionInfo | null>;

  /** Broadcast a raw transaction */
  broadcastTransaction(rawTx: string): Promise<string>;

  /** Get current block height */
  getBlockHeight(): Promise<number>;

  /** Subscribe to address notifications */
  subscribeAddress?(address: string, callback: (txid: string) => void): Promise<void>;

  /** Unsubscribe from address notifications */
  unsubscribeAddress?(address: string): Promise<void>;
}

// =============================================================================
// Fee Estimator Interface
// =============================================================================

export interface FeeEstimate {
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Target confirmation blocks */
  targetBlocks: number;
}

/**
 * Fee estimation provider interface
 */
export interface FeeEstimator extends Plugin {
  readonly type: 'fee';

  /** Get fee estimates for different confirmation targets */
  getEstimates(): Promise<FeeEstimate[]>;

  /** Get fee for specific confirmation target */
  getEstimateForTarget(targetBlocks: number): Promise<number>;

  /** Get recommended fee tiers (high, medium, low) */
  getRecommendedFees(): Promise<{
    high: number;
    medium: number;
    low: number;
    minimum: number;
  }>;
}

// =============================================================================
// Price Provider Interface
// =============================================================================

export interface PriceData {
  /** Price in USD */
  usd: number;
  /** 24h change percentage */
  change24h?: number;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Price data provider interface
 */
export interface PriceProvider extends Plugin {
  readonly type: 'price';

  /** Get current BTC price */
  getCurrentPrice(): Promise<PriceData>;

  /** Get historical prices */
  getHistoricalPrices(days: number): Promise<Array<{ date: Date; price: number }>>;

  /** Get price at specific time */
  getPriceAt?(timestamp: Date): Promise<number>;
}

// =============================================================================
// Plugin Registry
// =============================================================================

type PluginType = 'blockchain' | 'fee' | 'price';
type AnyPlugin = BlockchainProvider | FeeEstimator | PriceProvider;

interface PluginEntry {
  plugin: AnyPlugin;
  priority: number;
  enabled: boolean;
}

const plugins = new Map<PluginType, Map<string, PluginEntry>>();
const activePlugins = new Map<PluginType, string>();

/**
 * Register a plugin
 */
export function registerPlugin(
  type: PluginType,
  id: string,
  plugin: AnyPlugin,
  options?: { priority?: number; setActive?: boolean }
): void {
  const priority = options?.priority ?? 0;

  if (!plugins.has(type)) {
    plugins.set(type, new Map());
  }

  const typePlugins = plugins.get(type)!;
  typePlugins.set(id, { plugin, priority, enabled: true });

  log.info('Plugin registered', { type, id, name: plugin.name, priority });

  // Set as active if requested or if first plugin of this type
  if (options?.setActive || !activePlugins.has(type)) {
    activePlugins.set(type, id);
    log.info('Plugin set as active', { type, id });
  }
}

/**
 * Unregister a plugin
 */
export function unregisterPlugin(type: PluginType, id: string): void {
  const typePlugins = plugins.get(type);
  if (typePlugins) {
    typePlugins.delete(id);
    log.info('Plugin unregistered', { type, id });

    // If this was the active plugin, select next highest priority
    if (activePlugins.get(type) === id) {
      const nextPlugin = selectHighestPriority(type);
      if (nextPlugin) {
        activePlugins.set(type, nextPlugin);
        log.info('New active plugin selected', { type, id: nextPlugin });
      } else {
        activePlugins.delete(type);
      }
    }
  }
}

/**
 * Get the active plugin for a type
 */
export function getPlugin<T extends AnyPlugin>(type: PluginType): T | null {
  const activeId = activePlugins.get(type);
  if (!activeId) return null;

  const typePlugins = plugins.get(type);
  if (!typePlugins) return null;

  const entry = typePlugins.get(activeId);
  if (!entry || !entry.enabled) return null;

  return entry.plugin as T;
}

/**
 * Get all plugins of a type
 */
export function getPlugins<T extends AnyPlugin>(type: PluginType): T[] {
  const typePlugins = plugins.get(type);
  if (!typePlugins) return [];

  return Array.from(typePlugins.values())
    .filter((e) => e.enabled)
    .sort((a, b) => b.priority - a.priority)
    .map((e) => e.plugin as T);
}

/**
 * Set the active plugin for a type
 */
export function setActivePlugin(type: PluginType, id: string): boolean {
  const typePlugins = plugins.get(type);
  if (!typePlugins || !typePlugins.has(id)) {
    log.warn('Cannot set active plugin - not found', { type, id });
    return false;
  }

  activePlugins.set(type, id);
  log.info('Active plugin changed', { type, id });
  return true;
}

/**
 * Enable/disable a plugin
 */
export function setPluginEnabled(type: PluginType, id: string, enabled: boolean): void {
  const typePlugins = plugins.get(type);
  if (!typePlugins) return;

  const entry = typePlugins.get(id);
  if (entry) {
    entry.enabled = enabled;
    log.info('Plugin enabled state changed', { type, id, enabled });
  }
}

/**
 * Select highest priority enabled plugin
 */
function selectHighestPriority(type: PluginType): string | null {
  const typePlugins = plugins.get(type);
  if (!typePlugins) return null;

  let highest: { id: string; priority: number } | null = null;

  for (const [id, entry] of typePlugins.entries()) {
    if (entry.enabled && (!highest || entry.priority > highest.priority)) {
      highest = { id, priority: entry.priority };
    }
  }

  return highest?.id ?? null;
}

// =============================================================================
// Plugin Lifecycle
// =============================================================================

/**
 * Initialize all registered plugins
 */
export async function initializeAllPlugins(): Promise<void> {
  log.info('Initializing all plugins');

  for (const [type, typePlugins] of plugins.entries()) {
    for (const [id, entry] of typePlugins.entries()) {
      try {
        await entry.plugin.initialize();
        log.info('Plugin initialized', { type, id });
      } catch (error) {
        log.error('Plugin initialization failed', {
          type,
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        entry.enabled = false;
      }
    }
  }
}

/**
 * Shutdown all registered plugins
 */
export async function shutdownAllPlugins(): Promise<void> {
  log.info('Shutting down all plugins');

  for (const [type, typePlugins] of plugins.entries()) {
    for (const [id, entry] of typePlugins.entries()) {
      try {
        await entry.plugin.shutdown();
        log.info('Plugin shutdown', { type, id });
      } catch (error) {
        log.error('Plugin shutdown failed', {
          type,
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  // Clear registries
  plugins.clear();
  activePlugins.clear();
}

/**
 * Health check all plugins
 */
export async function checkAllPluginsHealth(): Promise<
  Map<string, { type: PluginType; status: PluginHealthStatus }>
> {
  const results = new Map<string, { type: PluginType; status: PluginHealthStatus }>();

  for (const [type, typePlugins] of plugins.entries()) {
    for (const [id, entry] of typePlugins.entries()) {
      try {
        const status = await entry.plugin.healthCheck();
        results.set(id, { type, status });
      } catch (error) {
        results.set(id, {
          type,
          status: {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
  }

  return results;
}
