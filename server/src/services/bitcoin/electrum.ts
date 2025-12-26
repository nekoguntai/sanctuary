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
import { SocksClient, SocksClientOptions } from 'socks';
import config from '../../config';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const log = createLogger('ELECTRUM');

/**
 * SOCKS5 proxy configuration (for Tor support)
 */
interface ProxyConfig {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

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
  network?: 'mainnet' | 'testnet' | 'signet' | 'regtest'; // Bitcoin network (default: mainnet)
  allowSelfSignedCert?: boolean; // Optional: allow self-signed TLS certificates (default: false)
  connectionTimeoutMs?: number; // Optional: connection/handshake timeout (default: 10000ms)
  proxy?: ProxyConfig; // Optional: SOCKS5 proxy configuration (for Tor)
  requestTimeoutMs?: number; // Optional: per-request timeout (default: 30000ms, higher for Tor)
  batchRequestTimeoutMs?: number; // Optional: batch request timeout (default: 60000ms, higher for Tor)
}

// Default request timeout (30 seconds)
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// Default batch request timeout (60 seconds)
const DEFAULT_BATCH_REQUEST_TIMEOUT_MS = 60000;

// Timeout multiplier for Tor connections (Tor adds significant latency)
const TOR_TIMEOUT_MULTIPLIER = 3;

