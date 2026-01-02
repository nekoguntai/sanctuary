/**
 * Access Control Service
 *
 * Centralized access control checks for all resources.
 * Provides consistent authorization patterns across the application.
 */

import prisma from '../models/prisma';
import { NotFoundError, ForbiddenError } from './errors';
import { createLogger } from '../utils/logger';

const log = createLogger('ACCESS');

// Roles that can edit wallet data (labels, memos, etc.)
const EDIT_ROLES = ['owner', 'signer'];

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

/**
 * Access check result for a wallet
 */
export interface WalletAccessResult {
  hasAccess: boolean;
  canEdit: boolean;
  role: WalletRole;
}

/**
 * Resource context for access checks
 */
export interface ResourceContext {
  walletId: string;
  role: WalletRole;
  canEdit: boolean;
}

/**
 * Build Prisma WHERE clause for wallet access via user or group
 */
export function buildWalletAccessWhere(userId: string) {
  return {
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  };
}

/**
 * Get user's role for a specific wallet
 * Returns the highest privilege role if user has multiple access paths
 */
export async function getUserWalletRole(walletId: string, userId: string): Promise<WalletRole> {
  // Check direct user access first
  const walletUser = await prisma.walletUser.findFirst({
    where: { walletId, userId },
  });

  if (walletUser) {
    return walletUser.role as WalletRole;
  }

  // Check group access
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      group: { members: { some: { userId } } },
    },
    select: { groupRole: true },
  });

  if (wallet) {
    return wallet.groupRole as WalletRole;
  }

  return null;
}

/**
 * Check wallet access and return detailed result
 */
export async function checkWalletAccess(walletId: string, userId: string): Promise<WalletAccessResult> {
  const role = await getUserWalletRole(walletId, userId);
  return {
    hasAccess: role !== null,
    canEdit: role !== null && EDIT_ROLES.includes(role),
    role,
  };
}

/**
 * Require wallet access - throws if no access
 */
export async function requireWalletAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new NotFoundError('Wallet');
  }
  return {
    walletId,
    role: access.role,
    canEdit: access.canEdit,
  };
}

/**
 * Require wallet edit access - throws if cannot edit
 */
export async function requireWalletEditAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new NotFoundError('Wallet');
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return {
    walletId,
    role: access.role,
    canEdit: true,
  };
}

/**
 * Require wallet owner access - throws if not owner
 */
export async function requireWalletOwnerAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new NotFoundError('Wallet');
  }
  if (access.role !== 'owner') {
    throw new ForbiddenError('Only the wallet owner can perform this action');
  }
  return {
    walletId,
    role: 'owner',
    canEdit: true,
  };
}

/**
 * Check transaction access via wallet
 */
export async function checkTransactionAccess(
  transactionId: string,
  userId: string
): Promise<{ hasAccess: boolean; canEdit: boolean; walletId: string | null }> {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      wallet: buildWalletAccessWhere(userId),
    },
    select: { walletId: true },
  });

  if (!transaction) {
    return { hasAccess: false, canEdit: false, walletId: null };
  }

  const access = await checkWalletAccess(transaction.walletId, userId);
  return {
    hasAccess: true,
    canEdit: access.canEdit,
    walletId: transaction.walletId,
  };
}

/**
 * Require transaction access - throws if no access
 */
export async function requireTransactionAccess(
  transactionId: string,
  userId: string
): Promise<{ walletId: string; canEdit: boolean }> {
  const access = await checkTransactionAccess(transactionId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Transaction');
  }
  return {
    walletId: access.walletId,
    canEdit: access.canEdit,
  };
}

/**
 * Require transaction edit access - throws if cannot edit
 */
export async function requireTransactionEditAccess(
  transactionId: string,
  userId: string
): Promise<{ walletId: string }> {
  const access = await checkTransactionAccess(transactionId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Transaction');
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return { walletId: access.walletId };
}

/**
 * Check address access via wallet
 */
export async function checkAddressAccess(
  addressId: string,
  userId: string
): Promise<{ hasAccess: boolean; canEdit: boolean; walletId: string | null }> {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      wallet: buildWalletAccessWhere(userId),
    },
    select: { walletId: true },
  });

  if (!address) {
    return { hasAccess: false, canEdit: false, walletId: null };
  }

  const access = await checkWalletAccess(address.walletId, userId);
  return {
    hasAccess: true,
    canEdit: access.canEdit,
    walletId: address.walletId,
  };
}

/**
 * Require address access - throws if no access
 */
export async function requireAddressAccess(
  addressId: string,
  userId: string
): Promise<{ walletId: string; canEdit: boolean }> {
  const access = await checkAddressAccess(addressId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Address');
  }
  return {
    walletId: access.walletId,
    canEdit: access.canEdit,
  };
}

/**
 * Require address edit access - throws if cannot edit
 */
export async function requireAddressEditAccess(
  addressId: string,
  userId: string
): Promise<{ walletId: string }> {
  const access = await checkAddressAccess(addressId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Address');
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return { walletId: access.walletId };
}

// Export as namespace
export const accessControlService = {
  buildWalletAccessWhere,
  getUserWalletRole,
  checkWalletAccess,
  requireWalletAccess,
  requireWalletEditAccess,
  requireWalletOwnerAccess,
  checkTransactionAccess,
  requireTransactionAccess,
  requireTransactionEditAccess,
  checkAddressAccess,
  requireAddressAccess,
  requireAddressEditAccess,
};

export default accessControlService;
