/**
 * Network Provider Module
 *
 * Provides a pluggable interface for Bitcoin network data providers.
 * Supports Electrum protocol and can be extended for Esplora or other backends.
 *
 * ## Usage
 *
 * ```typescript
 * import { createProvider, getProvider } from './providers';
 *
 * // Create a provider explicitly
 * const provider = await createProvider({
 *   type: 'electrum',
 *   network: 'mainnet',
 *   host: 'electrum.example.com',
 *   port: 50002,
 *   protocol: 'ssl',
 * });
 *
 * // Or get the default provider for a network
 * const mainnetProvider = await getProvider('mainnet');
 * ```
 */

import { createLogger } from '../../../utils/logger';
import type {
  INetworkProvider,
  ProviderType,
  ProviderConfig,
  ProviderFactory,
  ProviderRegistry,
  BitcoinNetwork,
} from './types';

const log = createLogger('NetworkProvider');

// =============================================================================
// Provider Registry
// =============================================================================

/**
 * Registry for network provider factories
 */
class ProviderRegistryImpl implements ProviderRegistry {
  private factories = new Map<ProviderType, ProviderFactory>();

  register(type: ProviderType, factory: ProviderFactory): void {
    this.factories.set(type, factory);
    log.debug(`Registered provider type: ${type}`);
  }

  async create(config: ProviderConfig): Promise<INetworkProvider> {
    const factory = this.factories.get(config.type);

    if (!factory) {
      throw new Error(`Unknown provider type: ${config.type}`);
    }

    const provider = await factory(config);
    log.debug(`Created ${config.type} provider for ${config.network}`);
    return provider;
  }

  getTypes(): ProviderType[] {
    return Array.from(this.factories.keys());
  }
}

/**
 * Global provider registry
 */
export const providerRegistry = new ProviderRegistryImpl();

// =============================================================================
// Provider Pool
// =============================================================================

/**
 * Manages a pool of providers for different networks
 */
class ProviderPool {
  private providers = new Map<BitcoinNetwork, INetworkProvider>();
  private configs = new Map<BitcoinNetwork, ProviderConfig>();

  /**
   * Configure a provider for a network
   */
  configure(network: BitcoinNetwork, config: ProviderConfig): void {
    this.configs.set(network, { ...config, network });
    // Clear existing provider so it gets recreated with new config
    const existing = this.providers.get(network);
    if (existing) {
      existing.disconnect().catch(() => {});
      this.providers.delete(network);
    }
  }

  /**
   * Get or create a provider for a network
   */
  async get(network: BitcoinNetwork): Promise<INetworkProvider> {
    let provider = this.providers.get(network);

    if (!provider) {
      const config = this.configs.get(network);

      if (!config) {
        throw new Error(`No provider configured for network: ${network}`);
      }

      provider = await providerRegistry.create(config);
      this.providers.set(network, provider);
    }

    // Ensure connected
    if (!provider.isConnected()) {
      await provider.connect();
    }

    return provider;
  }

  /**
   * Check if a provider is configured for a network
   */
  has(network: BitcoinNetwork): boolean {
    return this.configs.has(network);
  }

  /**
   * Disconnect all providers
   */
  async disconnectAll(): Promise<void> {
    const disconnects = Array.from(this.providers.values()).map(p =>
      p.disconnect().catch(err => {
        log.error('Error disconnecting provider', { error: err.message });
      })
    );
    await Promise.all(disconnects);
    this.providers.clear();
  }
}

/**
 * Global provider pool
 */
export const providerPool = new ProviderPool();

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a network provider with explicit configuration
 */
export async function createProvider(config: ProviderConfig): Promise<INetworkProvider> {
  return providerRegistry.create(config);
}

/**
 * Get a provider for a specific network
 * Uses the pool to reuse connections
 */
export async function getProvider(network: BitcoinNetwork): Promise<INetworkProvider> {
  return providerPool.get(network);
}

/**
 * Configure the provider for a network
 */
export function configureProvider(network: BitcoinNetwork, config: ProviderConfig): void {
  providerPool.configure(network, config);
}

/**
 * Disconnect all providers (for cleanup)
 */
export async function disconnectAll(): Promise<void> {
  await providerPool.disconnectAll();
}

// =============================================================================
// Re-exports
// =============================================================================

export type {
  INetworkProvider,
  ProviderType,
  ProviderConfig,
  ElectrumProviderConfig,
  EsploraProviderConfig,
  BitcoinNetwork,
  AddressBalance,
  TransactionHistoryEntry,
  UTXO,
  RawTransaction,
  BlockHeader,
  FeeEstimates,
  ProviderHealth,
} from './types';
