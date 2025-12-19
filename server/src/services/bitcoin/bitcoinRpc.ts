/**
 * Bitcoin Core RPC Client
 *
 * Provides the same interface as ElectrumClient but communicates
 * with a Bitcoin Core node via JSON-RPC
 */

import axios, { AxiosInstance } from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../utils/logger';

const log = createLogger('BITCOIN_RPC');

interface RpcConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl?: boolean;
}

interface AddressHistory {
  tx_hash: string;
  height: number;
}

interface AddressBalance {
  confirmed: number;
  unconfirmed: number;
}

interface AddressUTXO {
  tx_hash: string;
  tx_pos: number;
  height: number;
  value: number;
}

export class BitcoinRpcClient {
  private client: AxiosInstance;
  private config: RpcConfig;
  private connected: boolean = false;
  private requestId: number = 0;

  constructor(config: RpcConfig) {
    this.config = config;
    const protocol = config.ssl ? 'https' : 'http';
    const auth = Buffer.from(`${config.user}:${config.password}`).toString('base64');

    this.client = axios.create({
      baseURL: `${protocol}://${config.host}:${config.port}`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      timeout: 30000,
    });
  }

  /**
   * Make an RPC call to Bitcoin Core
   */
  private async rpcCall(method: string, params: any[] = []): Promise<any> {
    const response = await this.client.post('/', {
      jsonrpc: '1.0',
      id: ++this.requestId,
      method,
      params,
    });

    if (response.data.error) {
      throw new Error(`RPC error: ${response.data.error.message}`);
    }

    return response.data.result;
  }

  /**
   * Connect to Bitcoin Core
   */
  async connect(): Promise<void> {
    try {
      // Test connection with getblockchaininfo
      await this.rpcCall('getblockchaininfo');
      this.connected = true;
      log.info('Connected to Bitcoin Core');
    } catch (error: any) {
      this.connected = false;
      throw new Error(`Failed to connect to Bitcoin Core: ${error.message}`);
    }
  }

