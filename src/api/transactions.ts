/**
 * Transactions API
 *
 * API calls for transaction and UTXO management
 */

import apiClient, { API_BASE_URL } from './client';
import type { Label, Transaction, UTXO, Address, PendingTransaction } from '../types';

// Re-export types for backward compatibility
export type { Label, Transaction, UTXO, Address, PendingTransaction } from '../types';

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
  inputPaths?: string[];
}

export interface BroadcastTransactionRequest {
  signedPsbtBase64?: string; // Signed PSBT from Ledger or file upload
  rawTxHex?: string; // Raw transaction hex from Trezor (fully signed)
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
 * Get pending (unconfirmed) transactions for a wallet
 * Used for block queue visualization
 */
export async function getPendingTransactions(walletId: string): Promise<PendingTransaction[]> {
  return apiClient.get<PendingTransaction[]>(`/wallets/${walletId}/transactions/pending`);
}

/**
 * Transaction summary statistics
 */
export interface TransactionStats {
  totalCount: number;
  receivedCount: number;
  sentCount: number;
  consolidationCount: number;
  totalReceived: number;
  totalSent: number;
  totalFees: number;
  walletBalance: number;
}

/**
 * Get transaction summary statistics for a wallet
 * Returns counts and totals independent of pagination
 */
export async function getTransactionStats(walletId: string): Promise<TransactionStats> {
  return apiClient.get<TransactionStats>(`/wallets/${walletId}/transactions/stats`);
}

export interface ExportTransactionsOptions {
  format: 'csv' | 'json';
  startDate?: string;
  endDate?: string;
}

/**
 * Export transactions for a wallet
 * Downloads a CSV or JSON file
 */
export async function exportTransactions(
  walletId: string,
  walletName: string,
  options: ExportTransactionsOptions
): Promise<void> {
  const params = new URLSearchParams();
  params.set('format', options.format);
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);

  const response = await fetch(`${API_BASE_URL}/wallets/${walletId}/transactions/export?${params}`, {
    headers: {
      'Authorization': `Bearer ${apiClient.getToken()}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Export failed' }));
    throw new Error(error.message || 'Export failed');
  }

  // Get the blob and trigger download
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = walletName.replace(/[^a-zA-Z0-9]/g, '_');
  const extension = options.format === 'json' ? 'json' : 'csv';
  const filename = `${safeName}_transactions_${timestamp}.${extension}`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

/**
 * Batch transaction output
 */
export interface BatchTransactionOutput {
  address: string;
  amount: number;
  sendMax?: boolean;
}

export interface CreateBatchTransactionRequest {
  outputs: BatchTransactionOutput[];
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  label?: string;
  memo?: string;
}

export interface CreateBatchTransactionResponse {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  inputPaths?: string[];
  outputs: Array<{ address: string; amount: number }>;
}

/**
 * Create a batch transaction with multiple outputs
 */
export async function createBatchTransaction(
  walletId: string,
  data: CreateBatchTransactionRequest
): Promise<CreateBatchTransactionResponse> {
  return apiClient.post<CreateBatchTransactionResponse>(
    `/wallets/${walletId}/transactions/batch`,
    data
  );
}
