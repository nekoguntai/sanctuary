/**
 * Ownership Transfer Service
 *
 * Handles secure 3-step ownership transfers for wallets and devices:
 * 1. Owner initiates transfer
 * 2. Recipient accepts (or declines)
 * 3. Owner confirms to complete
 *
 * Owner can cancel at any point before final confirmation.
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { checkWalletOwnerAccess } from './wallet';
import { checkDeviceOwnerAccess } from './deviceAccess';

const log = createLogger('TRANSFER');

// ========================================
// TYPES
// ========================================

export type TransferStatus = 'pending' | 'accepted' | 'confirmed' | 'cancelled' | 'declined' | 'expired';
export type ResourceType = 'wallet' | 'device';

export interface Transfer {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  fromUserId: string;
  toUserId: string;
  status: TransferStatus;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date;
  message: string | null;
  declineReason: string | null;
  keepExistingUsers: boolean;
  fromUser?: { id: string; username: string };
  toUser?: { id: string; username: string };
  resourceName?: string;
}

export interface InitiateTransferInput {
  resourceType: ResourceType;
  resourceId: string;
  toUserId: string;
  message?: string;
  keepExistingUsers?: boolean;
  expiresInDays?: number;
}

export interface TransferFilters {
  role?: 'initiator' | 'recipient' | 'all';
  status?: TransferStatus | 'active' | 'all';
  resourceType?: ResourceType;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

/**
 * Calculate expiry date from now
 */
function calculateExpiryDate(days: number = DEFAULT_EXPIRY_DAYS): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Math.min(days, MAX_EXPIRY_DAYS));
  return expiry;
}

/**
 * Check if a transfer has expired
 */
function isExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Get resource name for display
 */
async function getResourceName(resourceType: ResourceType, resourceId: string): Promise<string> {
  if (resourceType === 'wallet') {
    const wallet = await prisma.wallet.findUnique({
      where: { id: resourceId },
      select: { name: true },
    });
    return wallet?.name || 'Unknown Wallet';
  } else {
    const device = await prisma.device.findUnique({
      where: { id: resourceId },
      select: { label: true },
    });
    return device?.label || 'Unknown Device';
  }
}

/**
 * Check if user owns the resource
 */
async function checkResourceOwnership(
  resourceType: ResourceType,
  resourceId: string,
  userId: string
): Promise<boolean> {
  if (resourceType === 'wallet') {
    return checkWalletOwnerAccess(resourceId, userId);
  } else {
    return checkDeviceOwnerAccess(resourceId, userId);
  }
}

/**
 * Format transfer for response (include user info and resource name)
 */
async function formatTransfer(transfer: any): Promise<Transfer> {
  const resourceName = await getResourceName(transfer.resourceType, transfer.resourceId);
  return {
    ...transfer,
    resourceName,
    fromUser: transfer.fromUser ? {
      id: transfer.fromUser.id,
      username: transfer.fromUser.username,
    } : undefined,
    toUser: transfer.toUser ? {
      id: transfer.toUser.id,
      username: transfer.toUser.username,
    } : undefined,
  };
}

// ========================================
// CORE FUNCTIONS
// ========================================

/**
 * Initiate an ownership transfer
 */
