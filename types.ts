/**
 * Central Type Definitions
 *
 * Single source of truth for all shared types across the Sanctuary codebase.
 * This file contains both UI-facing types (enums for display) and API-facing types.
 */

// ============================================================================
// WALLET TYPE ENUMS & ALIASES
// ============================================================================

/**
 * WalletType enum for UI display purposes (icons, labels)
 * Values are human-readable display strings
 */
export enum WalletType {
  SINGLE_SIG = 'Single Sig',
  MULTI_SIG = 'Multi Sig',
}

/**
 * API wallet type - what the backend returns
 */
export type ApiWalletType = 'single_sig' | 'multi_sig';

/**
 * Script type for wallet address derivation
 */
export type WalletScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';

/**
 * Bitcoin network
 */
export type WalletNetwork = 'mainnet' | 'testnet' | 'regtest';

// ============================================================================
// HARDWARE DEVICE ENUMS & TYPES
// ============================================================================

export enum HardwareDevice {
  COLDCARD_MK4 = 'ColdCardMk4',
  COLDCARD_Q = 'ColdCard Q',
  TREZOR = 'Trezor',
  TREZOR_SAFE_7 = 'Trezor Safe 7',
  LEDGER = 'Ledger Nano',
  LEDGER_STAX = 'Ledger Stax',
  LEDGER_FLEX = 'Ledger Flex',
  LEDGER_GEN_5 = 'Ledger Gen 5',
  BITBOX = 'BitBox02',
  FOUNDATION_PASSPORT = 'Foundation Passport',
  BLOCKSTREAM_JADE = 'Blockstream Jade',
  KEYSTONE = 'Keystone',
  GENERIC = 'Generic SD',
}

export interface HardwareDeviceModel {
  id: string;
  name: string;
  slug: string;
  manufacturer: string;
  connectivity: string[];
  secureElement: boolean;
  openSource: boolean;
  airGapped: boolean;
  supportsBitcoinOnly: boolean;
  supportsMultisig: boolean;
  supportsTaproot: boolean;
  supportsPassphrase: boolean;
  scriptTypes: string[];
  hasScreen: boolean;
  screenType?: string;
  releaseYear?: number;
  discontinued: boolean;
  imageUrl?: string;
  websiteUrl?: string;
}

// ============================================================================
// THEME & UI TYPES
// ============================================================================

export type ThemeOption = 'sanctuary' | 'serenity' | 'forest' | 'cyber' | 'sunrise';
export type BackgroundOption = 'minimal' | 'zen' | 'circuit' | 'topography' | 'waves' | 'lines' | 'sanctuary' | 'sanctuary-hero';

// ============================================================================
// TELEGRAM & NOTIFICATION TYPES
// ============================================================================

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
  notifyDraft: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export type SoundType = 'chime' | 'bell' | 'coin' | 'success' | 'gentle' | 'zen' | 'ping' | 'pop' | 'harp' | 'retro' | 'marimba' | 'glass' | 'synth' | 'drop' | 'sparkle' | 'drums' | 'whistle' | 'brass' | 'windchime' | 'click' | 'none';

export interface EventSoundConfig {
  enabled: boolean;
  sound: SoundType;
}

export interface NotificationSounds {
  enabled: boolean;
  volume: number; // 0-100
  // Per-event sound configuration
  confirmation?: EventSoundConfig; // Transaction confirmed
  receive?: EventSoundConfig;      // Bitcoin received
  send?: EventSoundConfig;         // Transaction broadcast
  // Legacy fields for backwards compatibility
  confirmationChime?: boolean;
  soundType?: SoundType;
}

// ============================================================================
// USER & GROUP TYPES
// ============================================================================

// View settings for a single page/component
export interface PageViewSettings {
  layout?: string;          // 'grid' | 'table' | 'list' | 'grouped' | etc.
  sortBy?: string;          // Column to sort by (future)
  sortOrder?: 'asc' | 'desc'; // Sort direction (future)
}

// View settings keyed by page name (wallets, devices, transactions, etc.)
export interface ViewSettings {
  [pageKey: string]: PageViewSettings;
}

