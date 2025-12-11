/**
 * Labels API
 *
 * API calls for label management on transactions and addresses
 */

import apiClient from './client';

export interface Label {
  id: string;
  walletId: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  transactionCount?: number;
  addressCount?: number;
}

export interface LabelWithItems extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: number;
    confirmations: number;
    blockTime?: string;
  }>;
  addresses: Array<{
    id: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>;
}

export interface CreateLabelRequest {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateLabelRequest {
  name?: string;
  color?: string;
  description?: string;
}

// ========================================
// LABEL CRUD OPERATIONS
// ========================================

/**
 * Get all labels for a wallet
 */
export async function getLabels(walletId: string): Promise<Label[]> {
  return apiClient.get<Label[]>(`/wallets/${walletId}/labels`);
}

/**
 * Get a specific label with associated transactions and addresses
 */
export async function getLabel(walletId: string, labelId: string): Promise<LabelWithItems> {
  return apiClient.get<LabelWithItems>(`/wallets/${walletId}/labels/${labelId}`);
}

/**
 * Create a new label
 */
export async function createLabel(walletId: string, data: CreateLabelRequest): Promise<Label> {
  return apiClient.post<Label>(`/wallets/${walletId}/labels`, data);
}

/**
 * Update an existing label
 */
export async function updateLabel(
  walletId: string,
  labelId: string,
  data: UpdateLabelRequest
): Promise<Label> {
  return apiClient.put<Label>(`/wallets/${walletId}/labels/${labelId}`, data);
}

/**
 * Delete a label
 */
export async function deleteLabel(walletId: string, labelId: string): Promise<void> {
  return apiClient.delete(`/wallets/${walletId}/labels/${labelId}`);
}

// ========================================
// TRANSACTION LABEL OPERATIONS
// ========================================

/**
 * Get labels for a transaction
 */
export async function getTransactionLabels(transactionId: string): Promise<Label[]> {
  return apiClient.get<Label[]>(`/transactions/${transactionId}/labels`);
}

/**
 * Add labels to a transaction
 */
export async function addTransactionLabels(
  transactionId: string,
  labelIds: string[]
): Promise<Label[]> {
  return apiClient.post<Label[]>(`/transactions/${transactionId}/labels`, { labelIds });
}

/**
 * Replace all labels on a transaction
 */
export async function setTransactionLabels(
  transactionId: string,
  labelIds: string[]
): Promise<Label[]> {
  return apiClient.put<Label[]>(`/transactions/${transactionId}/labels`, { labelIds });
}

/**
 * Remove a label from a transaction
 */
export async function removeTransactionLabel(
  transactionId: string,
  labelId: string
): Promise<void> {
  return apiClient.delete(`/transactions/${transactionId}/labels/${labelId}`);
}

// ========================================
// ADDRESS LABEL OPERATIONS
// ========================================

/**
 * Get labels for an address
 */
export async function getAddressLabels(addressId: string): Promise<Label[]> {
  return apiClient.get<Label[]>(`/addresses/${addressId}/labels`);
}

/**
 * Add labels to an address
 */
export async function addAddressLabels(
  addressId: string,
  labelIds: string[]
): Promise<Label[]> {
  return apiClient.post<Label[]>(`/addresses/${addressId}/labels`, { labelIds });
}

/**
 * Replace all labels on an address
 */
export async function setAddressLabels(
  addressId: string,
  labelIds: string[]
): Promise<Label[]> {
  return apiClient.put<Label[]>(`/addresses/${addressId}/labels`, { labelIds });
}

/**
 * Remove a label from an address
 */
export async function removeAddressLabel(
  addressId: string,
  labelId: string
): Promise<void> {
  return apiClient.delete(`/addresses/${addressId}/labels/${labelId}`);
}
