/**
 * Wallet Sharing Repository
 *
 * Abstracts database operations for wallet access/sharing.
 */

import prisma from '../models/prisma';
import type { WalletUser, GroupMember } from '@prisma/client';

type WalletRole = 'owner' | 'signer' | 'viewer';

/**
 * Find wallet user access record
 */
export async function findWalletUser(
  walletId: string,
  userId: string
): Promise<WalletUser | null> {
  return prisma.walletUser.findFirst({
    where: { walletId, userId },
  });
}

/**
 * Add user to wallet
 */
export async function addUserToWallet(
  walletId: string,
  userId: string,
  role: WalletRole
): Promise<WalletUser> {
  return prisma.walletUser.create({
    data: { walletId, userId, role },
  });
}

/**
 * Update user's role in wallet
 */
export async function updateUserRole(
  walletUserId: string,
  role: WalletRole
): Promise<WalletUser> {
  return prisma.walletUser.update({
    where: { id: walletUserId },
    data: { role },
  });
}

/**
 * Remove user from wallet
 */
export async function removeUserFromWallet(walletUserId: string): Promise<void> {
  await prisma.walletUser.delete({
    where: { id: walletUserId },
  });
}

/**
 * Check if user is member of group
 */
export async function isGroupMember(
  groupId: string,
  userId: string
): Promise<boolean> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId },
  });
  return member !== null;
}

/**
 * Get group member record
 */
export async function getGroupMember(
  groupId: string,
  userId: string
): Promise<GroupMember | null> {
  return prisma.groupMember.findFirst({
    where: { groupId, userId },
  });
}

/**
 * Update wallet's group assignment
 */
export async function updateWalletGroup(
  walletId: string,
  groupId: string | null,
  groupRole: string = 'viewer'
): Promise<void> {
  await prisma.wallet.update({
    where: { id: walletId },
    data: {
      groupId: groupId || null,
      groupRole: groupId ? groupRole : 'viewer',
    },
  });
}

/**
 * Get wallet with sharing info
 */
export async function getWalletSharingInfo(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      group: true,
      users: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      },
    },
  });
}

// Export as namespace
export const walletSharingRepository = {
  findWalletUser,
  addUserToWallet,
  updateUserRole,
  removeUserFromWallet,
  isGroupMember,
  getGroupMember,
  updateWalletGroup,
  getWalletSharingInfo,
};

export default walletSharingRepository;
