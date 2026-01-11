/**
 * Mobile Permission Repository
 *
 * Abstracts database operations for mobile permissions.
 * Mobile permissions act as additional restrictions on top of wallet roles.
 */

import prisma from '../models/prisma';
import type { MobilePermission, Prisma } from '@prisma/client';

/**
 * Mobile permission capability fields (boolean flags)
 */
export type MobilePermissionCapability =
  | 'canViewBalance'
  | 'canViewTransactions'
  | 'canViewUtxos'
  | 'canCreateTransaction'
  | 'canBroadcast'
  | 'canSignPsbt'
  | 'canGenerateAddress'
  | 'canManageLabels'
  | 'canManageDevices'
  | 'canShareWallet'
  | 'canDeleteWallet';

/**
 * Create mobile permission input
 */
export interface CreateMobilePermissionInput {
  walletId: string;
  userId: string;
  canViewBalance?: boolean;
  canViewTransactions?: boolean;
  canViewUtxos?: boolean;
  canCreateTransaction?: boolean;
  canBroadcast?: boolean;
  canSignPsbt?: boolean;
  canGenerateAddress?: boolean;
  canManageLabels?: boolean;
  canManageDevices?: boolean;
  canShareWallet?: boolean;
  canDeleteWallet?: boolean;
  ownerMaxPermissions?: Record<string, boolean>;
  lastModifiedBy?: string;
}

/**
 * Update mobile permission input
 */
export interface UpdateMobilePermissionInput {
  canViewBalance?: boolean;
  canViewTransactions?: boolean;
  canViewUtxos?: boolean;
  canCreateTransaction?: boolean;
  canBroadcast?: boolean;
  canSignPsbt?: boolean;
  canGenerateAddress?: boolean;
  canManageLabels?: boolean;
  canManageDevices?: boolean;
  canShareWallet?: boolean;
  canDeleteWallet?: boolean;
  ownerMaxPermissions?: Record<string, boolean> | null;
  lastModifiedBy?: string;
}

/**
 * Find mobile permission by ID
 */
export async function findById(id: string): Promise<MobilePermission | null> {
  return prisma.mobilePermission.findUnique({
    where: { id },
  });
}

/**
 * Find mobile permission for a specific user and wallet
 */
export async function findByWalletAndUser(
  walletId: string,
  userId: string
): Promise<MobilePermission | null> {
  return prisma.mobilePermission.findUnique({
    where: {
      walletId_userId: { walletId, userId },
    },
  });
}

/**
 * Find all mobile permissions for a user
 */
export async function findByUserId(userId: string): Promise<MobilePermission[]> {
  return prisma.mobilePermission.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all mobile permissions for a wallet
 */
export async function findByWalletId(walletId: string): Promise<MobilePermission[]> {
  return prisma.mobilePermission.findMany({
    where: { walletId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all mobile permissions for a user with wallet details and role
 * Includes the user's wallet role to avoid N+1 queries
 */
export async function findByUserIdWithWallet(userId: string) {
  return prisma.mobilePermission.findMany({
    where: { userId },
    include: {
      wallet: {
        select: {
          id: true,
          name: true,
          type: true,
          network: true,
          walletUsers: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find mobile permissions for multiple users in a wallet (batch query)
 * Used by getWalletPermissions to avoid N+1 queries
 */
export async function findByWalletIdAndUserIds(
  walletId: string,
  userIds: string[]
): Promise<Map<string, MobilePermission>> {
  const permissions = await prisma.mobilePermission.findMany({
    where: {
      walletId,
      userId: { in: userIds },
    },
  });

  // Return as a Map for O(1) lookup
  return new Map(permissions.map((p) => [p.userId, p]));
}

/**
 * Create a new mobile permission
 */
export async function create(input: CreateMobilePermissionInput): Promise<MobilePermission> {
  return prisma.mobilePermission.create({
    data: {
      walletId: input.walletId,
      userId: input.userId,
      canViewBalance: input.canViewBalance,
      canViewTransactions: input.canViewTransactions,
      canViewUtxos: input.canViewUtxos,
      canCreateTransaction: input.canCreateTransaction,
      canBroadcast: input.canBroadcast,
      canSignPsbt: input.canSignPsbt,
      canGenerateAddress: input.canGenerateAddress,
      canManageLabels: input.canManageLabels,
      canManageDevices: input.canManageDevices,
      canShareWallet: input.canShareWallet,
      canDeleteWallet: input.canDeleteWallet,
      ownerMaxPermissions: input.ownerMaxPermissions as Prisma.InputJsonValue,
      lastModifiedBy: input.lastModifiedBy,
    },
  });
}

/**
 * Create or update a mobile permission (upsert)
 */
export async function upsert(
  walletId: string,
  userId: string,
  input: UpdateMobilePermissionInput
): Promise<MobilePermission> {
  return prisma.mobilePermission.upsert({
    where: {
      walletId_userId: { walletId, userId },
    },
    update: {
      ...input,
      ownerMaxPermissions: input.ownerMaxPermissions as Prisma.InputJsonValue,
    },
    create: {
      walletId,
      userId,
      ...input,
      ownerMaxPermissions: input.ownerMaxPermissions as Prisma.InputJsonValue,
    },
  });
}

/**
 * Update a mobile permission by ID
 */
export async function updateById(
  id: string,
  input: UpdateMobilePermissionInput
): Promise<MobilePermission> {
  return prisma.mobilePermission.update({
    where: { id },
    data: {
      ...input,
      ownerMaxPermissions: input.ownerMaxPermissions as Prisma.InputJsonValue,
    },
  });
}

/**
 * Update a mobile permission by wallet and user
 */
export async function updateByWalletAndUser(
  walletId: string,
  userId: string,
  input: UpdateMobilePermissionInput
): Promise<MobilePermission> {
  return prisma.mobilePermission.update({
    where: {
      walletId_userId: { walletId, userId },
    },
    data: {
      ...input,
      ownerMaxPermissions: input.ownerMaxPermissions as Prisma.InputJsonValue,
    },
  });
}

/**
 * Delete a mobile permission by ID
 */
export async function deleteById(id: string): Promise<void> {
  await prisma.mobilePermission.delete({
    where: { id },
  });
}

/**
 * Delete a mobile permission by wallet and user
 */
export async function deleteByWalletAndUser(walletId: string, userId: string): Promise<void> {
  await prisma.mobilePermission.delete({
    where: {
      walletId_userId: { walletId, userId },
    },
  });
}

/**
 * Delete all mobile permissions for a user
 */
export async function deleteByUserId(userId: string): Promise<number> {
  const result = await prisma.mobilePermission.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete all mobile permissions for a wallet
 */
export async function deleteByWalletId(walletId: string): Promise<number> {
  const result = await prisma.mobilePermission.deleteMany({
    where: { walletId },
  });
  return result.count;
}

/**
 * Count mobile permissions for a wallet
 */
export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.mobilePermission.count({
    where: { walletId },
  });
}

// Export as namespace
export const mobilePermissionRepository = {
  findById,
  findByWalletAndUser,
  findByUserId,
  findByWalletId,
  findByUserIdWithWallet,
  findByWalletIdAndUserIds,
  create,
  upsert,
  updateById,
  updateByWalletAndUser,
  deleteById,
  deleteByWalletAndUser,
  deleteByUserId,
  deleteByWalletId,
  countByWalletId,
};

export default mobilePermissionRepository;
