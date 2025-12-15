/**
 * API Module Index
 *
 * Central export point for all API modules
 */

export * as auth from './auth';
export * as wallets from './wallets';
export * as transactions from './transactions';
export * as labels from './labels';
export * as devices from './devices';
export * as bitcoin from './bitcoin';
export * as price from './price';
export * as drafts from './drafts';

export { default as apiClient, ApiError } from './client';
export type { ApiResponse } from './client';

// Re-export domain types from central location
export type {
  Label,
  LabelWithItems,
  Transaction,
  UTXO,
  Address,
  Device,
  HardwareDeviceModel,
  Wallet,
  WalletRole,
  FeeEstimates,
  BitcoinTransactionDetails,
  BlockHeader,
} from '../types';

// Re-export auth types
export type { User, AuthResponse } from './auth';

// Re-export request/response types from modules
export type { CreateWalletRequest } from './wallets';
export type { CreateLabelRequest, UpdateLabelRequest } from './labels';
export type { BitcoinStatus } from './bitcoin';
export type { AggregatedPrice, PriceSource } from './price';
export type { DraftTransaction, CreateDraftRequest, UpdateDraftRequest } from './drafts';
