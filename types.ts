
export enum WalletType {
  SINGLE_SIG = 'Single Sig',
  MULTI_SIG = 'Multi Sig',
}

export enum HardwareDevice {
  COLDCARD_MK4 = 'ColdCardMk4',
  COLDCARD_Q = 'ColdCard Q',
  TREZOR = 'Trezor',
  LEDGER = 'Ledger Nano',
  LEDGER_STAX = 'Ledger Stax',
  LEDGER_FLEX = 'Ledger Flex',
  BITBOX = 'BitBox02',
  FOUNDATION_PASSPORT = 'Foundation Passport',
  BLOCKSTREAM_JADE = 'Blockstream Jade',
  KEYSTONE = 'Keystone',
  GENERIC = 'Generic SD',
}

export type ThemeOption = 'sanctuary' | 'serenity' | 'forest' | 'cyber' | 'sunrise';
export type BackgroundOption = 'minimal' | 'zen' | 'circuit' | 'topography' | 'waves' | 'lines' | 'sanctuary' | 'sanctuary-hero';

export interface UserPreferences {
  darkMode: boolean;
  unit: 'sats' | 'btc';
  fiatCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  showFiat: boolean;
  theme: ThemeOption;
  background: BackgroundOption;
  priceProvider?: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  password?: string; // Simple mock password
  preferences?: UserPreferences;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

export interface NodeConfig {
  type: 'bitcoind' | 'electrum';
  host: string;
  port: string;
  useSsl: boolean;
  user?: string;
  password?: string;
  explorerUrl?: string; // e.g., https://mempool.space
  feeEstimatorUrl?: string; // e.g., https://mempool.space (mempool.space-compatible API for fee estimation)
}

export interface Device {
  id: string;
  type: HardwareDevice;
  label: string;
  fingerprint: string;
  xpub?: string;
  derivationPath?: string;
}

export interface UTXO {
  txid: string;
  vout: number;
  amount: number; // in sats
  address: string;
  label?: string;
  frozen: boolean;
  confirmations: number;
  date: number; // timestamp
}

export interface Address {
  id?: string;
  address: string;
  derivationPath: string;
  index: number;
  label?: string;
  labels?: Label[]; // Multiple labels support
  used: boolean;
  balance: number;
}

export interface TransactionInput {
  address: string;
  amount: number;
}

export interface TransactionOutput {
  address: string;
  amount: number;
}

export interface Label {
  id: string;
  walletId: string;
  name: string;
  color: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transaction {
  id: string;
  txid: string;
  amount: number; // in sats, negative for send, positive for receive
  fee?: number;
  timestamp: number;
  label: string;
  labels?: Label[]; // Multiple labels support
  confirmed: boolean;
  confirmations: number;
  walletId: string;
  address?: string; // Address this transaction is associated with
  blockHeight?: number; // Block height when confirmed
  counterpartyAddress?: string; // Sender (for receives) or recipient (for sends)
  inputs?: TransactionInput[];
  outputs?: TransactionOutput[];
}

export interface Quorum {
  m: number;
  n: number;
}

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  quorum?: Quorum;
  deviceIds: string[];
  balance: number;
  unit: 'BTC' | 'sats';
  descriptor: string;
  ownerId: string; // User ID of the creator
  groupIds: string[]; // IDs of groups this wallet is shared with
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'retrying' | null;
  syncInProgress?: boolean;
}

export interface FeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
}

export interface AppState {
  isAuthenticated: boolean;
  darkMode: boolean;
  activeWalletId: string | null;
}