export async function initiateTransfer(
  ownerId: string,
  input: InitiateTransferInput
): Promise<Transfer> {
  const { resourceType, resourceId, toUserId, message, keepExistingUsers = true, expiresInDays } = input;

  // Validation: can't transfer to yourself
  if (ownerId === toUserId) {
    throw new Error('Cannot transfer ownership to yourself');
  }

  // Validation: check target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, username: true },
  });
  if (!targetUser) {
    throw new Error('Target user not found');
  }

  // Validation: check ownership
  const isOwner = await checkResourceOwnership(resourceType, resourceId, ownerId);
  if (!isOwner) {
    throw new Error(`You are not the owner of this ${resourceType}`);
  }

  // Validation: check no active transfer exists for this resource
  const activeTransfer = await hasActiveTransfer(resourceType, resourceId);
  if (activeTransfer) {
    throw new Error(`This ${resourceType} already has a pending transfer`);
  }

  // Validation: check target user is not already owner
  const targetIsOwner = await checkResourceOwnership(resourceType, resourceId, toUserId);
  if (targetIsOwner) {
    throw new Error('Target user is already an owner of this resource');
  }

  // Create transfer record
  const transfer = await prisma.ownershipTransfer.create({
    data: {
      resourceType,
      resourceId,
      fromUserId: ownerId,
      toUserId,
      status: 'pending',
      message: message || null,
      keepExistingUsers,
      expiresAt: calculateExpiryDate(expiresInDays),
    },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  log.info('Transfer initiated', {
    transferId: transfer.id,
    resourceType,
    resourceId,
    from: ownerId,
    to: toUserId,
  });

  return formatTransfer(transfer);
}

/**
 * Accept a pending transfer (recipient action)
 */
export async function acceptTransfer(
  recipientId: string,
  transferId: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!transfer) {
    throw new Error('Transfer not found');
  }

  // Validation: only recipient can accept
  if (transfer.toUserId !== recipientId) {
    throw new Error('Only the recipient can accept this transfer');
  }

  // Validation: must be pending
  if (transfer.status !== 'pending') {
    throw new Error(`Transfer cannot be accepted (current status: ${transfer.status})`);
  }

  // Validation: not expired
  if (isExpired(transfer.expiresAt)) {
    // Mark as expired
    await prisma.ownershipTransfer.update({
      where: { id: transferId },
      data: { status: 'expired' },
    });
    throw new Error('Transfer has expired');
  }

  // Update status
  const updated = await prisma.ownershipTransfer.update({
    where: { id: transferId },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
    },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  log.info('Transfer accepted', {
    transferId,
    by: recipientId,
  });

  return formatTransfer(updated);
}

/**
 * Decline a pending transfer (recipient action)
 */
export async function declineTransfer(
  recipientId: string,
  transferId: string,
  reason?: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new Error('Transfer not found');
  }

  // Validation: only recipient can decline
  if (transfer.toUserId !== recipientId) {
    throw new Error('Only the recipient can decline this transfer');
  }

  // Validation: must be pending
  if (transfer.status !== 'pending') {
    throw new Error(`Transfer cannot be declined (current status: ${transfer.status})`);
  }

  // Update status
  const updated = await prisma.ownershipTransfer.update({
    where: { id: transferId },
    data: {
      status: 'declined',
      declineReason: reason || null,
      cancelledAt: new Date(),
    },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  log.info('Transfer declined', {
    transferId,
    by: recipientId,
    reason,
  });

  return formatTransfer(updated);
}

/**
 * Cancel a transfer (owner action)
 * Can cancel from pending or accepted state
 */
export async function cancelTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new Error('Transfer not found');
  }

  // Validation: only owner can cancel
  if (transfer.fromUserId !== ownerId) {
    throw new Error('Only the transfer initiator can cancel');
  }

  // Validation: must be pending or accepted
  if (transfer.status !== 'pending' && transfer.status !== 'accepted') {
    throw new Error(`Transfer cannot be cancelled (current status: ${transfer.status})`);
  }

  // Update status
  const updated = await prisma.ownershipTransfer.update({
    where: { id: transferId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
    },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  log.info('Transfer cancelled', {
    transferId,
    by: ownerId,
  });

  return formatTransfer(updated);
}

/**
 * Confirm and execute transfer (owner action)
 * This is the final step that actually transfers ownership
 */
export async function confirmTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!transfer) {
    throw new Error('Transfer not found');
  }

  // Validation: only owner can confirm
  if (transfer.fromUserId !== ownerId) {
    throw new Error('Only the transfer initiator can confirm');
  }

  // Validation: must be accepted
  if (transfer.status !== 'accepted') {
    throw new Error(`Transfer cannot be confirmed (current status: ${transfer.status})`);
  }

  // Validation: not expired
  if (isExpired(transfer.expiresAt)) {
    await prisma.ownershipTransfer.update({
      where: { id: transferId },
      data: { status: 'expired' },
    });
    throw new Error('Transfer has expired');
  }

  // Validation: owner still owns the resource
  const stillOwns = await checkResourceOwnership(
    transfer.resourceType as ResourceType,
    transfer.resourceId,
    ownerId
  );
  if (!stillOwns) {
    throw new Error('You no longer own this resource');
  }

  // Execute the transfer in a transaction
  if (transfer.resourceType === 'wallet') {
    await executeWalletTransfer(transfer);
  } else {
    await executeDeviceTransfer(transfer);
  }

  // Fetch updated transfer
  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  log.info('Transfer confirmed and executed', {
    transferId,
    resourceType: transfer.resourceType,
    resourceId: transfer.resourceId,
    from: transfer.fromUserId,
    to: transfer.toUserId,
  });

  return formatTransfer(updated);
}

/**
 * Execute wallet ownership transfer
 */
