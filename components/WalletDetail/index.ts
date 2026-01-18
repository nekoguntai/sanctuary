/**
 * WalletDetail Module
 *
 * Modular wallet detail view split into tab-based components.
 */

// Types
export * from './types';

// Tab Components
export { LogTab } from './LogTab';
export { WalletTelegramSettings } from './WalletTelegramSettings';

// Re-export the main component from parent directory for backwards compatibility
// The main WalletDetail.tsx will gradually import from here
