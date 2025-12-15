/**
 * Draft Transactions API
 *
 * API calls for managing draft transactions (saved, unsigned/partially signed PSBTs)
 */

import apiClient from './client';

export interface DraftTransaction {
  id: string;
  walletId: string;
  userId: string;

  // Transaction parameters
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds: string[];
  enableRBF: boolean;
  subtractFees: boolean;
  sendMax: boolean;

  // Labels
  label?: string;
  memo?: string;

  // PSBT data
  psbtBase64: string;
  signedPsbtBase64?: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount: number;
  inputPaths: string[];

  // Signing status
  status: 'unsigned' | 'partial' | 'signed';
  signedDeviceIds: string[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CreateDraftRequest {
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  label?: string;
  memo?: string;
  psbtBase64: string;
  fee?: number;
  totalInput?: number;
  totalOutput?: number;
  changeAmount?: number;
  changeAddress?: string;
  effectiveAmount?: number;
  inputPaths?: string[];
}

export interface UpdateDraftRequest {
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  status?: 'unsigned' | 'partial' | 'signed';
  label?: string;
  memo?: string;
}

/**
 * Get all draft transactions for a wallet
 */
export async function getDrafts(walletId: string): Promise<DraftTransaction[]> {
  return apiClient.get<DraftTransaction[]>(`/wallets/${walletId}/drafts`);
}

/**
 * Get a specific draft transaction
 */
export async function getDraft(walletId: string, draftId: string): Promise<DraftTransaction> {
  return apiClient.get<DraftTransaction>(`/wallets/${walletId}/drafts/${draftId}`);
}

/**
 * Create a new draft transaction
 */
export async function createDraft(walletId: string, data: CreateDraftRequest): Promise<DraftTransaction> {
  return apiClient.post<DraftTransaction>(`/wallets/${walletId}/drafts`, data);
}

/**
 * Update a draft transaction (e.g., add signature)
 */
export async function updateDraft(
  walletId: string,
  draftId: string,
  data: UpdateDraftRequest
): Promise<DraftTransaction> {
  return apiClient.patch<DraftTransaction>(`/wallets/${walletId}/drafts/${draftId}`, data);
}

/**
 * Delete a draft transaction
 */
export async function deleteDraft(walletId: string, draftId: string): Promise<void> {
  await apiClient.delete(`/wallets/${walletId}/drafts/${draftId}`);
}
