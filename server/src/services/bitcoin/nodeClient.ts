/**
 * Node Client Abstraction
 *
 * Provides a unified interface for communicating with Bitcoin nodes,
 * supporting both Electrum servers and Bitcoin Core RPC.
 */

import { ElectrumClient, getElectrumClient, resetElectrumClient } from './electrum';
import { BitcoinRpcClient, getBitcoinRpcClient, resetBitcoinRpcClient } from './bitcoinRpc';
import prisma from '../../models/prisma';

export type NodeType = 'electrum' | 'bitcoind';

export interface NodeConfig {
  type: NodeType;
  host: string;
  port: number;
  // Electrum specific
  protocol?: 'tcp' | 'ssl';
  // Bitcoin RPC specific
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface NodeClientInterface {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getBlockHeight(): Promise<number>;
  getBlockHeader(height: number): Promise<string>;
  getAddressHistory(address: string): Promise<Array<{ tx_hash: string; height: number }>>;
  getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }>;
  getAddressUTXOs(address: string): Promise<Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>;
  getTransaction(txid: string, verbose?: boolean): Promise<any>;
  broadcastTransaction(rawTx: string): Promise<string>;
  estimateFee(blocks: number): Promise<number>;
  subscribeAddress(address: string): Promise<string>;
}

// Cache for the active node configuration
let activeConfig: NodeConfig | null = null;
let activeClient: NodeClientInterface | null = null;

/**
 * Load node configuration from database
 */
async function loadNodeConfig(): Promise<NodeConfig | null> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (nodeConfig) {
      // Map database NodeConfig to our NodeConfig interface
      const type: NodeType = nodeConfig.type === 'bitcoin_core' ? 'bitcoind' : 'electrum';
      return {
        type,
        host: nodeConfig.host,
        port: nodeConfig.port,
        protocol: nodeConfig.useSsl ? 'ssl' : 'tcp',
        user: nodeConfig.username || undefined,
        password: nodeConfig.password || undefined,
        ssl: nodeConfig.useSsl,
      };
    }
  } catch (error) {
    console.error('[NODE-CLIENT] Failed to load node config from database:', error);
  }

  return null;
}

/**
 * Save node configuration to database
 */
export async function saveNodeConfig(config: NodeConfig): Promise<void> {
  // Map our NodeConfig to database schema
  const dbType = config.type === 'bitcoind' ? 'bitcoin_core' : 'electrum';

  // First, unset any existing default
  await prisma.nodeConfig.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  // Upsert the new config
  await prisma.nodeConfig.upsert({
    where: { id: 'default' },
    update: {
      type: dbType,
      host: config.host,
      port: config.port,
      useSsl: config.ssl || config.protocol === 'ssl',
      username: config.user,
      password: config.password,
      isDefault: true,
    },
    create: {
      id: 'default',
      type: dbType,
      host: config.host,
      port: config.port,
      useSsl: config.ssl || config.protocol === 'ssl',
      username: config.user,
      password: config.password,
      isDefault: true,
    },
  });

  // Reset the active client when config changes
  activeConfig = config;
  activeClient = null;

  console.log(`[NODE-CLIENT] Saved node config: ${config.type} at ${config.host}:${config.port}`);
}

/**
 * Get the default Electrum config
 */
function getDefaultElectrumConfig(): NodeConfig {
  return {
    type: 'electrum',
    host: process.env.ELECTRUM_HOST || 'electrum.blockstream.info',
    port: parseInt(process.env.ELECTRUM_PORT || '50002', 10),
    protocol: (process.env.ELECTRUM_PROTOCOL as 'tcp' | 'ssl') || 'ssl',
  };
}

/**
 * Get the node client based on active configuration
 */
export async function getNodeClient(): Promise<NodeClientInterface> {
  // Return cached client if available and connected
  if (activeClient && activeClient.isConnected()) {
    return activeClient;
  }

  // Load config from database if not cached
  if (!activeConfig) {
    activeConfig = await loadNodeConfig();
  }

  // Fall back to default Electrum config
  if (!activeConfig) {
    activeConfig = getDefaultElectrumConfig();
  }

  // Create appropriate client based on config type
  if (activeConfig.type === 'bitcoind') {
    if (!activeConfig.user || !activeConfig.password) {
      throw new Error('Bitcoin RPC requires user and password');
    }

    const rpcClient = getBitcoinRpcClient({
      host: activeConfig.host,
      port: activeConfig.port,
      user: activeConfig.user,
      password: activeConfig.password,
      ssl: activeConfig.ssl,
    });

    if (!rpcClient.isConnected()) {
      await rpcClient.connect();
    }

    activeClient = rpcClient;
    console.log(`[NODE-CLIENT] Using Bitcoin RPC at ${activeConfig.host}:${activeConfig.port}`);
  } else {
    // Default to Electrum
    // Note: getElectrumClient reads config from database/env internally
    const electrumClient = getElectrumClient();

    if (!electrumClient.isConnected()) {
      await electrumClient.connect();
    }

    activeClient = electrumClient;
    console.log(`[NODE-CLIENT] Using Electrum at ${activeConfig.host}:${activeConfig.port}`);
  }

  return activeClient;
}

/**
 * Get the current node type
 */
export async function getNodeType(): Promise<NodeType> {
  if (!activeConfig) {
    activeConfig = await loadNodeConfig();
  }
  return activeConfig?.type || 'electrum';
}

/**
 * Get the current node config
 */
export async function getActiveNodeConfig(): Promise<NodeConfig> {
  if (!activeConfig) {
    activeConfig = await loadNodeConfig();
  }
  return activeConfig || getDefaultElectrumConfig();
}

/**
 * Reset the active client (for reconnection or config change)
 */
export function resetNodeClient(): void {
  if (activeClient) {
    activeClient.disconnect();
  }
  activeClient = null;
  activeConfig = null;
  resetElectrumClient();
  resetBitcoinRpcClient();
  console.log('[NODE-CLIENT] Client reset');
}

/**
 * Test a node configuration without activating it
 */
export async function testNodeConfig(config: NodeConfig): Promise<{ success: boolean; message: string; info?: any }> {
  try {
    if (config.type === 'bitcoind') {
      if (!config.user || !config.password) {
        return { success: false, message: 'Bitcoin RPC requires user and password' };
      }

      const testClient = new BitcoinRpcClient({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
      });

      await testClient.connect();
      const height = await testClient.getBlockHeight();
      testClient.disconnect();

      return {
        success: true,
        message: `Connected to Bitcoin Core at block ${height}`,
        info: { blockHeight: height },
      };
    } else {
      // Electrum
      const ElectrumClientClass = (await import('./electrum')).ElectrumClient;
      const testClient = new ElectrumClientClass({
        host: config.host,
        port: config.port,
        protocol: config.protocol || 'ssl',
      });

      await testClient.connect();
      const height = await testClient.getBlockHeight();
      testClient.disconnect();

      return {
        success: true,
        message: `Connected to Electrum server at block ${height}`,
        info: { blockHeight: height },
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Connection failed: ${error.message}`,
    };
  }
}