export interface UserPreferences {
  darkMode: boolean;
  unit: 'sats' | 'btc';
  fiatCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  showFiat: boolean;
  theme: ThemeOption;
  background: BackgroundOption;
  contrastLevel?: number; // -2 to +2, adjusts background contrast (0 = default)
  patternOpacity?: number; // 0 to 100, controls background pattern visibility (default 50)
  priceProvider?: string;
  telegram?: TelegramConfig;
  notificationSounds?: NotificationSounds;
  viewSettings?: ViewSettings;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  password?: string; // Simple mock password
  preferences?: UserPreferences;
  twoFactorEnabled?: boolean;
  usingDefaultPassword?: boolean;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

// ============================================================================
// NODE CONFIGURATION
// ============================================================================

export interface NodeConfig {
  type: 'bitcoind' | 'electrum';
  host: string;
  port: string;
  useSsl: boolean;
  user?: string;
  password?: string;
  explorerUrl?: string; // e.g., https://mempool.space
  feeEstimatorUrl?: string; // e.g., https://mempool.space (mempool.space-compatible API for fee estimation)
  mempoolEstimator?: 'simple' | 'mempool_space'; // Algorithm for block confirmation estimation
  // Connection pooling settings (Electrum only)
  poolEnabled?: boolean; // false = single connection mode
  poolMinConnections?: number;
  poolMaxConnections?: number;
  poolLoadBalancing?: 'round_robin' | 'least_connections' | 'failover_only';
  // Electrum server list (multi-server pool support)
  servers?: ElectrumServer[];
}

// Electrum server configuration
export interface ElectrumServer {
  id: string;
  nodeConfigId: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  // Health tracking
  lastHealthCheck?: string | null;
  healthCheckFails?: number;
  isHealthy?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Per-server statistics (from pool stats)
export interface ElectrumServerStats {
  serverId: string;
  label: string;
  host: string;
  port: number;
  connectionCount: number;
  healthyConnections: number;
  totalRequests: number;
  failedRequests: number;
  isHealthy: boolean;
  lastHealthCheck: string | null;
}

// Electrum connection pool statistics
export interface ElectrumPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquisitions: number;
  averageAcquisitionTimeMs: number;
  healthCheckFailures: number;
  serverCount: number;
  servers: ElectrumServerStats[];
}

// ============================================================================
// DEVICE TYPES
// ============================================================================

export interface Device {
  id: string;
  type: HardwareDevice | string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub?: string; // Optional for backward compat, but typically present
  userId?: string;
  createdAt?: string;
  model?: HardwareDeviceModel;
  wallets?: Array<{
    wallet: {
      id: string;
      name: string;
      type: string;
      scriptType?: string;
    };
  }>;
}

// ============================================================================
// LABEL TYPES
// ============================================================================

export interface Label {
  id: string;
  walletId: string;
  name: string;
  color: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  // Optional counts (present on list responses)
  transactionCount?: number;
  addressCount?: number;
}

export interface LabelWithItems extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: number;
    confirmations: number;
    blockTime?: string;
  }>;
  addresses: Array<{
    id: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>;
}

// ============================================================================
// UTXO TYPES
// ============================================================================

export interface UTXO {
  id?: string; // Database ID (needed for freeze API)
  txid: string;
  vout: number;
  amount: number; // in sats
  address: string;
  label?: string;
  frozen?: boolean;
  spendable?: boolean;
  spent?: boolean;
  confirmations: number;
  date?: number | string; // timestamp
  scriptType?: WalletScriptType;
  scriptPubKey?: string;
  blockHeight?: number;
  createdAt?: string;
  // Draft lock info (UTXO is reserved for a pending draft transaction)
  lockedByDraftId?: string;
  lockedByDraftLabel?: string;
}

// ============================================================================
// ADDRESS TYPES
// ============================================================================

