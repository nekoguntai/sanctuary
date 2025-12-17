/**
 * Central Type Definitions
 *
 * Single source of truth for all shared types across the Sanctuary codebase.
 * API modules and components should import from here.
 */

// ============================================================================
// LABEL TYPES
// ============================================================================

export interface Label {
  id: string;
  walletId: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
// TRANSACTION TYPES
// ============================================================================

export interface Transaction {
  id: string;
  txid: string;
  walletId: string;
  type: 'received' | 'sent' | 'receive' | 'consolidation';
  amount: string | number;
  fee?: string | number;
  confirmations: number;
  blockHeight?: number;
  blockTime?: string;
  label?: string;
  memo?: string;
  labels?: Label[];
  address?: {
    address: string;
    derivationPath: string;
  };
  counterpartyAddress?: string;
}

export interface TransactionInput {
  address: string;
  amount: number;
}

export interface TransactionOutput {
  address: string;
  amount: number;
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
  amount: number;           // in satoshis
  fee: number;              // in satoshis
  feeRate: number;          // sat/vB (fee / vsize)
  vsize?: number;           // virtual size in vBytes
  recipient?: string;       // recipient address for sent txs
  timeInQueue: number;      // seconds since broadcast
  createdAt: string;        // ISO timestamp
}

// ============================================================================
// UTXO TYPES
// ============================================================================

export interface UTXO {
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: string | number;
  scriptPubKey?: string;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  confirmations: number;
  blockHeight?: number;
  spent?: boolean;
  spendable?: boolean;
  createdAt?: string;
  date?: string;
  // UI-specific fields (may not always be present)
  label?: string;
  frozen?: boolean;
}

// ============================================================================
// ADDRESS TYPES
// ============================================================================

export interface Address {
  id: string;
  address: string;
  derivationPath: string;
  index: number;
  used: boolean;
  balance: number;
  labels?: Label[];
  createdAt: string;
  label?: string; // Legacy single label support
}

// ============================================================================
// DEVICE TYPES
// ============================================================================

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

export interface Device {
  id: string;
  type: string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub: string;
  createdAt: string;
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
// WALLET TYPES
// ============================================================================

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

export type WalletScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type WalletNetwork = 'mainnet' | 'testnet' | 'regtest';

export type WalletType = 'single_sig' | 'multi_sig';

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  scriptType: WalletScriptType;
  network: WalletNetwork;
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  derivationPath?: string;
  label?: string;
  xpub?: string;
  balance: number;
  deviceCount?: number;
  addressCount?: number;
  createdAt?: string;
  // Device associations
  deviceIds?: string[];
  // Display preferences
  unit?: 'sats' | 'btc';
  // Owner info
  ownerId?: string;
  groupIds?: string[];
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared?: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User permissions
  userRole?: WalletRole;
  canEdit?: boolean;
}

export interface Quorum {
  m: number;
  n: number;
}

// ============================================================================
// FEE ESTIMATE TYPES
// ============================================================================

export interface FeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum?: number;
}

// Legacy alias for backward compatibility
export interface FeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee?: number;
}

// ============================================================================
// BITCOIN TRANSACTION DETAILS (for bitcoin.ts any fixes)
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
// WEBSOCKET EVENT TYPES (for useWebSocket.ts any fixes)
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
