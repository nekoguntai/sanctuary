/**
 * Electrum Server Client
 *
 * Client for connecting to Electrum servers to fetch Bitcoin blockchain data.
 * Electrum is a lightweight alternative to running a full Bitcoin node.
 */

import net from 'net';
import tls from 'tls';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import config from '../../config';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const log = createLogger('ELECTRUM');

interface ElectrumResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: number | null;
  method?: string;  // For subscription notifications
  params?: any[];   // For subscription notifications
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

class ElectrumClient extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }>();
  private buffer = '';
  private connected = false;
  private serverVersion: { server: string; protocol: string } | null = null;
  private explicitConfig: ElectrumConfig | null = null;
  private scriptHashToAddress = new Map<string, string>();  // Map scripthash to address
  private subscribedHeaders = false;

  /**
   * Create an ElectrumClient
   * @param explicitConfig Optional config to use instead of database/env config
   */
  constructor(explicitConfig?: ElectrumConfig) {
    super();
    this.explicitConfig = explicitConfig || null;
  }

  /**
   * Connect to Electrum server
   */
  async connect(): Promise<void> {
    // Get config first (async), then create socket connection (sync Promise)
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

    // Now create the connection using a sync Promise executor
    return new Promise((resolve, reject) => {
      try {
        if (protocol === 'ssl') {
          log.info(`Initiating TLS connection to ${host}:${port}`);
          const tlsSocket = tls.connect(
            {
              host,
              port,
              rejectUnauthorized: false, // Allow self-signed certs for local testing
              servername: host, // SNI support
            },
            () => {
              // This callback fires on secureConnect
              log.info(`Connected to ${host}:${port} (${protocol}) - TLS handshake complete`);
              this.connected = true;
              resolve();
            }
          );
          this.socket = tlsSocket;

          tlsSocket.on('error', (err) => {
            log.error(`TLS socket error`, { error: String(err) });
            this.connected = false;
            reject(err);
          });
        } else {
          this.socket = net.connect({ host, port });

          // For plain TCP, connect event is sufficient
          this.socket.on('connect', () => {
            log.info(`Connected to ${host}:${port} (${protocol})`);
            this.connected = true;
            resolve();
          });
        }

        this.socket.on('data', (data) => {
          this.handleData(data);
        });

        this.socket.on('error', (error) => {
          log.error('Socket error', { error });
          this.connected = false;
          // Reject all pending requests on socket error
          this.rejectPendingRequests(new Error(`Socket error: ${error.message}`));
          reject(error);
        });

        this.socket.on('close', () => {
          log.debug('Connection closed');
          this.connected = false;
          // Reject all pending requests on connection close
          this.rejectPendingRequests(new Error('Connection closed unexpectedly'));
        });

        this.socket.on('end', () => {
          log.debug('Connection ended');
          this.connected = false;
          // Reject all pending requests on connection end
          this.rejectPendingRequests(new Error('Connection ended'));
        });
      } catch (error) {
        log.error('Connection error', { error });
        reject(error);
      }
    });
  }

  /**
   * Reject all pending requests with an error
   * Used when connection is lost or disconnected
   */
  private rejectPendingRequests(error: Error): void {
    for (const [id, { reject, timeoutId }] of this.pendingRequests) {
      clearTimeout(timeoutId);
      reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Disconnect from Electrum server
   */
  disconnect(): void {
    this.rejectPendingRequests(new Error('Connection closed'));

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

        // Check if this is a subscription notification (has method field, no id or null id)
        if (response.method && (response.id === null || response.id === undefined)) {
          this.handleNotification(response);
          continue;
        }

        // Regular request/response
        if (response.id !== null && response.id !== undefined) {
          const request = this.pendingRequests.get(response.id);

          if (request) {
            // Clear timeout since we got a response
            clearTimeout(request.timeoutId);
            this.pendingRequests.delete(response.id);

            if (response.error) {
              const errorMsg = response.error.message || JSON.stringify(response.error);
              request.reject(new Error(errorMsg));
            } else {
              request.resolve(response.result);
            }
          }
        }
      } catch (error) {
        log.error('Failed to parse response', { error });
      }
    }
  }

  /**
   * Handle subscription notifications from server
   */
  private handleNotification(notification: ElectrumResponse): void {
    const { method, params } = notification;

    if (method === 'blockchain.headers.subscribe') {
      // New block notification
      // params[0] = { height: number, hex: string }
      const blockHeader = params?.[0];
      if (blockHeader) {
        log.info(`[NOTIFICATION] New block at height ${blockHeader.height}`);
        this.emit('newBlock', {
          height: blockHeader.height,
          hex: blockHeader.hex,
        });
      }
    } else if (method === 'blockchain.scripthash.subscribe') {
      // Address activity notification
      // params[0] = scripthash, params[1] = status (hash of history)
      const scriptHash = params?.[0];
      const status = params?.[1];

      if (scriptHash) {
        const address = this.scriptHashToAddress.get(scriptHash);
        log.info(`[NOTIFICATION] Address activity: ${address || scriptHash} (status: ${status?.slice(0, 8)}...)`);
        this.emit('addressActivity', {
          scriptHash,
          address,
          status,
        });
      }
    } else {
      log.debug(`[NOTIFICATION] Unknown notification: ${method}`);
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

      // Timeout after 30 seconds
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      const message = JSON.stringify(request) + '\n';
      this.socket!.write(message);
    });
  }

  /**
   * Send multiple requests to Electrum server in a single batch
   * Each request is sent on its own line but in quick succession
   * Returns results in the same order as requests
   */
  private async batchRequest(requests: Array<{ method: string; params: any[] }>): Promise<any[]> {
    if (requests.length === 0) return [];

    if (!this.connected || !this.socket) {
      await this.connect();
    }

    // Create all requests with sequential IDs
    const startId = this.requestId + 1;
    const requestPromises: Promise<any>[] = [];
    const messages: string[] = [];

    for (let i = 0; i < requests.length; i++) {
      const id = ++this.requestId;
      const request: ElectrumRequest = {
        jsonrpc: '2.0',
        method: requests[i].method,
        params: requests[i].params,
        id,
      };

      const promise = new Promise((resolve, reject) => {
        // Timeout after 60 seconds for batch requests (longer than single requests)
        const timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error(`Batch request timeout for id ${id}`));
          }
        }, 60000);

        this.pendingRequests.set(id, { resolve, reject, timeoutId });
      });

      requestPromises.push(promise);
      messages.push(JSON.stringify(request));
    }

    // Send all requests in a single write (separated by newlines)
    const batchMessage = messages.join('\n') + '\n';
    this.socket!.write(batchMessage);

    // Wait for all responses
    return Promise.all(requestPromises);
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
        hex: rawTx, // Include raw hex for RBF checking
      };
    } catch (error) {
      log.error('Failed to decode raw transaction', { error });
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
   * Returns the current status (hash of history) or null if no history
   */
  async subscribeAddress(address: string): Promise<string | null> {
    const scriptHash = this.addressToScriptHash(address);
    // Track the mapping so we can resolve address from notifications
    this.scriptHashToAddress.set(scriptHash, address);
    const result = await this.request('blockchain.scripthash.subscribe', [scriptHash]);
    return result; // Returns status hash or null
  }

  /**
   * Unsubscribe from address changes (clears local tracking only)
   */
  unsubscribeAddress(address: string): void {
    const scriptHash = this.addressToScriptHash(address);
    this.scriptHashToAddress.delete(scriptHash);
  }

  /**
   * Subscribe to new block headers
   * Also returns current tip height
   */
  async subscribeHeaders(): Promise<{ height: number; hex: string }> {
    this.subscribedHeaders = true;
    const result = await this.request('blockchain.headers.subscribe');
    return result;
  }

  /**
   * Check if subscribed to headers
   */
  isSubscribedToHeaders(): boolean {
    return this.subscribedHeaders;
  }

  /**
   * Get all subscribed addresses
   */
  getSubscribedAddresses(): string[] {
    return Array.from(this.scriptHashToAddress.values());
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
   * Batch: Get transaction history for multiple addresses in a single RPC batch
   * Returns a Map of address -> history array
   */
  async getAddressHistoryBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; height: number }>>> {
    if (addresses.length === 0) return new Map();

    // Prepare batch requests
    const requests = addresses.map(address => ({
      method: 'blockchain.scripthash.get_history',
      params: [this.addressToScriptHash(address)],
    }));

    // Execute batch
    const results = await this.batchRequest(requests);

    // Map results back to addresses
    const resultMap = new Map<string, Array<{ tx_hash: string; height: number }>>();
    for (let i = 0; i < addresses.length; i++) {
      resultMap.set(addresses[i], results[i] || []);
    }

    return resultMap;
  }

  /**
   * Batch: Get UTXOs for multiple addresses in a single RPC batch
   * Returns a Map of address -> UTXO array
   */
  async getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>> {
    if (addresses.length === 0) return new Map();

    // Prepare batch requests
    const requests = addresses.map(address => ({
      method: 'blockchain.scripthash.listunspent',
      params: [this.addressToScriptHash(address)],
    }));

    // Execute batch
    const results = await this.batchRequest(requests);

    // Map results back to addresses
    const resultMap = new Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>();
    for (let i = 0; i < addresses.length; i++) {
      resultMap.set(addresses[i], results[i] || []);
    }

    return resultMap;
  }

  /**
   * Batch: Get multiple transactions in a single RPC batch
   * Returns a Map of txid -> transaction data
   */
  async getTransactionsBatch(txids: string[], verbose: boolean = true): Promise<Map<string, any>> {
    if (txids.length === 0) return new Map();

    // Prepare batch requests
    const requests = txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, verbose],
    }));

    // Execute batch
    let results: any[];
    try {
      results = await this.batchRequest(requests);
    } catch (error: any) {
      // If verbose not supported by server, retry without verbose and decode locally
      if (verbose && (error.message?.includes('verbose') || error.message?.includes('unsupported'))) {
        log.debug('Verbose transactions not supported, falling back to raw tx decoding');
        const rawRequests = txids.map(txid => ({
          method: 'blockchain.transaction.get',
          params: [txid, false],
        }));
        const rawResults = await this.batchRequest(rawRequests);
        results = rawResults.map(rawTx => this.decodeRawTransaction(rawTx));
      } else {
        throw error;
      }
    }

    // Map results back to txids
    const resultMap = new Map<string, any>();
    for (let i = 0; i < txids.length; i++) {
      if (results[i]) {
        resultMap.set(txids[i], results[i]);
      }
    }

    return resultMap;
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
