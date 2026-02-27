/**
 * WalletDetail Module
 *
 * Modular wallet detail view split into tab-based components.
 */

// Types
export * from './types';

// Custom Hooks
export {
  useWalletData,
  useWalletSync,
  useWalletSharing,
  useAITransactionFilter,
  useWalletWebSocket,
} from './hooks';

// Header
export { WalletHeader } from './WalletHeader';

// Tab Components
export { LogTab } from './LogTab';
export { WalletTelegramSettings } from './WalletTelegramSettings';
export {
  TransactionsTab,
  UTXOTab,
  AddressesTab,
  DraftsTab,
  StatsTab,
  AccessTab,
  SettingsTab,
} from './tabs';

// Modal Components
export { DeviceSharePromptModal } from './modals';

// Re-export the main component from parent directory for backwards compatibility
// The main WalletDetail.tsx will gradually import from here
