
export enum WalletType {
  SINGLE_SIG = 'Single Sig',
  MULTI_SIG = 'Multi Sig',
}

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

export type ThemeOption = 'sanctuary' | 'serenity' | 'forest' | 'cyber' | 'sunrise';
export type BackgroundOption = 'minimal' | 'zen' | 'circuit' | 'topography' | 'waves' | 'lines' | 'sanctuary' | 'sanctuary-hero';

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export interface NotificationSounds {
  enabled: boolean;
  confirmationChime: boolean; // Play sound on first confirmation
  volume: number; // 0-100
}

export interface UserPreferences {
  darkMode: boolean;
  unit: 'sats' | 'btc';
  fiatCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  showFiat: boolean;
  theme: ThemeOption;
  background: BackgroundOption;
  priceProvider?: string;
  telegram?: TelegramConfig;
  notificationSounds?: NotificationSounds;
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
}

export interface Device {
  id: string;
  type: HardwareDevice | string;
  label: string;
  fingerprint: string;
  xpub?: string;
  derivationPath?: string;
  userId?: string;
}

export interface UTXO {
  id?: string; // Database ID (needed for freeze API)
  txid: string;
  vout: number;
  amount: number; // in sats
  address: string;
  label?: string;
  frozen?: boolean;
  spendable?: boolean;
  confirmations: number;
  date?: number; // timestamp
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
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
  timestamp?: number;
  label?: string;
  labels?: Label[]; // Multiple labels support
  confirmations: number;
  walletId: string;
  address?: string; // Address this transaction is associated with
  blockHeight?: number; // Block height when confirmed
  counterpartyAddress?: string; // Sender (for receives) or recipient (for sends)
  inputs?: TransactionInput[];
  outputs?: TransactionOutput[];
  type?: 'sent' | 'received' | 'consolidation' | 'receive'; // Transaction type from sync
}

export interface Quorum {
  m: number;
  n: number;
}

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

export interface Wallet {
  id: string;
  name: string;
  type: WalletType | 'single_sig' | 'multi_sig';
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  quorum?: Quorum;
  deviceIds?: string[];
  balance: number;
  unit?: 'BTC' | 'sats';
  descriptor?: string;
  ownerId?: string; // User ID of the creator
  groupIds?: string[]; // IDs of groups this wallet is shared with
  derivationPath?: string;
  fingerprint?: string;
  label?: string;
  xpub?: string;
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'retrying' | null;
  syncInProgress?: boolean;
  // User permissions for this wallet
  userRole?: WalletRole;
  canEdit?: boolean;
}

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

export interface AppState {
  isAuthenticated: boolean;
  darkMode: boolean;
  activeWalletId: string | null;
}
