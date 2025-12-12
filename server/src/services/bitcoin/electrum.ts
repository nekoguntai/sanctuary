/**
 * Electrum Server Client
 *
 * Client for connecting to Electrum servers to fetch Bitcoin blockchain data.
 * Electrum is a lightweight alternative to running a full Bitcoin node.
 */

import net from 'net';
import tls from 'tls';
import crypto from 'crypto';
import config from '../../config';
import prisma from '../../models/prisma';

interface ElectrumResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

interface ElectrumRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

interface ElectrumConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
}

class ElectrumClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private connected = false;
  private serverVersion: { server: string; protocol: string } | null = null;
  private explicitConfig: ElectrumConfig | null = null;

  /**
   * Create an ElectrumClient
   * @param explicitConfig Optional config to use instead of database/env config
   */
  constructor(explicitConfig?: ElectrumConfig) {
    this.explicitConfig = explicitConfig || null;
  }

  /**
   * Connect to Electrum server
   */
  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        let host: string;
        let port: number;
        let protocol: 'tcp' | 'ssl';

        // Use explicit config if provided (for testing connections)
        if (this.explicitConfig) {
          host = this.explicitConfig.host;
          port = this.explicitConfig.port;
          protocol = this.explicitConfig.protocol;
        } else {
          // Get node config from database
          const nodeConfig = await prisma.nodeConfig.findFirst({
            where: { isDefault: true },
          });

          if (nodeConfig && nodeConfig.type === 'electrum') {
            host = nodeConfig.host;
            port = nodeConfig.port;
            // Use explicit useSsl setting from config
            protocol = nodeConfig.useSsl ? 'ssl' : 'tcp';
          } else {
            // Fallback to env config
            host = config.bitcoin.electrum.host;
            port = config.bitcoin.electrum.port;
            protocol = config.bitcoin.electrum.protocol;
          }
        }

        if (protocol === 'ssl') {
          this.socket = tls.connect({
            host,
            port,
            rejectUnauthorized: false, // Allow self-signed certs for local testing
          });
        } else {
          this.socket = net.connect({ host, port });
        }

        this.socket.on('connect', () => {
          console.log(`[ELECTRUM] Connected to ${host}:${port} (${protocol})`);
          this.connected = true;
          resolve();
        });

        this.socket.on('data', (data) => {
          this.handleData(data);
        });

        this.socket.on('error', (error) => {
          console.error('[ELECTRUM] Socket error:', error);
          this.connected = false;
          reject(error);
        });

        this.socket.on('close', () => {
          console.log('[ELECTRUM] Connection closed');
          this.connected = false;
        });

        this.socket.on('end', () => {
          console.log('[ELECTRUM] Connection ended');
          this.connected = false;
        });
      } catch (error) {
        console.error('[ELECTRUM] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from Electrum server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
      this.serverVersion = null; // Clear cached version so next connection fetches fresh info
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle incoming data from server
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete JSON-RPC responses (separated by newlines)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: ElectrumResponse = JSON.parse(line);
        const request = this.pendingRequests.get(response.id);

        if (request) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            const errorMsg = response.error.message || JSON.stringify(response.error);
            request.reject(new Error(errorMsg));
          } else {
            request.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('[ELECTRUM] Failed to parse response:', error);
      }
    }
  }

  /**
   * Send request to Electrum server
   */
  private async request(method: string, params: any[] = []): Promise<any> {
    if (!this.connected || !this.socket) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: ElectrumRequest = {
        jsonrpc: '2.0',
        method,
        params,
        id,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify(request) + '\n';
      this.socket!.write(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Get server version (cached - can only be called once per connection)
   */
  async getServerVersion(): Promise<{ server: string; protocol: string }> {
    // Return cached version if already fetched (server.version can only be sent once per connection)
    if (this.serverVersion) {
      return this.serverVersion;
    }

    const result = await this.request('server.version', ['Sanctuary', '1.4']);
    this.serverVersion = {
      server: result[0],
      protocol: result[1],
    };
    return this.serverVersion;
  }

  /**
   * Get address balance
   */
  async getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    const scriptHash = this.addressToScriptHash(address);
    const result = await this.request('blockchain.scripthash.get_balance', [scriptHash]);
    return {
      confirmed: result.confirmed,
      unconfirmed: result.unconfirmed,
    };
  }

  /**
   * Get address transaction history
   */
  async getAddressHistory(address: string): Promise<Array<{ tx_hash: string; height: number }>> {
    const scriptHash = this.addressToScriptHash(address);
    return this.request('blockchain.scripthash.get_history', [scriptHash]);
  }

  /**
   * Get address unspent outputs (UTXOs)
   */
  async getAddressUTXOs(address: string): Promise<Array<{
    tx_hash: string;
    tx_pos: number;
    height: number;
    value: number;
  }>> {
    const scriptHash = this.addressToScriptHash(address);
    return this.request('blockchain.scripthash.listunspent', [scriptHash]);
  }

  /**
   * Get transaction details
   * Note: verbose=true is not supported by all servers (e.g., Blockstream)
   * If verbose fails, falls back to fetching raw tx and decoding locally
   */
  async getTransaction(txid: string, verbose: boolean = true): Promise<any> {
    try {
      return await this.request('blockchain.transaction.get', [txid, verbose]);
    } catch (error: any) {
      // If verbose not supported, get raw tx and decode it ourselves
      if (verbose && error.message?.includes('verbose') || error.message?.includes('unsupported')) {
        const rawTx = await this.request('blockchain.transaction.get', [txid, false]);
        return this.decodeRawTransaction(rawTx);
      }
      throw error;
    }
  }

  /**
   * Decode raw transaction hex to structured format
   */
  private decodeRawTransaction(rawTx: string): any {
    const bitcoin = require('bitcoinjs-lib');

    try {
      const tx = bitcoin.Transaction.fromHex(rawTx);

      // Build vout array with address info
      const vout = tx.outs.map((output: any, index: number) => {
        let address: string | undefined;

        try {
          // Try to extract address from output script
          address = bitcoin.address.fromOutputScript(output.script, bitcoin.networks.bitcoin);
        } catch (e) {
          // Some outputs (like OP_RETURN) don't have addresses
        }

        return {
          value: output.value / 100000000, // Convert satoshis to BTC
          n: index,
          scriptPubKey: {
            hex: output.script.toString('hex'),
            address: address, // Single address for segwit
            addresses: address ? [address] : [], // Array for legacy compatibility
          },
        };
      });

      // Build vin array
      const vin = tx.ins.map((input: any, index: number) => ({
        txid: Buffer.from(input.hash).reverse().toString('hex'),
        vout: input.index,
        sequence: input.sequence,
      }));

      return {
        txid: tx.getId(),
        hash: tx.getHash().toString('hex'),
        version: tx.version,
        size: rawTx.length / 2,
        locktime: tx.locktime,
        vin,
        vout,
      };
    } catch (error) {
      console.error('[ELECTRUM] Failed to decode raw transaction:', error);
      throw new Error('Failed to decode transaction');
    }
  }

  /**
   * Broadcast transaction
   */
  async broadcastTransaction(rawTx: string): Promise<string> {
    return this.request('blockchain.transaction.broadcast', [rawTx]);
  }

  /**
   * Get fee estimate (in satoshis per byte)
   */
  async estimateFee(blocks: number = 6): Promise<number> {
    const result = await this.request('blockchain.estimatefee', [blocks]);
    // Convert from BTC/kB to sat/vB
    const satPerKb = result * 100000000;
    return Math.max(1, Math.round(satPerKb / 1000));
  }

  /**
   * Subscribe to address changes
   */
  async subscribeAddress(address: string): Promise<string> {
    const scriptHash = this.addressToScriptHash(address);
    return this.request('blockchain.scripthash.subscribe', [scriptHash]);
  }

  /**
   * Get block header
   */
  async getBlockHeader(height: number): Promise<any> {
    return this.request('blockchain.block.header', [height]);
  }

  /**
   * Get current block height
   */
  async getBlockHeight(): Promise<number> {
    const headers = await this.request('blockchain.headers.subscribe');
    return headers.height;
  }

  /**
   * Convert Bitcoin address to Electrum scripthash
   * Electrum uses reversed SHA256 hash of scriptPubKey
   */
  private addressToScriptHash(address: string): string {
    const bitcoin = require('bitcoinjs-lib');

    // Decode address to get scriptPubKey
    const script = bitcoin.address.toOutputScript(address);

    // SHA256 hash
    const hash = crypto.createHash('sha256').update(script).digest();

    // Reverse bytes for Electrum format
    const reversed = Buffer.from(hash).reverse();

    return reversed.toString('hex');
  }
}

// Singleton instance
let electrumClient: ElectrumClient | null = null;

/**
 * Get Electrum client instance
 */
export function getElectrumClient(): ElectrumClient {
  if (!electrumClient) {
    electrumClient = new ElectrumClient();
  }
  return electrumClient;
}

/**
 * Close Electrum connection
 */
export function closeElectrumClient(): void {
  if (electrumClient) {
    electrumClient.disconnect();
    electrumClient = null;
  }
}

/**
 * Reset Electrum client (alias for closeElectrumClient)
 */
export function resetElectrumClient(): void {
  closeElectrumClient();
}

export { ElectrumClient };
export default ElectrumClient;