export interface Address {
  id?: string;
  address: string;
  derivationPath: string;
  index: number;
  label?: string;
  labels?: Label[]; // Multiple labels support
  used: boolean;
  balance: number;
  createdAt?: string;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export interface TransactionInput {
  address: string;
  amount: number;
}

export interface TransactionOutput {
  address: string;
  amount: number;
}

export interface Transaction {
  id: string;
  txid: string;
  walletId: string;
  amount: number; // in sats, negative for send, positive for receive
  fee?: number;
  balanceAfter?: number; // Wallet balance after this transaction (running balance)
  timestamp?: number; // Unix timestamp (legacy field)
  blockTime?: string; // ISO timestamp (preferred)
  label?: string;
  memo?: string;
  labels?: Label[]; // Multiple labels support
  confirmations: number;
  address?: string | { address: string; derivationPath?: string }; // Address this transaction is associated with
  blockHeight?: number; // Block height when confirmed
  counterpartyAddress?: string; // Sender (for receives) or recipient (for sends)
  inputs?: TransactionInput[];
  outputs?: TransactionOutput[];
  type?: 'sent' | 'received' | 'consolidation' | 'receive'; // Transaction type from sync
  // RBF tracking
  replacedByTxid?: string; // If this tx was replaced, points to replacement
  replacementForTxid?: string; // If this is a replacement, points to original
  rbfStatus?: 'active' | 'replaced' | 'confirmed'; // Transaction RBF status
}

/**
 * Pending transaction for block queue visualization
 * Shows user's unconfirmed transactions and their position in mempool
 */
export interface PendingTransaction {
  txid: string;
  walletId: string;
  walletName?: string;
  type: 'sent' | 'received';
  amount: number; // in satoshis
  fee: number; // in satoshis
  feeRate: number; // sat/vB (fee / vsize)
  vsize?: number; // virtual size in vBytes
  recipient?: string; // recipient address for sent txs
  timeInQueue: number; // seconds since broadcast
  createdAt: string; // ISO timestamp
}

// ============================================================================
// WALLET TYPES
// ============================================================================

export interface Quorum {
  m: number;
  n: number;
}

/**
 * Helper to get the 'm' value from a Quorum (required signatures)
 * Handles both Quorum object and plain number
 */
export function getQuorumM(quorum: Quorum | number | undefined, fallback = 1): number {
  if (quorum === undefined) return fallback;
  return typeof quorum === 'number' ? quorum : quorum.m;
}

/**
 * Helper to get the 'n' value from a Quorum (total signers)
 * Handles both Quorum object and plain number (needs totalSigners)
 */
export function getQuorumN(quorum: Quorum | number | undefined, totalSigners?: number, fallback = 1): number {
  if (quorum === undefined) return totalSigners ?? fallback;
  return typeof quorum === 'number' ? (totalSigners ?? fallback) : quorum.n;
}

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

export interface Wallet {
  id: string;
  name: string;
  type: WalletType | ApiWalletType; // Supports both enum values and API strings
  scriptType?: WalletScriptType;
  network?: WalletNetwork;
  quorum?: Quorum | number; // Quorum object or just m value
  totalSigners?: number; // n value when quorum is a number
  deviceIds?: string[];
  balance: number;
  unit?: 'BTC' | 'sats' | 'btc';
  descriptor?: string;
  ownerId?: string; // User ID of the creator
  groupIds?: string[]; // IDs of groups this wallet is shared with
  derivationPath?: string;
  fingerprint?: string;
  label?: string;
  xpub?: string;
  // Counts
  deviceCount?: number;
  addressCount?: number;
  // Timestamps
  createdAt?: string;
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'retrying' | string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared?: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User permissions for this wallet
  userRole?: WalletRole;
  canEdit?: boolean;
}

// ============================================================================
// FEE ESTIMATE TYPES
// ============================================================================

export interface FeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee?: number;
  minimumFee?: number;
}

export interface FeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum?: number;
}

// ============================================================================
// BITCOIN TRANSACTION DETAILS (for Electrum/mempool.space responses)
// ============================================================================

export interface BitcoinTransactionDetails {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: Array<{
    txid: string;
    vout: number;
    scriptSig?: string;
    sequence: number;
    prevout?: {
      value: number;
      scriptPubKey: {
        type: string;
        address?: string;
      };
    };
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      type: string;
      address?: string;
      addresses?: string[];
    };
  }>;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface BlockHeader {
  height: number;
  hash: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  merkleroot: string;
  previousblockhash?: string;
  nextblockhash?: string;
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

export interface WebSocketTransactionData {
  txid?: string;
  type?: 'received' | 'sent' | 'consolidation';
  amount?: number;
  confirmations?: number;
  walletId?: string;
}

export interface WebSocketBalanceData {
  balance?: number;
  confirmed?: number;
  unconfirmed?: number;
  change?: number;
  walletId?: string;
}

export interface WebSocketConfirmationData {
  txid?: string;
  confirmations?: number;
  walletId?: string;
}

export interface WebSocketSyncData {
  inProgress?: boolean;
  status?: 'scanning' | 'complete' | 'error' | 'retry' | 'retrying' | 'success' | 'failed';
  lastSyncedAt?: string;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  walletId?: string;
}

// Generic event data for backward compatibility
export interface WebSocketEventData {
  walletId?: string;
  balance?: number;
  txid?: string;
  amount?: number;
  type?: string;
  confirmations?: number;
  message?: string;
  change?: number;
  inProgress?: boolean;
  status?: string;
  lastSyncedAt?: string;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

export interface WebSocketCallbacks {
  onTransaction?: (data: WebSocketTransactionData) => void;
  onBalance?: (data: WebSocketBalanceData) => void;
  onConfirmation?: (data: WebSocketConfirmationData) => void;
  onSync?: (data: WebSocketSyncData) => void;
}

// ============================================================================
// APP STATE
// ============================================================================

export interface AppState {
  isAuthenticated: boolean;
  darkMode: boolean;
  activeWalletId: string | null;
}
