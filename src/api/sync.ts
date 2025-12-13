/**
 * Sync API
 *
 * API calls for wallet synchronization management
 */

import apiClient from './client';

export interface SyncStatus {
  lastSyncedAt: string | null;
  syncStatus: string | null;
  syncInProgress: boolean;
  isStale: boolean;
  queuePosition: number | null;
}

export interface SyncResult {
  success: boolean;
  syncedAddresses: number;
  newTransactions: number;
  newUtxos: number;
  error?: string;
}

export interface QueueResult {
  queued: boolean;
  queuePosition: number | null;
  syncInProgress: boolean;
}

/**
 * Trigger immediate sync for a wallet
 */
export async function syncWallet(walletId: string): Promise<SyncResult> {
  return apiClient.post<SyncResult>(`/sync/wallet/${walletId}`);
}

/**
 * Queue a wallet for background sync
 */
export async function queueSync(
  walletId: string,
  priority: 'high' | 'normal' | 'low' = 'normal'
): Promise<QueueResult> {
  return apiClient.post<QueueResult>(`/sync/queue/${walletId}`, { priority });
}

/**
 * Get sync status for a wallet
 */
export async function getSyncStatus(walletId: string): Promise<SyncStatus> {
  return apiClient.get<SyncStatus>(`/sync/status/${walletId}`);
}

/**
 * Queue all user's wallets for background sync
 * Call this on login or page load
 */
export async function queueUserWallets(
  priority: 'high' | 'normal' | 'low' = 'normal'
): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/sync/user', { priority });
}

export interface ResyncResult {
  success: boolean;
  message: string;
  deletedTransactions: number;
}

/**
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
export async function resyncWallet(walletId: string): Promise<ResyncResult> {
  return apiClient.post<ResyncResult>(`/sync/resync/${walletId}`);
}
