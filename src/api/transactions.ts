/**
 * Transactions API
 *
 * API calls for transaction and UTXO management
 */

import apiClient from './client';
import type { Label, Transaction, UTXO, Address } from '../types';

// Re-export types for backward compatibility
export type { Label, Transaction, UTXO, Address } from '../types';

export interface GetTransactionsParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | string[] | undefined | null;
}

export interface GetUTXOsResponse {
  utxos: UTXO[];
  count: number;
  totalBalance: number;
}

export interface CreateTransactionRequest {
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  label?: string;
  memo?: string;
  sendMax?: boolean;
  subtractFees?: boolean;
}

export interface CreateTransactionResponse {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  effectiveAmount?: number;
}

export interface BroadcastTransactionRequest {
  signedPsbtBase64: string;
  recipient: string;
  amount: number;
  fee: number;
  label?: string;
  memo?: string;
  utxos: Array<{ txid: string; vout: number }>;
}

export interface BroadcastTransactionResponse {
  txid: string;
  broadcasted: boolean;
}

export interface EstimateTransactionRequest {
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds?: string[];
}

export interface EstimateTransactionResponse {
  fee: number;
  totalCost: number;
  inputCount: number;
  outputCount: number;
  changeAmount: number;
  sufficient: boolean;
  error?: string;
}

/**
 * Get transactions for a wallet
 */
export async function getTransactions(
  walletId: string,
  params?: GetTransactionsParams
): Promise<Transaction[]> {
  return apiClient.get<Transaction[]>(`/wallets/${walletId}/transactions`, params);
}

/**
 * Get a specific transaction by txid
 */
export async function getTransaction(txid: string): Promise<Transaction> {
  return apiClient.get<Transaction>(`/transactions/${txid}`);
}

/**
 * Get UTXOs for a wallet
 */
export async function getUTXOs(walletId: string): Promise<GetUTXOsResponse> {
  return apiClient.get<GetUTXOsResponse>(`/wallets/${walletId}/utxos`);
}

/**
 * Get addresses for a wallet
 */
export async function getAddresses(walletId: string, used?: boolean): Promise<Address[]> {
  const params = used !== undefined ? { used: String(used) } : undefined;
  return apiClient.get<Address[]>(`/wallets/${walletId}/addresses`, params);
}

/**
 * Generate more addresses for a wallet
 */
export async function generateAddresses(walletId: string, count: number = 10): Promise<{ generated: number }> {
  return apiClient.post<{ generated: number }>(`/wallets/${walletId}/addresses/generate`, { count });
}

/**
 * Create a transaction PSBT (for hardware wallet signing)
 */
export async function createTransaction(
  walletId: string,
  data: CreateTransactionRequest
): Promise<CreateTransactionResponse> {
  return apiClient.post<CreateTransactionResponse>(
    `/wallets/${walletId}/transactions/create`,
    data
  );
}

/**
 * Broadcast a signed transaction
 */
export async function broadcastTransaction(
  walletId: string,
  data: BroadcastTransactionRequest
): Promise<BroadcastTransactionResponse> {
  return apiClient.post<BroadcastTransactionResponse>(
    `/wallets/${walletId}/transactions/broadcast`,
    data
  );
}

/**
 * Estimate transaction cost
 */
export async function estimateTransaction(
  walletId: string,
  data: EstimateTransactionRequest
): Promise<EstimateTransactionResponse> {
  return apiClient.post<EstimateTransactionResponse>(
    `/wallets/${walletId}/transactions/estimate`,
    data
  );
}

export interface FreezeUTXOResponse {
  id: string;
  txid: string;
  vout: number;
  frozen: boolean;
  message: string;
}

/**
 * Toggle UTXO frozen status
 */
export async function freezeUTXO(utxoId: string, frozen: boolean): Promise<FreezeUTXOResponse> {
  return apiClient.patch<FreezeUTXOResponse>(`/utxos/${utxoId}/freeze`, { frozen });
}
