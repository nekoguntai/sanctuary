/**
 * Wallets API
 *
 * API calls for wallet management
 */

import apiClient from './client';

export interface Wallet {
  id: string;
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network: 'mainnet' | 'testnet' | 'regtest';
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  balance: number;
  deviceCount: number;
  addressCount: number;
  createdAt: string;
  // Sync metadata
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
  syncInProgress?: boolean;
}

export interface CreateWalletRequest {
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'regtest';
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[];
}

export interface UpdateWalletRequest {
  name?: string;
  descriptor?: string;
}

export interface WalletStats {
  balance: number;
  received: number;
  sent: number;
  transactionCount: number;
  utxoCount: number;
  addressCount: number;
}

export interface GenerateAddressResponse {
  address: string;
}

export interface AddDeviceToWalletRequest {
  deviceId: string;
  signerIndex?: number;
}

/**
 * Get all wallets for current user
 */
export async function getWallets(): Promise<Wallet[]> {
  return apiClient.get<Wallet[]>('/wallets');
}

/**
 * Get a specific wallet by ID
 */
export async function getWallet(walletId: string): Promise<Wallet> {
  return apiClient.get<Wallet>(`/wallets/${walletId}`);
}

/**
 * Create a new wallet
 */
export async function createWallet(data: CreateWalletRequest): Promise<Wallet> {
  return apiClient.post<Wallet>('/wallets', data);
}

/**
 * Update a wallet
 */
export async function updateWallet(walletId: string, data: UpdateWalletRequest): Promise<Wallet> {
  return apiClient.patch<Wallet>(`/wallets/${walletId}`, data);
}

/**
 * Delete a wallet
 */
export async function deleteWallet(walletId: string): Promise<void> {
  return apiClient.delete<void>(`/wallets/${walletId}`);
}

/**
 * Get wallet statistics
 */
export async function getWalletStats(walletId: string): Promise<WalletStats> {
  return apiClient.get<WalletStats>(`/wallets/${walletId}/stats`);
}

/**
 * Generate a new receiving address
 */
export async function generateAddress(walletId: string): Promise<GenerateAddressResponse> {
  return apiClient.post<GenerateAddressResponse>(`/wallets/${walletId}/addresses`);
}

/**
 * Add a device to a wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  data: AddDeviceToWalletRequest
): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>(`/wallets/${walletId}/devices`, data);
}
