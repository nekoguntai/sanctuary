/**
 * Repository Types
 *
 * Common interfaces for repository pattern implementation.
 */

import type { Wallet, Address, Transaction, User, UTXO, Prisma } from '@prisma/client';

// Re-export Prisma types that repositories use
export type { Wallet, Address, Transaction, User, UTXO };

// Network type from schema
export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';

// Wallet with includes
export interface WalletWithAddresses extends Wallet {
  addresses: Address[];
}

export interface WalletWithUsers extends Wallet {
  users: { userId: string }[];
  group?: { members: { userId: string }[] } | null;
}

// Pagination options
export interface PaginationOptions {
  skip?: number;
  take?: number;
}

// Sort options
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// Generic repository interface
export interface BaseRepository<T, CreateInput, UpdateInput> {
  findById(id: string): Promise<T | null>;
  create(data: CreateInput): Promise<T>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// Wallet repository specific types
export interface WalletAccessFilter {
  walletId: string;
  userId: string;
}

export interface WalletNetworkFilter {
  userId: string;
  network: NetworkType;
}

export interface WalletSyncState {
  syncInProgress: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
}

// Transaction repository specific types
export interface TransactionFilter {
  walletId?: string;
  walletIds?: string[];
  confirmed?: boolean;
  type?: 'send' | 'receive';
}

// Address repository specific types
export interface AddressFilter {
  walletId: string;
  used?: boolean;
}