// Default connection timeout (10 seconds) - fails faster so pool can try other servers
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

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
  private network: 'mainnet' | 'testnet' | 'signet' | 'regtest'; // Bitcoin network

  // Timeouts (adjusted for Tor when proxy is enabled)
  private requestTimeoutMs: number;
  private batchRequestTimeoutMs: number;

  /**
   * Create an ElectrumClient
   * @param explicitConfig Optional config to use instead of database/env config
   */
  constructor(explicitConfig?: ElectrumConfig) {
    super();
    this.explicitConfig = explicitConfig || null;
    this.network = explicitConfig?.network ?? 'mainnet'; // Default to mainnet

    // Calculate timeouts - increase for Tor connections
    const isProxyEnabled = explicitConfig?.proxy?.enabled ?? false;
    const multiplier = isProxyEnabled ? TOR_TIMEOUT_MULTIPLIER : 1;

    this.requestTimeoutMs = (explicitConfig?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS) * multiplier;
    this.batchRequestTimeoutMs = (explicitConfig?.batchRequestTimeoutMs ?? DEFAULT_BATCH_REQUEST_TIMEOUT_MS) * multiplier;

    if (isProxyEnabled) {
      log.debug(`ElectrumClient configured with Tor timeouts: request=${this.requestTimeoutMs}ms, batch=${this.batchRequestTimeoutMs}ms`);
    }
  }

  /**
   * Set the network for this client (used when created without explicitConfig)
   */
  setNetwork(network: 'mainnet' | 'testnet' | 'signet' | 'regtest'): void {
    this.network = network;
  }

  /**
   * Get the network for this client
   */
  getNetwork(): 'mainnet' | 'testnet' | 'signet' | 'regtest' {
    return this.network;
  }

  /**
   * Get the bitcoinjs-lib network object for the current network
   */
  private getNetworkLib() {
    const bitcoin = require('bitcoinjs-lib');
    switch (this.network) {
      case 'testnet':
        return bitcoin.networks.testnet;
      case 'regtest':
        return bitcoin.networks.regtest;
      case 'mainnet':
      default:
        return bitcoin.networks.bitcoin;
    }
  }

  /**
   * Create a socket connection through a SOCKS5 proxy
   */
  private async createProxiedSocket(
    proxy: ProxyConfig,
    targetHost: string,
    targetPort: number,
    timeoutMs: number
  ): Promise<net.Socket> {
    const socksOptions: SocksClientOptions = {
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5, // SOCKS5
        ...(proxy.username && proxy.password
          ? { userId: proxy.username, password: proxy.password }
          : {}),
      },
      command: 'connect',
      destination: {
        host: targetHost,
        port: targetPort,
      },
      timeout: timeoutMs,
    };

    log.info(`Connecting through SOCKS5 proxy ${proxy.host}:${proxy.port} to ${targetHost}:${targetPort} (timeout: ${timeoutMs}ms)`);

    const { socket } = await SocksClient.createConnection(socksOptions);
    return socket;
  }

  /**
   * Connect to Electrum server
   */
  async connect(): Promise<void> {
    // Get config first (async), then create socket connection (sync Promise)
    let host: string;
    let port: number;
    let protocol: 'tcp' | 'ssl';
    let allowSelfSignedCert = false; // Default: verify certificates
    let proxy: ProxyConfig | undefined;

    // Use explicit config if provided (for testing connections)
    if (this.explicitConfig) {
      host = this.explicitConfig.host;
      port = this.explicitConfig.port;
      protocol = this.explicitConfig.protocol;
      // For explicit configs (testing), check if allowSelfSignedCert was passed
      allowSelfSignedCert = this.explicitConfig.allowSelfSignedCert ?? false;
      // Proxy from explicit config
      proxy = this.explicitConfig.proxy;
    } else {
      // Get node config from database
      const nodeConfig = await prisma.nodeConfig.findFirst({
        where: { isDefault: true },
      });

      if (nodeConfig && nodeConfig.type === 'electrum') {
        // Load per-network singleton config based on this.network
        switch (this.network) {
          case 'mainnet':
            host = nodeConfig.mainnetSingletonHost || nodeConfig.host;
            port = nodeConfig.mainnetSingletonPort || nodeConfig.port;
            protocol = (nodeConfig.mainnetSingletonSsl ?? nodeConfig.useSsl) ? 'ssl' : 'tcp';
            break;
          case 'testnet':
            host = nodeConfig.testnetSingletonHost || config.bitcoin.electrum.host;
            port = nodeConfig.testnetSingletonPort || 51001;
            protocol = nodeConfig.testnetSingletonSsl ? 'ssl' : 'tcp';
            break;
          case 'signet':
            host = nodeConfig.signetSingletonHost || config.bitcoin.electrum.host;
            port = nodeConfig.signetSingletonPort || 60001;
            protocol = nodeConfig.signetSingletonSsl ? 'ssl' : 'tcp';
            break;
          case 'regtest':
          default:
            // Regtest uses legacy config
            host = nodeConfig.host;
            port = nodeConfig.port;
            protocol = nodeConfig.useSsl ? 'ssl' : 'tcp';
            break;
        }
        // Check if self-signed certificates are allowed (opt-in for security)
        allowSelfSignedCert = nodeConfig.allowSelfSignedCert ?? false;
        // Load proxy config from database (global, applies to all networks)
        if (nodeConfig.proxyEnabled && nodeConfig.proxyHost && nodeConfig.proxyPort) {
          proxy = {
            enabled: true,
            host: nodeConfig.proxyHost,
            port: nodeConfig.proxyPort,
            username: nodeConfig.proxyUsername ?? undefined,
            password: nodeConfig.proxyPassword ?? undefined,
          };
        }
      } else {
        // Fallback to env config
        host = config.bitcoin.electrum.host;
        port = config.bitcoin.electrum.port;
        protocol = config.bitcoin.electrum.protocol;
        // Default to verifying certificates
        allowSelfSignedCert = false;
      }
    }

    // Get connection timeout from config or use default
    const connectionTimeoutMs = this.explicitConfig?.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;

    // Now create the connection using a sync Promise executor
    return new Promise((resolve, reject) => {
      let connectionTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      // Helper to clean up timeout and mark as settled
      const cleanup = () => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
      };

      const handleSuccess = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.connected = true;
        resolve();
      };

      const handleError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.connected = false;
        // Destroy socket on error to clean up
        if (this.socket) {
          this.socket.destroy();
        }
        reject(error);
      };

      try {
        // Set connection timeout - fail fast so pool can try other servers
        connectionTimeout = setTimeout(() => {
          const timeoutError = new Error(`Connection timeout after ${connectionTimeoutMs}ms to ${host}:${port} (${protocol})${proxy?.enabled ? ' via proxy' : ''}`);
          log.warn(`Connection timeout`, { host, port, protocol, proxy: proxy?.enabled, timeoutMs: connectionTimeoutMs });
          handleError(timeoutError);
        }, connectionTimeoutMs);

        // Helper function to create connection (direct or via proxy)
        const createConnection = async (): Promise<net.Socket> => {
          if (proxy?.enabled) {
            // Use SOCKS5 proxy with extended timeout
            return this.createProxiedSocket(proxy, host, port, connectionTimeoutMs);
          } else {
            // Direct connection
            return new Promise((resolveSocket, rejectSocket) => {
              const socket = net.connect({ host, port });
              socket.once('connect', () => resolveSocket(socket));
              socket.once('error', rejectSocket);
            });
          }
        };

        // Create the base socket (either direct or via proxy)
        createConnection()
          .then((baseSocket) => {
            if (protocol === 'ssl') {
              // Wrap in TLS
              if (allowSelfSignedCert) {
                log.warn(`Initiating TLS connection to ${host}:${port} with certificate verification DISABLED (self-signed allowed)${proxy?.enabled ? ' via proxy' : ''}`);
              } else {
                log.info(`Initiating TLS connection to ${host}:${port} with certificate verification enabled${proxy?.enabled ? ' via proxy' : ''}`);
              }

              const tlsSocket = tls.connect(
                {
                  socket: baseSocket, // Use existing socket from proxy/direct connection
                  // Only disable certificate verification if explicitly allowed
                  // This protects against MITM attacks by default
                  rejectUnauthorized: !allowSelfSignedCert,
                  servername: host, // SNI support
                  // Enable TLS session resumption for faster reconnects
                  session: undefined, // Let Node.js handle session caching
                },
                () => {
                  // This callback fires on secureConnect
                  log.info(`Connected to ${host}:${port} (${protocol}) - TLS handshake complete${proxy?.enabled ? ' via proxy' : ''}`);

                  // Apply socket optimizations after TLS handshake
                  // Disable Nagle's algorithm - reduces latency for small packets (JSON-RPC)
                  tlsSocket.setNoDelay(true);
                  // Enable TCP keepalive - detects dead connections faster (30 second interval)
                  tlsSocket.setKeepAlive(true, 30000);

                  handleSuccess();
                }
              );
              this.socket = tlsSocket;

              tlsSocket.on('error', (err) => {
                log.error(`TLS socket error`, { error: String(err) });
                handleError(err);
              });
            } else {
              // Plain TCP - socket is already connected
              this.socket = baseSocket;
              log.info(`Connected to ${host}:${port} (${protocol})${proxy?.enabled ? ' via proxy' : ''}`);

              // Apply socket optimizations
              // Disable Nagle's algorithm - reduces latency for small packets (JSON-RPC)
              baseSocket.setNoDelay(true);
              // Enable TCP keepalive - detects dead connections faster (30 second interval)
              baseSocket.setKeepAlive(true, 30000);

              handleSuccess();
            }

            // Set up event handlers on the socket
            this.socket!.on('data', (data) => {
              this.handleData(data);
            });

            this.socket!.on('error', (error) => {
              log.error('Socket error', { error });
              // Reject all pending requests on socket error
              this.rejectPendingRequests(new Error(`Socket error: ${error.message}`));
            });

            this.socket!.on('close', () => {
              log.debug('Connection closed');
              this.connected = false;
              // Reject all pending requests on connection close
              this.rejectPendingRequests(new Error('Connection closed unexpectedly'));
            });

            this.socket!.on('end', () => {
              log.debug('Connection ended');
              this.connected = false;
              // Reject all pending requests on connection end
              this.rejectPendingRequests(new Error('Connection ended'));
            });
          })
          .catch((error) => {
            log.error('Connection error', { error });
            handleError(error as Error);
          });
      } catch (error) {
        log.error('Connection setup error', { error });
        handleError(error as Error);
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
            log.debug(`Received response: id=${response.id} pendingCount=${this.pendingRequests.size} hasError=${!!response.error}`);

            if (response.error) {
              const errorMsg = response.error.message || JSON.stringify(response.error);
              log.debug(`Electrum error response: id=${response.id} error=${errorMsg}`);
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

      // Timeout after configured duration (default 30s, 90s for Tor)
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          log.warn(`Request timeout: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
          reject(new Error(`Request timeout after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      const message = JSON.stringify(request) + '\n';
      log.debug(`Sending request: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
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
        // Timeout after configured duration (default 60s, 180s for Tor)
        const timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            log.warn(`Batch request timeout: method=${requests[i].method} id=${id} pendingCount=${this.pendingRequests.size}`);
            reject(new Error(`Batch request timeout after ${this.batchRequestTimeoutMs}ms for id ${id}`));
          }
        }, this.batchRequestTimeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timeoutId });
      });

      requestPromises.push(promise);
      messages.push(JSON.stringify(request));
    }

    // Send all requests in a single write (separated by newlines)
    const batchMessage = messages.join('\n') + '\n';
    log.debug(`Sending batch: count=${requests.length} firstId=${startId} lastId=${this.requestId} pendingCount=${this.pendingRequests.size}`);
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
   * Ping the server to keep connection alive
   * Returns null on success (as per Electrum protocol)
   */
  async ping(): Promise<null> {
    return this.request('server.ping');
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
   * Note: verbose=true is not supported by all servers (e.g., Blockstream's electrs)
   * We now default to non-verbose mode and decode locally to avoid error/retry overhead
   */
  async getTransaction(txid: string, verbose: boolean = false): Promise<any> {
    // Always use non-verbose mode since most electrs servers don't support verbose
    // This avoids the error/retry overhead and extra round trips
    const rawTx = await this.request('blockchain.transaction.get', [txid, false]);
    return this.decodeRawTransaction(rawTx);
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
          // Try to extract address from output script (using the correct network)
          address = bitcoin.address.fromOutputScript(output.script, this.getNetworkLib());
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
   * Batch: Subscribe to multiple addresses in a single RPC batch
   * Much more efficient than subscribing to each address individually
   * Returns a Map of address -> status (hash of history, or null if no history)
   */
  async subscribeAddressBatch(addresses: string[]): Promise<Map<string, string | null>> {
    if (addresses.length === 0) return new Map();

    // Prepare batch requests and track mappings
    const requests = addresses.map(address => {
      const scriptHash = this.addressToScriptHash(address);
      // Track the mapping so we can resolve address from notifications
      this.scriptHashToAddress.set(scriptHash, address);
      return {
        method: 'blockchain.scripthash.subscribe',
        params: [scriptHash],
      };
    });

    // Execute batch
    const results = await this.batchRequest(requests);

    // Map results back to addresses
    const resultMap = new Map<string, string | null>();
    for (let i = 0; i < addresses.length; i++) {
      resultMap.set(addresses[i], results[i] || null);
    }

    return resultMap;
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

    // Always use non-verbose mode since Blockstream (and other electrs) doesn't support verbose
    // This avoids the verbose error and retry overhead
    const useVerbose = false;

    // Prepare batch requests
    const requests = txids.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid, useVerbose],
    }));

    // Execute batch with retry for timeouts
    let results: any[];
    const MAX_RETRIES = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        results = await this.batchRequest(requests);
        // Decode raw transactions since we're using non-verbose mode
        results = results.map(rawTx => this.decodeRawTransaction(rawTx));
        break;
      } catch (error: any) {
        lastError = error;
        // If timeout, retry after delay
        if (error.message?.includes('timeout')) {
          log.warn(`Batch transaction fetch timeout, attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
        }
        throw error;
      }
    }

    // Map results back to txids
    const resultMap = new Map<string, any>();
    for (let i = 0; i < txids.length; i++) {
      if (results![i]) {
        resultMap.set(txids[i], results![i]);
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

    // Decode address to get scriptPubKey (using the correct network)
    const script = bitcoin.address.toOutputScript(address, this.getNetworkLib());

    // SHA256 hash
    const hash = crypto.createHash('sha256').update(script).digest();

    // Reverse bytes for Electrum format
    const reversed = Buffer.from(hash).reverse();

    return reversed.toString('hex');
  }
}

// Network-keyed client registry (replaces singleton pattern)
const electrumClients = new Map<string, ElectrumClient>();

/**
 * Get Electrum client instance for a specific network
 * @param network Bitcoin network (mainnet, testnet, signet, or regtest)
 *
 * Note: The client is created without explicitConfig, so connect() will load
 * per-network config from the database.
 */
export function getElectrumClientForNetwork(network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): ElectrumClient {
  if (!electrumClients.has(network)) {
    // Create client without explicitConfig - connect() will load per-network config from database
    const client = new ElectrumClient();
    client.setNetwork(network);
    electrumClients.set(network, client);
  }
  return electrumClients.get(network)!;
}

/**
 * Get Electrum client instance (backward compatibility - defaults to mainnet)
 */
export function getElectrumClient(): ElectrumClient {
  return getElectrumClientForNetwork('mainnet');
}

/**
 * Close Electrum connection for a specific network
 */
export function closeElectrumClientForNetwork(network: 'mainnet' | 'testnet' | 'signet' | 'regtest'): void {
  const client = electrumClients.get(network);
  if (client) {
    client.disconnect();
    electrumClients.delete(network);
  }
}

/**
 * Close Electrum connection (backward compatibility - closes mainnet)
 */
export function closeElectrumClient(): void {
  closeElectrumClientForNetwork('mainnet');
}

/**
 * Close all Electrum connections
 */
export function closeAllElectrumClients(): void {
  for (const [network, client] of electrumClients.entries()) {
    client.disconnect();
  }
  electrumClients.clear();
}

/**
 * Reset Electrum client (alias for closeElectrumClient)
 */
export function resetElectrumClient(): void {
  closeElectrumClient();
}

export { ElectrumClient };
export default ElectrumClient;
