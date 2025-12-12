/**
 * Bitcoin Core RPC Client
 *
 * Provides the same interface as ElectrumClient but communicates
 * with a Bitcoin Core node via JSON-RPC
 */

import axios, { AxiosInstance } from 'axios';
import * as bitcoin from 'bitcoinjs-lib';

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
      console.log('[BITCOIN-RPC] Connected to Bitcoin Core');
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
    console.log('[BITCOIN-RPC] Disconnected');
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
      console.warn(`[BITCOIN-RPC] scantxoutset failed for ${address}, trying wallet method`);

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
        console.error(`[BITCOIN-RPC] Failed to get history for ${address}:`, walletError);
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
      console.error(`[BITCOIN-RPC] Failed to get balance for ${address}:`, error);
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
      console.error(`[BITCOIN-RPC] Failed to get UTXOs for ${address}:`, error);
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
      console.error('[BITCOIN-RPC] Failed to estimate fee:', error);
      return blocks <= 1 ? 20 : blocks <= 3 ? 15 : blocks <= 6 ? 10 : 5;
    }
  }

  /**
   * Subscribe to address (no-op for RPC - polling based)
   */
  async subscribeAddress(address: string): Promise<string> {
    // Bitcoin Core RPC doesn't support push notifications
    // We'll rely on polling for updates
    return '';
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
