/**
 * Electrum Network Provider
 *
 * Implements INetworkProvider using the existing Electrum client.
 * This is an adapter that wraps the legacy ElectrumClient.
 *
 * ## Registration
 *
 * ```typescript
 * import { providerRegistry } from './providers';
 * import { electrumProviderFactory } from './providers/electrumProvider';
 *
 * providerRegistry.register('electrum', electrumProviderFactory);
 * ```
 */

import ElectrumClient from '../electrum';
import { createLogger } from '../../../utils/logger';
import { traceExternalCall } from '../../../utils/tracing';
import type {
  INetworkProvider,
  ProviderConfig,
  ElectrumProviderConfig,
  BitcoinNetwork,
  AddressBalance,
  TransactionHistoryEntry,
  UTXO,
  RawTransaction,
  BlockHeader,
  FeeEstimates,
  ProviderHealth,
  AddressCallback,
  BlockCallback,
} from './types';

const log = createLogger('ElectrumProvider');

// =============================================================================
// Electrum Provider Implementation
// =============================================================================

/**
 * Electrum-based network provider
 */
export class ElectrumProvider implements INetworkProvider {
  readonly type = 'electrum' as const;
  readonly network: BitcoinNetwork;

  private client: ElectrumClient;
  private config: ElectrumProviderConfig;
  private lastHealth: ProviderHealth | null = null;

  constructor(config: ElectrumProviderConfig) {
    this.config = config;
    this.network = config.network;

    // Create Electrum client with explicit config
    this.client = new ElectrumClient({
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      network: config.network,
      allowSelfSignedCert: config.allowSelfSignedCert,
      connectionTimeoutMs: config.timeoutMs,
      proxy: config.proxy,
    });
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  async connect(): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
      log.debug(`Connected to Electrum: ${this.config.host}:${this.config.port}`);
    }
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
    log.debug('Disconnected from Electrum');
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  async getHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const height = await this.client.getBlockHeight();
      const latency = Date.now() - startTime;
      const serverVersion = await this.client.getServerVersion();