async function executeWalletTransfer(transfer: any): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const walletId = transfer.resourceId;

    // 1. Find current owner's WalletUser record
    const currentOwner = await tx.walletUser.findFirst({
      where: { walletId, userId: transfer.fromUserId, role: 'owner' },
    });

    if (!currentOwner) {
      throw new Error('Transfer failed: owner no longer owns this wallet');
    }

    // 2. Check if recipient already has access
    const recipientAccess = await tx.walletUser.findFirst({
      where: { walletId, userId: transfer.toUserId },
    });

    if (recipientAccess) {
      // Upgrade existing access to owner
      await tx.walletUser.update({
        where: { id: recipientAccess.id },
        data: { role: 'owner' },
      });
    } else {
      // Create new owner access
      await tx.walletUser.create({
        data: {
          walletId,
          userId: transfer.toUserId,
          role: 'owner',
        },
      });
    }

    // 3. Handle previous owner based on keepExistingUsers flag
    if (transfer.keepExistingUsers) {
      // Downgrade to viewer
      await tx.walletUser.update({
        where: { id: currentOwner.id },
        data: { role: 'viewer' },
      });
    } else {
      // Remove access entirely
      await tx.walletUser.delete({
        where: { id: currentOwner.id },
      });
    }

    // 4. Update transfer status
    await tx.ownershipTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });
  });
}

/**
 * Execute device ownership transfer
 */
async function executeDeviceTransfer(transfer: any): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deviceId = transfer.resourceId;

    // 1. Find current owner's DeviceUser record
    const currentOwner = await tx.deviceUser.findFirst({
      where: { deviceId, userId: transfer.fromUserId, role: 'owner' },
    });

    if (!currentOwner) {
      throw new Error('Transfer failed: owner no longer owns this device');
    }

    // 2. Update Device.userId (legacy field for backward compatibility)
    await tx.device.update({
      where: { id: deviceId },
      data: { userId: transfer.toUserId },
    });

    // 3. Handle recipient access
    const recipientAccess = await tx.deviceUser.findFirst({
      where: { deviceId, userId: transfer.toUserId },
    });

    if (recipientAccess) {
      await tx.deviceUser.update({
        where: { id: recipientAccess.id },
        data: { role: 'owner' },
      });
    } else {
      await tx.deviceUser.create({
        data: {
          deviceId,
          userId: transfer.toUserId,
          role: 'owner',
        },
      });
    }

    // 4. Handle previous owner
    if (transfer.keepExistingUsers) {
      await tx.deviceUser.update({
        where: { id: currentOwner.id },
        data: { role: 'viewer' },
      });
    } else {
      await tx.deviceUser.delete({
        where: { id: currentOwner.id },
      });
    }

    // 5. Update transfer status
    await tx.ownershipTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });
  });
}

// ========================================
// QUERY FUNCTIONS
// ========================================

/**
 * Get transfers for a user
 */
export async function getUserTransfers(
  userId: string,
  filters: TransferFilters = {}
): Promise<{ transfers: Transfer[]; total: number }> {
  const { role = 'all', status = 'all', resourceType } = filters;

  // Build where clause
  const where: any = {};

  // Role filter
  if (role === 'initiator') {
    where.fromUserId = userId;
  } else if (role === 'recipient') {
    where.toUserId = userId;
  } else {
    where.OR = [{ fromUserId: userId }, { toUserId: userId }];
  }

  // Status filter
  if (status === 'active') {
    where.status = { in: ['pending', 'accepted'] };
  } else if (status !== 'all') {
    where.status = status;
  }

  // Resource type filter
  if (resourceType) {
    where.resourceType = resourceType;
  }

  const [transfers, total] = await Promise.all([
    prisma.ownershipTransfer.findMany({
      where,
      include: {
        fromUser: { select: { id: true, username: true } },
        toUser: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ownershipTransfer.count({ where }),
  ]);

  // Format all transfers
  const formatted = await Promise.all(transfers.map(formatTransfer));

  return { transfers: formatted, total };
}

/**
 * Get a single transfer by ID
 */
export async function getTransfer(transferId: string): Promise<Transfer | null> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!transfer) {
    return null;
  }

  return formatTransfer(transfer);
}

/**
 * Check if resource has an active transfer
 */
export async function hasActiveTransfer(
  resourceType: ResourceType,
  resourceId: string
): Promise<boolean> {
  const count = await prisma.ownershipTransfer.count({
    where: {
      resourceType,
      resourceId,
      status: { in: ['pending', 'accepted'] },
    },
  });
  return count > 0;
}

/**
 * Get pending incoming transfers count for a user
 */
export async function getPendingIncomingCount(userId: string): Promise<number> {
  return prisma.ownershipTransfer.count({
    where: {
      toUserId: userId,
      status: 'pending',
    },
  });
}

/**
 * Get transfers requiring owner confirmation
 */
export async function getAwaitingConfirmationCount(userId: string): Promise<number> {
  return prisma.ownershipTransfer.count({
    where: {
      fromUserId: userId,
      status: 'accepted',
    },
  });
}

// ========================================
// MAINTENANCE FUNCTIONS
// ========================================

/**
 * Expire old transfers (called by maintenance job)
 */
export async function expireOldTransfers(): Promise<number> {
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      status: { in: ['pending', 'accepted'] },
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'expired',
    },
  });

  if (result.count > 0) {
    log.info('Expired stale transfers', { count: result.count });
  }

  return result.count;
}
