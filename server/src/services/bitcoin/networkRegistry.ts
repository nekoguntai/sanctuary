/**
 * Network Handler Registry
 *
 * Extensible registry pattern for blockchain network-specific handlers.
 * Allows adding new networks without modifying existing code.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('NETWORK');

export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';

export interface ElectrumServerConfig {
  host: string;
  port: number;
  ssl: boolean;
  priority?: number;
}

export interface NetworkConfig {
  /** Human-readable network name */
  displayName: string;
  /** BIP44 coin type */
  coinType: number;
  /** Address prefixes for validation */
  addressPrefixes: {
    p2pkh: string[];
    p2sh: string[];
    bech32: string;
  };
  /** Default block explorer URL */
  explorerUrl: string;
  /** Default Electrum servers */
  defaultElectrumServers: ElectrumServerConfig[];
  /** Whether this is a test network */
  isTestnet: boolean;
  /** Minimum confirmations for "confirmed" */
  minConfirmations: number;
  /** Genesis block hash for validation */
  genesisHash: string;
}

export interface NetworkHandler {
  /** Get network configuration */
  getConfig(): NetworkConfig;
  /** Validate a Bitcoin address for this network */
  validateAddress(address: string): boolean;
  /** Get explorer URL for a transaction */
  getTransactionUrl(txid: string): string;
  /** Get explorer URL for an address */
  getAddressUrl(address: string): string;
  /** Get explorer URL for a block */
  getBlockUrl(blockHash: string): string;
}

/**
 * Base network handler with common functionality
 */
abstract class BaseNetworkHandler implements NetworkHandler {
  protected abstract config: NetworkConfig;

  getConfig(): NetworkConfig {
    return this.config;
  }

  validateAddress(address: string): boolean {
    const { addressPrefixes } = this.config;

    // Legacy P2PKH
    if (addressPrefixes.p2pkh.some(prefix => address.startsWith(prefix))) {
      return address.length >= 26 && address.length <= 35;
    }

    // P2SH
    if (addressPrefixes.p2sh.some(prefix => address.startsWith(prefix))) {
      return address.length >= 26 && address.length <= 35;
    }

    // Bech32/Bech32m
    if (address.toLowerCase().startsWith(addressPrefixes.bech32)) {
      return address.length >= 42 && address.length <= 90;
    }

    return false;
  }

  getTransactionUrl(txid: string): string {
    return `${this.config.explorerUrl}/tx/${txid}`;
  }

  getAddressUrl(address: string): string {
    return `${this.config.explorerUrl}/address/${address}`;
  }

  getBlockUrl(blockHash: string): string {
    return `${this.config.explorerUrl}/block/${blockHash}`;
  }
}

/**
 * Mainnet handler
 */
class MainnetHandler extends BaseNetworkHandler {
  protected config: NetworkConfig = {
    displayName: 'Bitcoin Mainnet',
    coinType: 0,
    addressPrefixes: {
      p2pkh: ['1'],
      p2sh: ['3'],
      bech32: 'bc1',
    },
    explorerUrl: 'https://mempool.space',
    defaultElectrumServers: [
      { host: 'electrum.blockstream.info', port: 50002, ssl: true, priority: 1 },
      { host: 'electrum.emzy.de', port: 50002, ssl: true, priority: 2 },
      { host: 'electrum.bitaroo.net', port: 50002, ssl: true, priority: 3 },
    ],
    isTestnet: false,
    minConfirmations: 6,
    genesisHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  };
}

/**
 * Testnet handler
 */
class TestnetHandler extends BaseNetworkHandler {
  protected config: NetworkConfig = {
    displayName: 'Bitcoin Testnet',
    coinType: 1,
    addressPrefixes: {
      p2pkh: ['m', 'n'],
      p2sh: ['2'],
      bech32: 'tb1',
    },
    explorerUrl: 'https://mempool.space/testnet',
    defaultElectrumServers: [
      { host: 'electrum.blockstream.info', port: 60002, ssl: true, priority: 1 },
      { host: 'testnet.aranguren.org', port: 51002, ssl: true, priority: 2 },
    ],
    isTestnet: true,
    minConfirmations: 1,
    genesisHash: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  };
}

/**
 * Signet handler
 */
class SignetHandler extends BaseNetworkHandler {
  protected config: NetworkConfig = {
    displayName: 'Bitcoin Signet',
    coinType: 1,
    addressPrefixes: {
      p2pkh: ['m', 'n'],
      p2sh: ['2'],
      bech32: 'tb1',
    },
    explorerUrl: 'https://mempool.space/signet',
    defaultElectrumServers: [
      { host: 'electrum.blockstream.info', port: 60602, ssl: true, priority: 1 },
    ],
    isTestnet: true,
    minConfirmations: 1,
    genesisHash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  };
}

/**
 * Regtest handler
 */
class RegtestHandler extends BaseNetworkHandler {
  protected config: NetworkConfig = {
    displayName: 'Bitcoin Regtest',
    coinType: 1,
    addressPrefixes: {
      p2pkh: ['m', 'n'],
      p2sh: ['2'],
      bech32: 'bcrt1',
    },
    explorerUrl: 'http://localhost:3000',
    defaultElectrumServers: [
      { host: 'localhost', port: 50001, ssl: false, priority: 1 },
    ],
    isTestnet: true,
    minConfirmations: 1,
    genesisHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
  };
}

/**
 * Network Registry
 */
class NetworkRegistry {
  private handlers = new Map<NetworkType, NetworkHandler>();

  constructor() {
    // Register default handlers
    this.register('mainnet', new MainnetHandler());
    this.register('testnet', new TestnetHandler());
    this.register('signet', new SignetHandler());
    this.register('regtest', new RegtestHandler());
  }

  /**
   * Register a network handler
   */
  register(network: NetworkType, handler: NetworkHandler): void {
    this.handlers.set(network, handler);
    log.debug(`Registered network handler: ${network}`);
  }

  /**
   * Get handler for a network
   */
  get(network: NetworkType): NetworkHandler {
    const handler = this.handlers.get(network);
    if (!handler) {
      throw new Error(`Unknown network: ${network}`);
    }
    return handler;
  }

  /**
   * Check if a network is registered
   */
  has(network: NetworkType): boolean {
    return this.handlers.has(network);
  }

  /**
   * Get all registered networks
   */
  getAll(): NetworkType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get configuration for a network
   */
  getConfig(network: NetworkType): NetworkConfig {
    return this.get(network).getConfig();
  }

  /**
   * Validate an address for any registered network
   * Returns the network type if valid, null if invalid
   */
  detectNetwork(address: string): NetworkType | null {
    for (const [network, handler] of this.handlers) {
      if (handler.validateAddress(address)) {
        return network;
      }
    }
    return null;
  }
}

// Singleton instance
export const networkRegistry = new NetworkRegistry();

// Convenience exports
export function getNetworkHandler(network: NetworkType): NetworkHandler {
  return networkRegistry.get(network);
}

export function getNetworkConfig(network: NetworkType): NetworkConfig {
  return networkRegistry.getConfig(network);
}

export function validateAddressForNetwork(address: string, network: NetworkType): boolean {
  return networkRegistry.get(network).validateAddress(address);
}

export function detectNetworkFromAddress(address: string): NetworkType | null {
  return networkRegistry.detectNetwork(address);
}