      this.lastHealth = {
        connected: true,
        latency,
        blockHeight: height,
        serverInfo: serverVersion ? `${serverVersion.server} (${serverVersion.protocol})` : undefined,
        lastCheck: new Date(),
      };
    } catch {
      this.lastHealth = {
        connected: false,
        latency: Date.now() - startTime,
        blockHeight: 0,
        lastCheck: new Date(),
      };
    }

    return this.lastHealth;
  }

  // ===========================================================================
  // Address Operations
  // ===========================================================================

  async getAddressBalance(address: string): Promise<AddressBalance> {
    return traceExternalCall('electrum', 'getAddressBalance', async () => {
      const balance = await this.client.getAddressBalance(address);
      return {
        confirmed: BigInt(balance.confirmed),
        unconfirmed: BigInt(balance.unconfirmed),
      };
    });
  }

  async getAddressBalances(addresses: string[]): Promise<Map<string, AddressBalance>> {
    // Use batch method if available, otherwise fall back to sequential
    const results = new Map<string, AddressBalance>();

    // Process in batches to avoid overwhelming the server
    const batchSize = 50;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const promises = batch.map(async addr => {
        const balance = await this.getAddressBalance(addr);
        return { addr, balance };
      });
      const batchResults = await Promise.all(promises);
      for (const { addr, balance } of batchResults) {
        results.set(addr, balance);
      }
    }

    return results;
  }

  async getAddressHistory(address: string): Promise<TransactionHistoryEntry[]> {
    return traceExternalCall('electrum', 'getAddressHistory', async () => {
      const history = await this.client.getAddressHistory(address);
      return history.map(entry => ({
        txid: entry.tx_hash,
        height: entry.height,
      }));
    });
  }

  async getAddressHistories(addresses: string[]): Promise<Map<string, TransactionHistoryEntry[]>> {
    return traceExternalCall('electrum', 'getAddressHistoryBatch', async () => {
      const results = await this.client.getAddressHistoryBatch(addresses);
      const mapped = new Map<string, TransactionHistoryEntry[]>();

      for (const [address, history] of results) {
        mapped.set(address, history.map(entry => ({
          txid: entry.tx_hash,
          height: entry.height,
        })));
      }

      return mapped;
    });
  }

  async getAddressUTXOs(address: string): Promise<UTXO[]> {
    return traceExternalCall('electrum', 'getAddressUTXOs', async () => {
      const utxos = await this.client.getAddressUTXOs(address);
      return utxos.map((utxo: { tx_hash: string; tx_pos: number; value: number; height: number }) => ({
        txid: utxo.tx_hash,
        vout: utxo.tx_pos,
        value: BigInt(utxo.value),
        height: utxo.height,
      }));
    });
  }

  async getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, UTXO[]>> {
    const results = new Map<string, UTXO[]>();

    // Process in batches
    const batchSize = 50;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const promises = batch.map(async addr => {
        const utxos = await this.getAddressUTXOs(addr);
        return { addr, utxos };
      });
      const batchResults = await Promise.all(promises);
      for (const { addr, utxos } of batchResults) {
        results.set(addr, utxos);
      }
    }

    return results;
  }

  // ===========================================================================
  // Transaction Operations
  // ===========================================================================

  async getTransaction(txid: string, verbose: boolean = true): Promise<RawTransaction | string> {
    return traceExternalCall('electrum', 'getTransaction', async () => {
      const tx = await this.client.getTransaction(txid, verbose);

      if (!verbose) {
        return tx; // Returns hex string
      }

      // Map to our interface
      return {
        txid: tx.txid,
        hash: tx.hash || tx.txid,
        version: tx.version,
        size: tx.size,
        vsize: tx.vsize,
        weight: tx.weight,
        locktime: tx.locktime,
        vin: tx.vin.map((input: any) => ({
          txid: input.txid,
          vout: input.vout,
          scriptSig: input.scriptSig?.hex,
          sequence: input.sequence,
          witness: input.txinwitness,
        })),
        vout: tx.vout.map((output: any) => ({
          value: BigInt(Math.round(output.value * 100000000)),
          scriptPubKey: output.scriptPubKey.hex,
          address: output.scriptPubKey.address,
        })),
        hex: tx.hex,
        blockhash: tx.blockhash,
        confirmations: tx.confirmations,
        time: tx.time,
        blocktime: tx.blocktime,
      };
    });
  }

  async getTransactions(txids: string[], verbose: boolean = true): Promise<Map<string, RawTransaction | string>> {
    const results = await this.client.getTransactionsBatch(txids, verbose);
    const mapped = new Map<string, RawTransaction | string>();

    for (const [txid, tx] of results) {
      if (!verbose) {
        mapped.set(txid, tx);
      } else {
        mapped.set(txid, {
          txid: tx.txid,
          hash: tx.hash || tx.txid,
          version: tx.version,
          size: tx.size,
          vsize: tx.vsize,
          weight: tx.weight,
          locktime: tx.locktime,
          vin: tx.vin.map((input: any) => ({
            txid: input.txid,
            vout: input.vout,
            scriptSig: input.scriptSig?.hex,
            sequence: input.sequence,
            witness: input.txinwitness,
          })),
          vout: tx.vout.map((output: any) => ({
            value: BigInt(Math.round(output.value * 100000000)),
            scriptPubKey: output.scriptPubKey.hex,
            address: output.scriptPubKey.address,
          })),
          hex: tx.hex,
          blockhash: tx.blockhash,
          confirmations: tx.confirmations,
          time: tx.time,
          blocktime: tx.blocktime,
        });
      }
    }

    return mapped;
  }

  async broadcastTransaction(hex: string): Promise<string> {
    return traceExternalCall('electrum', 'broadcastTransaction', async () => {
      return this.client.broadcastTransaction(hex);
    });
  }

  // ===========================================================================
  // Block Operations
  // ===========================================================================

  async getBlockHeight(): Promise<number> {
    return traceExternalCall('electrum', 'getBlockHeight', async () => {
      return this.client.getBlockHeight();
    });
  }

  async getBlockHeader(height: number): Promise<BlockHeader> {
    const header = await this.client.getBlockHeader(height);
    return {
      hash: header.block_hash || header.hex, // Electrum may return different fields
      height: header.height || height,
      version: header.version,
      previousblockhash: header.prev_block_hash,
      merkleroot: header.merkle_root,
      time: header.timestamp,
      bits: header.bits,
      nonce: header.nonce,
    };
  }

  async getBlockHeaderByHash(hash: string): Promise<BlockHeader> {
    // Electrum doesn't directly support lookup by hash
    // Would need to maintain a cache or use a different approach
    throw new Error('getBlockHeaderByHash not supported by Electrum provider');
  }

  // ===========================================================================
  // Fee Estimation
  // ===========================================================================

  async getFeeEstimates(): Promise<FeeEstimates> {
    // Get estimates for different confirmation targets
    const [fastest, fast, medium, slow] = await Promise.all([
      this.estimateFee(1),
      this.estimateFee(3),
      this.estimateFee(6),
      this.estimateFee(12),
    ]);

    return {
      fastest,
      fast,
      medium,
      slow,
      minimum: 1, // 1 sat/vB minimum
    };
  }

  async estimateFee(blocks: number): Promise<number> {
    // Electrum returns BTC/kB, convert to sat/vB
    const feeRateBtcKb = await this.client.estimateFee(blocks);

    if (feeRateBtcKb < 0) {
      // -1 means estimation not available
      return 1; // Return minimum
    }

    // Convert BTC/kB to sat/vB
    // 1 BTC = 100,000,000 sat
    // 1 kB = 1000 bytes
    // So: sat/vB = (BTC/kB * 100,000,000) / 1000 = BTC/kB * 100,000
    const satPerVb = Math.ceil(feeRateBtcKb * 100000);

    return Math.max(1, satPerVb); // Ensure minimum of 1 sat/vB
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  async subscribeToAddress(address: string, callback: AddressCallback): Promise<() => void> {
    // Use Electrum's subscription feature
    const status = await this.client.subscribeAddress(address);
    if (status !== null) {
      callback(address, status);
    }

    // Listen for updates via the client's event emitter
    const handler = (addr: string, newStatus: string) => {
      if (addr === address) {
        callback(addr, newStatus);
      }
    };
    this.client.on('address.update', handler);

    return () => {
      this.client.off('address.update', handler);
      this.client.unsubscribeAddress(address);
    };
  }

  async subscribeToBlocks(callback: BlockCallback): Promise<() => void> {
    // Subscribe to headers
    const initial = await this.client.subscribeHeaders();

    // Parse initial header and call callback
    // Note: The full header parsing would need the actual block data
    // For now, we just notify about height changes

    const handler = (height: number, headerHex: string) => {
      // Minimal header info - full parsing would require decoding the hex
      callback(height, {
        hash: '', // Would need to compute from header
        height,
        version: 0,
        previousblockhash: '',
        merkleroot: '',
        time: 0,
        bits: '',
        nonce: 0,
      });
    };
    this.client.on('block.update', handler);

    return () => {
      this.client.off('block.update', handler);
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Factory function for creating Electrum providers
 */
export async function electrumProviderFactory(config: ProviderConfig): Promise<INetworkProvider> {
  if (config.type !== 'electrum') {
    throw new Error(`Invalid config type for Electrum provider: ${config.type}`);
  }

  const provider = new ElectrumProvider(config as ElectrumProviderConfig);
  await provider.connect();
  return provider;
}
