/**
 * WalletDetail Shared Types
 *
 * Types and interfaces shared across WalletDetail tab components.
 */

import type { Wallet, Transaction, UTXO, Device, User, Address, Label } from '../../types';
import type * as walletsApi from '../../src/api/wallets';
import type * as authApi from '../../src/api/auth';
import type * as transactionsApi from '../../src/api/transactions';
import type { NaturalQueryResult } from '../../src/api/ai';

// Tab types
export type TabType = 'tx' | 'utxo' | 'addresses' | 'drafts' | 'stats' | 'access' | 'settings' | 'log';
export type AddressSubTab = 'receive' | 'change';
export type AccessSubTab = 'ownership' | 'sharing' | 'transfers';
export type SettingsSubTab = 'general' | 'devices' | 'notifications' | 'advanced';
export type ExportTab = 'qr' | 'json' | 'text' | 'labels' | 'device';

// Device share prompt state
export interface DeviceSharePromptState {
  show: boolean;
  targetUserId: string;
  targetUsername: string;
  devices: Array<{ id: string; label: string; fingerprint: string }>;
}

// Sync retry state
export interface SyncRetryInfo {
  retryCount: number;
  maxRetries: number;
  error?: string;
}

// Common props passed to tab components
export interface WalletDetailTabProps {
  wallet: Wallet;
  walletId: string;
}

// Transaction tab props
export interface TransactionsTabProps extends WalletDetailTabProps {
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  addresses: Address[];
  highlightTxId?: string;
  aiQueryFilter: NaturalQueryResult | null;
  aiAggregationResult: number | null;
  onAiQueryChange: (result: NaturalQueryResult | null) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  stats: transactionsApi.TransactionStats | null;
  aiEnabled: boolean;
}

// UTXO tab props
export interface UTXOTabProps extends WalletDetailTabProps {
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onNavigateToSend: () => void;
}

// Addresses tab props
export interface AddressesTabProps extends WalletDetailTabProps {
  addresses: Address[];
  subTab: AddressSubTab;
  onSubTabChange: (tab: AddressSubTab) => void;
  addressLimit: number;
  onLoadMore: () => void;
  loading: boolean;
  availableLabels: Label[];
  editingAddressId: string | null;
  onEditAddress: (addressId: string | null) => void;
  onSaveAddressLabels: (addressId: string, labelIds: string[]) => void;
  savingLabels: boolean;
}

// Access tab props
export interface AccessTabProps extends WalletDetailTabProps {
  subTab: AccessSubTab;
  onSubTabChange: (tab: AccessSubTab) => void;
  walletShareInfo: walletsApi.WalletShareInfo | null;
  users: User[];
  groups: authApi.UserGroup[];
  userSearchQuery: string;
  userSearchResults: authApi.SearchUser[];
  searchingUsers: boolean;
  sharingLoading: boolean;
  onSearchUsers: (query: string) => void;
  onShareWithUser: (userId: string) => void;
  onRemoveUser: (userId: string) => void;
  onShareWithGroup: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onTransferOwnership: () => void;
  deviceSharePrompt: DeviceSharePromptState;
  onDeviceSharePromptClose: () => void;
  onShareDevices: (deviceIds: string[]) => void;
}

// Settings tab props
export interface SettingsTabProps extends WalletDetailTabProps {
  subTab: SettingsSubTab;
  onSubTabChange: (tab: SettingsSubTab) => void;
  devices: Device[];
  isEditingName: boolean;
  editedName: string;
  onEditName: (editing: boolean) => void;
  onNameChange: (name: string) => void;
  onSaveName: () => void;
  showDangerZone: boolean;
  onToggleDangerZone: () => void;
  onDeleteWallet: () => void;
  onRepairWallet: () => void;
  repairing: boolean;
  explorerUrl: string;
}

// Log tab props
export interface LogTabProps extends WalletDetailTabProps {
  logs: Array<{
    id: string;
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    category: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  isPaused: boolean;
  isLoading: boolean;
  autoScroll: boolean;
  levelFilter: 'all' | 'info' | 'warn' | 'error';
  onTogglePause: () => void;
  onClearLogs: () => void;
  onToggleAutoScroll: () => void;
  onLevelFilterChange: (level: 'all' | 'info' | 'warn' | 'error') => void;
}

// Export modal props
export interface ExportModalProps extends WalletDetailTabProps {
  show: boolean;
  onClose: () => void;
  exportTab: ExportTab;
  onExportTabChange: (tab: ExportTab) => void;
  exportFormats: walletsApi.ExportFormat[];
  loadingFormats: boolean;
  qrFormat: 'descriptor' | 'passport';
  onQrFormatChange: (format: 'descriptor' | 'passport') => void;
  qrSize: number;
  devices: Device[];
}

// Receive modal props
export interface ReceiveModalProps extends WalletDetailTabProps {
  show: boolean;
  onClose: () => void;
  addresses: Address[];
  selectedAddressId: string | null;
  onAddressSelect: (addressId: string) => void;
  payjoinEnabled: boolean;
  onPayjoinToggle: (enabled: boolean) => void;
  payjoinUri: string | null;
  payjoinLoading: boolean;
  receiveAmount: string;
  onAmountChange: (amount: string) => void;
}
