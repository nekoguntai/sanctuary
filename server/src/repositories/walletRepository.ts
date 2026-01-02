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
} from './types';

/**
 * Build the access control WHERE clause for wallet queries
 * Checks if user has direct access or via group membership
 */
function buildAccessWhere(userId: string): Prisma.WalletWhereInput {
  return {
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  };
}

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
      ...buildAccessWhere(userId),
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
      ...buildAccessWhere(userId),
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
    where: buildAccessWhere(userId),
  });
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
      ...buildAccessWhere(userId),
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
      ...buildAccessWhere(userId),
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
      ...buildAccessWhere(userId),
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
      ...buildAccessWhere(userId),
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
 */
export async function findByIdWithDevices(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
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
