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

export { default as apiClient, ApiError } from './client';
export type { ApiResponse } from './client';

// Re-export commonly used types
export type { User, AuthResponse } from './auth';
export type { Wallet, CreateWalletRequest } from './wallets';
export type { Transaction, UTXO, Address, Label } from './transactions';
export type { Label as LabelFull, LabelWithItems, CreateLabelRequest, UpdateLabelRequest } from './labels';
export type { Device } from './devices';
export type { BitcoinStatus, FeeEstimates } from './bitcoin';
export type { AggregatedPrice, PriceSource } from './price';
