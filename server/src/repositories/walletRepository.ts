/**
 * Wallet Repository
 *
 * Abstracts database operations for wallets.
 * Provides centralized access patterns and query logic.
 */

import prisma from '../models/prisma';
import type { Wallet, Prisma } from '@prisma/client';
import type {
  NetworkType,
  WalletWithAddresses,
  WalletAccessFilter,
  WalletNetworkFilter,
  WalletSyncState,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from './types';
import { buildWalletAccessWhere } from './accessControl';

/**
 * Find a wallet by ID if user has access
 * Returns null if wallet doesn't exist or user lacks access
 */
export async function findByIdWithAccess(
  walletId: string,
  userId: string
): Promise<Wallet | null> {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
  });
}

/**
 * Find a wallet by ID with addresses included
 */
export async function findByIdWithAddresses(
  walletId: string,
  userId: string
): Promise<WalletWithAddresses | null> {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    include: {
      addresses: true,
    },
  });
}

/**
 * Find all wallets for a user
 */
export async function findByUserId(userId: string): Promise<Wallet[]> {
  return prisma.wallet.findMany({
    where: buildWalletAccessWhere(userId),
  });
}

/**
 * Find wallets for a user with cursor-based pagination
 * More efficient for large wallet collections
 */
export async function findByUserIdPaginated(
  userId: string,
  options: CursorPaginationOptions = {}
): Promise<CursorPaginatedResult<Wallet>> {
  const { limit = 50, cursor, direction = 'forward' } = options;
  const take = Math.min(limit, 200) + 1; // Fetch one extra to detect hasMore

  const wallets = await prisma.wallet.findMany({
    where: {
      ...buildWalletAccessWhere(userId),
      ...(cursor ? { id: direction === 'forward' ? { gt: cursor } : { lt: cursor } } : {}),
    },
    take,
    orderBy: { id: direction === 'forward' ? 'asc' : 'desc' },
  });

  const hasMore = wallets.length > limit;
  const items = wallets.slice(0, limit);

  // Reverse if paginating backward to maintain consistent order
  if (direction === 'backward') {
    items.reverse();
  }

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    hasMore,
  };
}

/**
 * Find all wallets for a user on a specific network
 */
export async function findByNetwork(
  userId: string,
  network: NetworkType
): Promise<Wallet[]> {
  return prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
  });
}

/**
 * Find wallets by network with sync status info
 */
export async function findByNetworkWithSyncStatus(
  userId: string,
  network: NetworkType
): Promise<Array<{ id: string; syncInProgress: boolean; lastSyncStatus: string | null; lastSyncedAt: Date | null }>> {
  return prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
    select: {
      id: true,
      syncInProgress: true,
      lastSyncStatus: true,
      lastSyncedAt: true,
    },
  });
}

/**
 * Get wallet IDs for a network
 */
export async function getIdsByNetwork(
  userId: string,
  network: NetworkType
): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
    select: { id: true },
  });
  return wallets.map(w => w.id);
}

/**
 * Update wallet sync state
 */
export async function updateSyncState(
  walletId: string,
  state: Partial<WalletSyncState>
): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: state,
  });
}

/**
 * Reset sync state for a wallet
 */
export async function resetSyncState(walletId: string): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: {
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncStatus: null,
    },
  });
}

/**
 * Update wallet
 */
export async function update(
  walletId: string,
  data: Prisma.WalletUpdateInput
): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data,
  });
}

/**
 * Check if user has access to wallet
 */
export async function hasAccess(walletId: string, userId: string): Promise<boolean> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    select: { id: true },
  });
  return wallet !== null;
}

/**
 * Find wallet by ID (no access check - for internal use only)
 */
export async function findById(walletId: string): Promise<Wallet | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
  });
}

/**
 * Get wallet name
 */
export async function getName(walletId: string): Promise<string | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { name: true },
  });
  return wallet?.name ?? null;
}

/**
 * Find wallet with group info
 */
export async function findByIdWithGroup(walletId: string): Promise<(Wallet & { group: { name: string } | null }) | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: { group: true },
  });
}

/**
 * Find wallet with devices for export
 * Includes device accounts to properly select derivation paths for wallet type
 */
export async function findByIdWithDevices(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: {
            include: {
              accounts: true,
            },
          },
        },
        orderBy: { signerIndex: 'asc' },
      },
    },
  });
}

// Export all functions as a namespace for convenient importing
export const walletRepository = {
  findByIdWithAccess,
  findByIdWithAddresses,
  findByUserId,
  findByUserIdPaginated,
  findByNetwork,
  findByNetworkWithSyncStatus,
  getIdsByNetwork,
  updateSyncState,
  resetSyncState,
  update,
  hasAccess,
  findById,
  getName,
  findByIdWithGroup,
  findByIdWithDevices,
};

export default walletRepository;
