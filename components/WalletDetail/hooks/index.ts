/**
 * WalletDetail Custom Hooks
 *
 * Barrel file re-exporting all hooks extracted from WalletDetail.tsx.
 */

export { useWalletData } from './useWalletData';
export { useWalletSync } from './useWalletSync';
export { useWalletSharing } from './useWalletSharing';
export { useAITransactionFilter } from './useAITransactionFilter';
export { useWalletWebSocket } from './useWalletWebSocket';

// Re-export types for convenience
export type { UseWalletDataParams, UseWalletDataReturn } from './useWalletData';
export type { UseWalletSyncParams, UseWalletSyncReturn } from './useWalletSync';
export type { UseWalletSharingParams, UseWalletSharingReturn } from './useWalletSharing';
export type { UseAITransactionFilterParams, UseAITransactionFilterReturn } from './useAITransactionFilter';
