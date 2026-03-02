/**
 * Wallet Service - Barrel Export
 *
 * Re-exports the public API from all wallet service modules so that
 * external imports (e.g., `from '../services/wallet'`) continue to work
 * without any changes.
 */

// Types
export type { WalletRole, WalletAccessCheckResult, CreateWalletInput, WalletWithBalance } from './types';

// Access control
export {
  getUserWalletRole,
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletAccessWithRole,
} from './accessControl';

// Address generation
export { generateInitialAddresses, generateAddress } from './addressGeneration';

// Wallet creation
export { createWallet } from './walletCreate';

// Wallet queries
export { getUserWallets, getWalletById, getWalletStats } from './walletQueries';

// Wallet mutations
export { updateWallet, deleteWallet } from './walletMutations';

// Wallet device operations
export { addDeviceToWallet, repairWalletDescriptor } from './walletDevices';
