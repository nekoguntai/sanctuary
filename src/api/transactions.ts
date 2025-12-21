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

/**
 * Recent transaction with wallet info (from aggregate endpoint)
 */
export interface RecentTransaction extends Transaction {
  walletName?: string;
}

/**
 * Get recent transactions across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 */
export async function getRecentTransactions(limit: number = 10): Promise<RecentTransaction[]> {
  return apiClient.get<RecentTransaction[]>('/transactions/recent', { limit });
}

/**
 * Aggregated pending transaction with wallet info
 */
export interface AggregatedPendingTransaction {
  txid: string;
  walletId: string;
  walletName?: string;
  type: string;
  amount: number;
  fee: number;
  size: number;
  feeRate: number;
  createdAt: string;
}

/**
 * Get pending transactions across all wallets the user has access to
 * Used for mempool visualization showing user's transactions in the block queue
 */
export async function getAllPendingTransactions(): Promise<AggregatedPendingTransaction[]> {
  return apiClient.get<AggregatedPendingTransaction[]>('/transactions/pending');
}

/**
 * Chart data point for balance history
 */
export interface BalanceHistoryPoint {
  name: string;
  value: number;
}

/**
 * Timeframe options for balance history
 */
export type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

/**
 * Get balance history chart data across all wallets
 * This is an optimized aggregate endpoint that replaces N separate API calls
 */
export async function getBalanceHistory(
  timeframe: Timeframe,
  totalBalance: number
): Promise<BalanceHistoryPoint[]> {
  return apiClient.get<BalanceHistoryPoint[]>('/transactions/balance-history', {
    timeframe,
    totalBalance,
  });
}

// ========================================
// PRIVACY SCORING API
// ========================================

export interface PrivacyFactor {
  factor: string;
  impact: number;
  description: string;
}

export interface PrivacyScore {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  factors: PrivacyFactor[];
  warnings: string[];
}

export interface UtxoPrivacyInfo {
  utxoId: string;
  txid: string;
  vout: number;
  amount: number;
  address: string;
  score: PrivacyScore;
}

export interface WalletPrivacySummary {
  averageScore: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  utxoCount: number;
  addressReuseCount: number;
  roundAmountCount: number;
  clusterCount: number;
  recommendations: string[];
}

export interface WalletPrivacyResponse {
  utxos: UtxoPrivacyInfo[];
  summary: WalletPrivacySummary;
}

export interface SpendPrivacyAnalysis {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  linkedAddresses: number;
  warnings: string[];
}

/**
 * Get privacy analysis for all UTXOs in a wallet
 */
export async function getWalletPrivacy(walletId: string): Promise<WalletPrivacyResponse> {
  return apiClient.get<WalletPrivacyResponse>(`/wallets/${walletId}/privacy`);
}

/**
 * Get privacy score for a single UTXO
 */
export async function getUtxoPrivacy(utxoId: string): Promise<PrivacyScore> {
  return apiClient.get<PrivacyScore>(`/utxos/${utxoId}/privacy`);
}

/**
 * Analyze privacy impact of spending selected UTXOs together
 */
export async function analyzeSpendPrivacy(
  walletId: string,
  utxoIds: string[]
): Promise<SpendPrivacyAnalysis> {
  return apiClient.post<SpendPrivacyAnalysis>(`/wallets/${walletId}/privacy/spend-analysis`, {
    utxoIds,
  });
}

// ========================================
// UTXO SELECTION API
// ========================================

// Re-export from central types
export type { SelectionStrategy } from '../../types';

export interface SelectedUtxo {
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  blockHeight?: number;
}

export interface SelectionResult {
  selected: SelectedUtxo[];
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
  inputCount: number;
  strategy: SelectionStrategy;
  warnings: string[];
  privacyImpact?: {
    linkedAddresses: number;
    score: number;
  };
}

export interface SelectUtxosRequest {
  amount: number;
  feeRate: number;
  strategy?: SelectionStrategy;
  scriptType?: string;
}

export interface RecommendedStrategyResponse {
  strategy: SelectionStrategy;
  reason: string;
  utxoCount: number;
  feeRate: number;
}

/**
 * Select UTXOs for a transaction using specified strategy
 */
export async function selectUtxos(
  walletId: string,
  request: SelectUtxosRequest
): Promise<SelectionResult> {
  return apiClient.post<SelectionResult>(`/wallets/${walletId}/utxos/select`, request);
}

/**
 * Compare different UTXO selection strategies for a given amount
 */
export async function compareStrategies(
  walletId: string,
  amount: number,
  feeRate: number,
  scriptType?: string
): Promise<Record<SelectionStrategy, SelectionResult>> {
  return apiClient.post<Record<SelectionStrategy, SelectionResult>>(
    `/wallets/${walletId}/utxos/compare-strategies`,
    { amount, feeRate, scriptType }
  );
}

/**
 * Get recommended UTXO selection strategy based on context
 */
export async function getRecommendedStrategy(
  walletId: string,
  feeRate: number,
  prioritizePrivacy?: boolean
): Promise<RecommendedStrategyResponse> {
  const params: Record<string, string> = { feeRate: String(feeRate) };
  if (prioritizePrivacy) {
    params.prioritizePrivacy = 'true';
  }
  return apiClient.get<RecommendedStrategyResponse>(
    `/wallets/${walletId}/utxos/recommended-strategy`,
    params
  );
}
