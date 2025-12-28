/**
 * Repository Layer
 *
 * Centralized exports for all repository modules.
 * This provides a clean abstraction layer over direct Prisma usage.
 *
 * Usage:
 *   import { walletRepository, transactionRepository } from '../repositories';
 *
 *   // Check wallet access
 *   const wallet = await walletRepository.findByIdWithAccess(walletId, userId);
 *
 *   // Delete transactions
 *   const count = await transactionRepository.deleteByWalletId(walletId);
 */

export { walletRepository, default as walletRepo } from './walletRepository';
export { transactionRepository, default as transactionRepo } from './transactionRepository';
export { addressRepository, default as addressRepo } from './addressRepository';
export { utxoRepository, default as utxoRepo } from './utxoRepository';
export { userRepository, default as userRepo } from './userRepository';
export { walletSharingRepository, default as walletSharingRepo } from './walletSharingRepository';

// Re-export types
export type {
  NetworkType,
  WalletWithAddresses,
  WalletAccessFilter,
  WalletNetworkFilter,
  WalletSyncState,
  TransactionFilter,
  AddressFilter,
} from './types';