  /**
   * Disconnect (no-op for HTTP RPC)
   */
  disconnect(): void {
    this.connected = false;
    log.debug('Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current block height
   */
  async getBlockHeight(): Promise<number> {
    const info = await this.rpcCall('getblockchaininfo');
    return info.blocks;
  }

  /**
   * Get block header hex
   */
  async getBlockHeader(height: number): Promise<string> {
    const hash = await this.rpcCall('getblockhash', [height]);
    const header = await this.rpcCall('getblockheader', [hash, false]);
    return header;
  }

  /**
   * Get address history (transactions)
   * Note: Bitcoin Core doesn't index by address by default.
   * This requires wallet functionality or an address index.
   */
  async getAddressHistory(address: string): Promise<AddressHistory[]> {
    try {
      // Try using scantxoutset for UTXO-based history
      // This is slower but works without address indexing
      const scanResult = await this.rpcCall('scantxoutset', ['start', [`addr(${address})`]]);

      const history: AddressHistory[] = [];
      const seenTxids = new Set<string>();

      for (const utxo of scanResult.unspents || []) {
        if (!seenTxids.has(utxo.txid)) {
          seenTxids.add(utxo.txid);
          history.push({
            tx_hash: utxo.txid,
            height: utxo.height || 0,
          });
        }
      }

      return history;
    } catch (error: any) {
      // If scantxoutset fails, try importaddress + listtransactions
      // This requires the address to be imported into the wallet
      log.warn(`scantxoutset failed for ${address}, trying wallet method`);

      try {
        // Import address (watch-only) if not already imported
        try {
          await this.rpcCall('importaddress', [address, '', false]);
        } catch (e) {
          // Ignore if already imported
        }

        // Get transactions for this address
        const txs = await this.rpcCall('listreceivedbyaddress', [0, true, true, address]);

        const history: AddressHistory[] = [];
        for (const entry of txs) {
          if (entry.address === address) {
            for (const txid of entry.txids || []) {
              const tx = await this.rpcCall('gettransaction', [txid]);
              history.push({
                tx_hash: txid,
                height: tx.blockheight || 0,
              });
            }
          }
        }

        return history;
      } catch (walletError) {
        log.error(`Failed to get history for ${address}`, { error: walletError });
        return [];
      }
    }
  }

  /**
   * Get address balance
   */
  async getAddressBalance(address: string): Promise<AddressBalance> {
    try {
      const scanResult = await this.rpcCall('scantxoutset', ['start', [`addr(${address})`]]);

      return {
        confirmed: Math.round((scanResult.total_amount || 0) * 100000000),
        unconfirmed: 0, // scantxoutset only returns confirmed
      };
    } catch (error) {
      log.error(`Failed to get balance for ${address}`, { error });
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  /**
   * Get UTXOs for an address
   */
  async getAddressUTXOs(address: string): Promise<AddressUTXO[]> {
    try {
      const scanResult = await this.rpcCall('scantxoutset', ['start', [`addr(${address})`]]);

      return (scanResult.unspents || []).map((utxo: any) => ({
        tx_hash: utxo.txid,
        tx_pos: utxo.vout,
        height: utxo.height || 0,
        value: Math.round(utxo.amount * 100000000),
      }));
    } catch (error) {
      log.error(`Failed to get UTXOs for ${address}`, { error });
      return [];
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(txid: string, verbose: boolean = true): Promise<any> {
    try {
      const rawTx = await this.rpcCall('getrawtransaction', [txid, verbose]);

      if (verbose) {
        return rawTx;
      }

      // Decode raw transaction
      return await this.rpcCall('decoderawtransaction', [rawTx]);
    } catch (error: any) {
      throw new Error(`Failed to get transaction ${txid}: ${error.message}`);
    }
  }

  /**
   * Broadcast a transaction
   */
  async broadcastTransaction(rawTx: string): Promise<string> {
    return await this.rpcCall('sendrawtransaction', [rawTx]);
  }

  /**
   * Estimate fee (sat/vB)
   */
  async estimateFee(blocks: number): Promise<number> {
    try {
      const result = await this.rpcCall('estimatesmartfee', [blocks]);

      if (result.feerate) {
        // Convert BTC/kB to sat/vB
        return Math.ceil(result.feerate * 100000000 / 1000);
      }

      // Fallback
      return blocks <= 1 ? 20 : blocks <= 3 ? 15 : blocks <= 6 ? 10 : 5;
    } catch (error) {
      log.error('Failed to estimate fee', { error });
      return blocks <= 1 ? 20 : blocks <= 3 ? 15 : blocks <= 6 ? 10 : 5;
    }
  }

  /**
   * Subscribe to address (no-op for RPC - polling based)
   */
  async subscribeAddress(address: string): Promise<string | null> {
    // Bitcoin Core RPC doesn't support push notifications
    // We'll rely on polling for updates
    return null;
  }

  /**
   * Batch subscribe to addresses (no-op for RPC - polling based)
   */
  async subscribeAddressBatch(addresses: string[]): Promise<Map<string, string | null>> {
    // Bitcoin Core RPC doesn't support push notifications
    // Return empty statuses for all addresses
    const result = new Map<string, string | null>();
    for (const address of addresses) {
      result.set(address, null);
    }
    return result;
  }

  /**
   * Make a batch RPC call to Bitcoin Core
   * Sends multiple requests in a single HTTP POST
   */
  private async batchRpcCall(requests: Array<{ method: string; params: any[] }>): Promise<any[]> {
    if (requests.length === 0) return [];

    const batchPayload = requests.map((req, index) => ({
      jsonrpc: '1.0',
      id: ++this.requestId,
      method: req.method,
      params: req.params,
    }));

    const response = await this.client.post('/', batchPayload);

    // Response is an array of results in the same order as requests
    const results = response.data;

    // Extract results, handling errors
    return results.map((r: any, index: number) => {
      if (r.error) {
        log.warn(`Batch RPC error for ${requests[index].method}: ${r.error.message}`);
        return null;
      }
      return r.result;
    });
  }

  /**
   * Batch: Get transaction history for multiple addresses
   * Note: Bitcoin Core doesn't natively index by address, so this uses scantxoutset
   * which is slower than Electrum but works without additional indexing
   */
  async getAddressHistoryBatch(addresses: string[]): Promise<Map<string, AddressHistory[]>> {
    const resultMap = new Map<string, AddressHistory[]>();
    if (addresses.length === 0) return resultMap;

    // Bitcoin Core's scantxoutset can scan multiple descriptors at once
    const descriptors = addresses.map(addr => `addr(${addr})`);

    try {
      const scanResult = await this.rpcCall('scantxoutset', ['start', descriptors]);

      // Group UTXOs by address
      const addressUtxos = new Map<string, Set<string>>();
      for (const utxo of scanResult.unspents || []) {
        // Extract address from descriptor in result
        const addr = utxo.desc?.match(/addr\(([^)]+)\)/)?.[1];
        if (addr) {
          if (!addressUtxos.has(addr)) {
            addressUtxos.set(addr, new Set());
          }
          addressUtxos.get(addr)!.add(JSON.stringify({
            tx_hash: utxo.txid,
            height: utxo.height || 0,
          }));
        }
      }

      // Convert to expected format
      for (const address of addresses) {
        const txSet = addressUtxos.get(address);
        if (txSet) {
          resultMap.set(address, Array.from(txSet).map(s => JSON.parse(s)));
        } else {
          resultMap.set(address, []);
        }
      }
    } catch (error) {
      log.error('Batch address history failed', { error });
      // Return empty results for all addresses
      for (const address of addresses) {
        resultMap.set(address, []);
      }
    }

    return resultMap;
  }

  /**
   * Batch: Get UTXOs for multiple addresses
   * Uses scantxoutset with multiple descriptors
   */
  async getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, AddressUTXO[]>> {
    const resultMap = new Map<string, AddressUTXO[]>();
    if (addresses.length === 0) return resultMap;

    const descriptors = addresses.map(addr => `addr(${addr})`);

    try {
      const scanResult = await this.rpcCall('scantxoutset', ['start', descriptors]);

      // Group UTXOs by address
      const addressUtxos = new Map<string, AddressUTXO[]>();
      for (const utxo of scanResult.unspents || []) {
        const addr = utxo.desc?.match(/addr\(([^)]+)\)/)?.[1];
        if (addr) {
          if (!addressUtxos.has(addr)) {
            addressUtxos.set(addr, []);
          }
          addressUtxos.get(addr)!.push({
            tx_hash: utxo.txid,
            tx_pos: utxo.vout,
            height: utxo.height || 0,
            value: Math.round(utxo.amount * 100000000),
          });
        }
      }

      // Set results for all addresses (empty array if no UTXOs)
      for (const address of addresses) {
        resultMap.set(address, addressUtxos.get(address) || []);
      }
    } catch (error) {
      log.error('Batch UTXO fetch failed', { error });
      for (const address of addresses) {
        resultMap.set(address, []);
      }
    }

    return resultMap;
  }

  /**
   * Batch: Get multiple transactions in a single RPC batch
   */
  async getTransactionsBatch(txids: string[], verbose: boolean = true): Promise<Map<string, any>> {
    const resultMap = new Map<string, any>();
    if (txids.length === 0) return resultMap;

    // Prepare batch requests for getrawtransaction
    const requests = txids.map(txid => ({
      method: 'getrawtransaction',
      params: [txid, verbose],
    }));

    const results = await this.batchRpcCall(requests);

    // Map results back to txids
    for (let i = 0; i < txids.length; i++) {
      if (results[i]) {
        resultMap.set(txids[i], results[i]);
      }
    }

    return resultMap;
  }
}

// Singleton instance
let rpcClient: BitcoinRpcClient | null = null;

/**
 * Get or create Bitcoin RPC client
 */
export function getBitcoinRpcClient(config?: RpcConfig): BitcoinRpcClient {
  if (!rpcClient && config) {
    rpcClient = new BitcoinRpcClient(config);
  }

  if (!rpcClient) {
    throw new Error('Bitcoin RPC client not initialized. Provide config on first call.');
  }

  return rpcClient;
}

/**
 * Reset the client (for config changes)
 */
export function resetBitcoinRpcClient(): void {
  if (rpcClient) {
    rpcClient.disconnect();
    rpcClient = null;
  }
}
