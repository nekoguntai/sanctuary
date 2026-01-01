/**
 * Network Provider Types
 *
 * Defines the interface for Bitcoin network data providers.
 * Implementations can use Electrum, Esplora, or other backends.
 *
 * ## Available Providers
 *
 * - ElectrumProvider: Uses Electrum protocol (existing implementation)
 * - EsploraProvider: Uses Esplora REST API (future implementation)
 *
 * ## Usage
 *
 * ```typescript
 * import { createNetworkProvider } from './providers';
 *
 * const provider = await createNetworkProvider({
 *   type: 'electrum',
 *   network: 'mainnet',
 * });
 *
 * const balance = await provider.getAddressBalance('bc1q...');
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Bitcoin network type
 */
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';

/**
 * Provider type
 */
export type ProviderType = 'electrum' | 'esplora';

/**
 * Address balance response
 */
export interface AddressBalance {
  confirmed: bigint;
  unconfirmed: bigint;
}

/**
 * Transaction history entry
 */
export interface TransactionHistoryEntry {
  txid: string;
  height: number; // 0 or negative for unconfirmed
}

/**
 * Unspent transaction output
 */
export interface UTXO {
  txid: string;
  vout: number;
  value: bigint;
  height: number;
  scriptPubKey?: string;
}

/**
 * Transaction input
 */
export interface TransactionInput {
  txid: string;
  vout: number;
  scriptSig?: string;
  sequence: number;
  witness?: string[];
}

/**
 * Transaction output
 */
export interface TransactionOutput {
  value: bigint;
  scriptPubKey: string;
  address?: string;
}

/**
 * Raw transaction data
 */
export interface RawTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: TransactionInput[];
  vout: TransactionOutput[];
  hex?: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

/**
 * Block header data
 */
export interface BlockHeader {
  hash: string;
  height: number;
  version: number;
  previousblockhash: string;
  merkleroot: string;
  time: number;
  bits: string;
  nonce: number;
}

/**
 * Fee estimates (in sat/vB)
 */
export interface FeeEstimates {
  fastest: number; // 1-2 blocks
  fast: number;    // 3-6 blocks
  medium: number;  // 6-12 blocks
  slow: number;    // 12-24 blocks
  minimum: number; // Minimum relay fee
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  connected: boolean;
  latency: number; // ms
  blockHeight: number;
  serverInfo?: string;
  lastCheck: Date;
}

/**
 * Subscription callback types
 */
export type AddressCallback = (address: string, status: string) => void;
export type BlockCallback = (height: number, header: BlockHeader) => void;

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Network provider interface
 *
 * All Bitcoin network data providers must implement this interface.
 * This allows swapping between Electrum, Esplora, or other backends.
 */
export interface INetworkProvider {
  /**
   * Provider type identifier
   */
  readonly type: ProviderType;

  /**
   * Bitcoin network this provider connects to
   */
  readonly network: BitcoinNetwork;

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to the network provider
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the network provider
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean;

  /**
   * Get provider health status
   */
  getHealth(): Promise<ProviderHealth>;

  // ===========================================================================
  // Address Operations
  // ===========================================================================

  /**
   * Get balance for an address
   * @param address Bitcoin address
   */
  getAddressBalance(address: string): Promise<AddressBalance>;

  /**
   * Get balance for multiple addresses (batch)
   * @param addresses List of Bitcoin addresses
   */
  getAddressBalances(addresses: string[]): Promise<Map<string, AddressBalance>>;

  /**
   * Get transaction history for an address
   * @param address Bitcoin address
   */
  getAddressHistory(address: string): Promise<TransactionHistoryEntry[]>;

  /**
   * Get transaction history for multiple addresses (batch)
   * @param addresses List of Bitcoin addresses
   */
  getAddressHistories(addresses: string[]): Promise<Map<string, TransactionHistoryEntry[]>>;

  /**
   * Get unspent outputs for an address
   * @param address Bitcoin address
   */
  getAddressUTXOs(address: string): Promise<UTXO[]>;

  /**
   * Get unspent outputs for multiple addresses (batch)
   * @param addresses List of Bitcoin addresses
   */
  getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, UTXO[]>>;

  // ===========================================================================
  // Transaction Operations
  // ===========================================================================

  /**
   * Get transaction by txid
   * @param txid Transaction ID
   * @param verbose Whether to include decoded data
   */
  getTransaction(txid: string, verbose?: boolean): Promise<RawTransaction | string>;

  /**
   * Get multiple transactions (batch)
   * @param txids List of transaction IDs
   * @param verbose Whether to include decoded data
   */
  getTransactions(txids: string[], verbose?: boolean): Promise<Map<string, RawTransaction | string>>;

  /**
   * Broadcast a signed transaction
   * @param hex Signed transaction hex
   * @returns Transaction ID
   */
  broadcastTransaction(hex: string): Promise<string>;

  // ===========================================================================
  // Block Operations
  // ===========================================================================

  /**
   * Get current block height
   */
  getBlockHeight(): Promise<number>;

  /**
   * Get block header by height
   * @param height Block height
   */
  getBlockHeader(height: number): Promise<BlockHeader>;

  /**
   * Get block header by hash
   * @param hash Block hash
   */
  getBlockHeaderByHash(hash: string): Promise<BlockHeader>;

  // ===========================================================================
  // Fee Estimation
  // ===========================================================================

  /**
   * Get fee estimates
   */
  getFeeEstimates(): Promise<FeeEstimates>;

  /**
   * Estimate fee for a specific confirmation target
   * @param blocks Target number of blocks
   * @returns Fee rate in sat/vB
   */
  estimateFee(blocks: number): Promise<number>;

  // ===========================================================================
  // Subscriptions (Optional - not all providers support this)
  // ===========================================================================

  /**
   * Subscribe to address updates
   * @param address Bitcoin address
   * @param callback Called when address status changes
   * @returns Unsubscribe function
   */
  subscribeToAddress?(address: string, callback: AddressCallback): Promise<() => void>;

  /**
   * Subscribe to new blocks
   * @param callback Called when new block is found
   * @returns Unsubscribe function
   */
  subscribeToBlocks?(callback: BlockCallback): Promise<() => void>;
}

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Base provider configuration
 */
export interface BaseProviderConfig {
  type: ProviderType;
  network: BitcoinNetwork;
  timeoutMs?: number;
}

/**
 * Electrum provider configuration
 */
export interface ElectrumProviderConfig extends BaseProviderConfig {
  type: 'electrum';
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
  allowSelfSignedCert?: boolean;
  proxy?: {
    enabled: boolean;
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
}

/**
 * Esplora provider configuration
 */
export interface EsploraProviderConfig extends BaseProviderConfig {
  type: 'esplora';
  baseUrl: string;
  apiKey?: string;
}

/**
 * Provider configuration union type
 */
export type ProviderConfig = ElectrumProviderConfig | EsploraProviderConfig;

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Provider factory function type
 */
export type ProviderFactory = (config: ProviderConfig) => Promise<INetworkProvider>;

/**
 * Provider registry
 */
export interface ProviderRegistry {
  register(type: ProviderType, factory: ProviderFactory): void;
  create(config: ProviderConfig): Promise<INetworkProvider>;
  getTypes(): ProviderType[];
}
