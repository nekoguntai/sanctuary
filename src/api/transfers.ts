/**
 * Transfers API
 *
 * API calls for ownership transfer management
 */

import apiClient from './client';
import type {
  Transfer,
  TransferFilters,
  TransferCounts,
  TransferResourceType,
} from '../types';

// Re-export types for convenience
export type {
  Transfer,
  TransferFilters,
  TransferCounts,
  TransferResourceType,
} from '../types';

export interface InitiateTransferRequest {
  resourceType: TransferResourceType;
  resourceId: string;
  toUserId: string;
  message?: string;
  keepExistingUsers?: boolean;
  expiresInDays?: number;
}

export interface DeclineTransferRequest {
  reason?: string;
}

export interface TransfersResponse {
  transfers: Transfer[];
  total: number;
}

// ========================================
// TRANSFER OPERATIONS
// ========================================

/**
 * Initiate an ownership transfer
 */
export async function initiateTransfer(data: InitiateTransferRequest): Promise<Transfer> {
  return apiClient.post<Transfer>('/transfers', data);
}

/**
 * Get all transfers for current user
 */
export async function getTransfers(filters?: TransferFilters): Promise<TransfersResponse> {
  const params: Record<string, string | undefined> = {};
  if (filters?.role) params.role = filters.role;
  if (filters?.status) params.status = filters.status;
  if (filters?.resourceType) params.resourceType = filters.resourceType;

  return apiClient.get<TransfersResponse>('/transfers', params);
}

/**
 * Get transfer counts for badge display
 */
export async function getTransferCounts(): Promise<TransferCounts> {
  return apiClient.get<TransferCounts>('/transfers/counts');
}

/**
 * Get a specific transfer by ID
 */
export async function getTransfer(transferId: string): Promise<Transfer> {
  return apiClient.get<Transfer>(`/transfers/${transferId}`);
}

/**
 * Accept a pending transfer (recipient action)
 */
export async function acceptTransfer(transferId: string): Promise<Transfer> {
  return apiClient.post<Transfer>(`/transfers/${transferId}/accept`);
}

/**
 * Decline a pending transfer (recipient action)
 */
export async function declineTransfer(
  transferId: string,
  data?: DeclineTransferRequest
): Promise<Transfer> {
  return apiClient.post<Transfer>(`/transfers/${transferId}/decline`, data);
}

/**
 * Cancel a transfer (owner action)
 */
export async function cancelTransfer(transferId: string): Promise<Transfer> {
  return apiClient.post<Transfer>(`/transfers/${transferId}/cancel`);
}

/**
 * Confirm and execute a transfer (owner action - final step)
 */
export async function confirmTransfer(transferId: string): Promise<Transfer> {
  return apiClient.post<Transfer>(`/transfers/${transferId}/confirm`);
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Check if a transfer is active (can still be acted upon)
 */
export function isTransferActive(transfer: Transfer): boolean {
  return transfer.status === 'pending' || transfer.status === 'accepted';
}

/**
 * Check if transfer can be accepted by recipient
 */
export function canAcceptTransfer(transfer: Transfer, userId: string): boolean {
  return transfer.status === 'pending' && transfer.toUserId === userId;
}

/**
 * Check if transfer can be confirmed by owner
 */
export function canConfirmTransfer(transfer: Transfer, userId: string): boolean {
  return transfer.status === 'accepted' && transfer.fromUserId === userId;
}

/**
 * Check if transfer can be cancelled by owner
 */
export function canCancelTransfer(transfer: Transfer, userId: string): boolean {
  return (
    (transfer.status === 'pending' || transfer.status === 'accepted') &&
    transfer.fromUserId === userId
  );
}

/**
 * Get status display info
 */
export function getTransferStatusInfo(status: string): {
  label: string;
  color: 'warning' | 'success' | 'error' | 'info';
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending Acceptance', color: 'warning' };
    case 'accepted':
      return { label: 'Awaiting Confirmation', color: 'info' };
    case 'confirmed':
      return { label: 'Completed', color: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'error' };
    case 'declined':
      return { label: 'Declined', color: 'error' };
    case 'expired':
      return { label: 'Expired', color: 'error' };
    default:
      return { label: status, color: 'info' };
  }
}
