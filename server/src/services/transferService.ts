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

import { db as prisma } from '../repositories/db';
import type { Prisma, OwnershipTransfer } from '@prisma/client';
import { createLogger } from '../utils/logger';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError, UserNotFoundError } from '../errors';
import { checkWalletOwnerAccess } from './wallet';
import { checkDeviceOwnerAccess } from './deviceAccess';

/** Prisma transaction client type */
type PrismaTx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** OwnershipTransfer with user relations */
type TransferWithUsers = OwnershipTransfer & {
  fromUser?: { id: string; username: string } | null;
  toUser?: { id: string; username: string } | null;
};

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
async function formatTransfer(transfer: TransferWithUsers): Promise<Transfer> {
  const resourceType = transfer.resourceType as ResourceType;
  const resourceName = await getResourceName(resourceType, transfer.resourceId);
  return {
    ...transfer,
    resourceType,
    status: transfer.status as TransferStatus,
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
 * Uses transaction with serializable isolation to prevent race conditions
 */
export async function initiateTransfer(
  ownerId: string,
  input: InitiateTransferInput
): Promise<Transfer> {
  const { resourceType, resourceId, toUserId, message, keepExistingUsers = true, expiresInDays } = input;

  // Validation: can't transfer to yourself
  if (ownerId === toUserId) {
    throw new InvalidInputError('Cannot transfer ownership to yourself');
  }

  // Validation: check target user exists (this can be done outside transaction)
  const targetUser = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, username: true },
  });
  if (!targetUser) {
    throw new UserNotFoundError(toUserId);
  }

  // Use a transaction to ensure atomicity - prevents race condition where
  // two requests both pass the hasActiveTransfer check before either creates a transfer
  const transfer = await prisma.$transaction(async (tx) => {
    // Validation: check ownership
    const isOwner = await checkResourceOwnership(resourceType, resourceId, ownerId);
    if (!isOwner) {
      throw new ForbiddenError(`You are not the owner of this ${resourceType}`);
    }

    // Validation: check no active transfer exists for this resource
    // This check is inside the transaction to prevent TOCTOU race condition
    const activeTransferCount = await tx.ownershipTransfer.count({
      where: {
        resourceType,
        resourceId,
        status: { in: ['pending', 'accepted'] },
      },
    });
    if (activeTransferCount > 0) {
      throw new ConflictError(`This ${resourceType} already has a pending transfer`);
    }

    // Validation: check target user is not already owner
    const targetIsOwner = await checkResourceOwnership(resourceType, resourceId, toUserId);
    if (targetIsOwner) {
      throw new ConflictError('Target user is already an owner of this resource');
    }

    // Create transfer record - within the same transaction
    return tx.ownershipTransfer.create({
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
  }, {
    // Use serializable isolation to prevent concurrent transfers
    isolationLevel: 'Serializable',
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
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function acceptTransfer(
  recipientId: string,
  transferId: string
): Promise<Transfer> {
  // First check if transfer exists and get details for error messages
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can accept
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can accept this transfer');
  }

  // Check if already expired
  if (isExpired(transfer.expiresAt)) {
    // Mark as expired atomically
    await prisma.ownershipTransfer.updateMany({
      where: { id: transferId, status: { in: ['pending', 'accepted'] } },
      data: { status: 'expired' },
    });
    throw new InvalidInputError('Transfer has expired');
  }

  // Atomic update: only succeeds if status is still 'pending'
  // This prevents race conditions where two requests both try to accept
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      toUserId: recipientId,  // Ensure recipient check is also atomic
      status: 'pending',      // Only update if still pending
      expiresAt: { gt: new Date() },  // Not expired
    },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // Refresh to get current status for error message
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    if (current?.status === 'accepted') {
      throw new ConflictError('Transfer has already been accepted');
    }
    throw new InvalidInputError(`Transfer cannot be accepted (current status: ${current?.status || 'unknown'})`);
  }

  // Fetch updated record for return
  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer accepted', {
    transferId,
    by: recipientId,
  });

  return formatTransfer(updated);
}

/**
 * Decline a pending transfer (recipient action)
 * Uses atomic update with WHERE clause to prevent race conditions
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
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can decline
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can decline this transfer');
  }

  // Atomic update: only succeeds if status is still 'pending'
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      toUserId: recipientId,
      status: 'pending',
    },
    data: {
      status: 'declined',
      declineReason: reason || null,
      cancelledAt: new Date(),
    },
  });

  if (result.count === 0) {
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    throw new InvalidInputError(`Transfer cannot be declined (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

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
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function cancelTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only owner can cancel
  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can cancel');
  }

  // Atomic update: only succeeds if status is still cancellable
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      fromUserId: ownerId,
      status: { in: ['pending', 'accepted'] },
    },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
    },
  });

  if (result.count === 0) {
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    throw new InvalidInputError(`Transfer cannot be cancelled (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer cancelled', {
    transferId,
    by: ownerId,
  });

  return formatTransfer(updated);
}

/**
 * Confirm and execute transfer (owner action)
 * This is the final step that actually transfers ownership
 * Uses serializable transaction to prevent race conditions
 */
export async function confirmTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  // First check basic validations outside transaction for better error messages
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can confirm');
  }

  // Execute everything in a serializable transaction to prevent race conditions
  // This ensures status check and execution are atomic
  await prisma.$transaction(async (tx) => {
    // Re-fetch and validate inside transaction
    const current = await tx.ownershipTransfer.findUnique({
      where: { id: transferId },
    });

    if (!current || current.status !== 'accepted') {
      if (current?.status === 'confirmed') {
        throw new ConflictError('Transfer has already been completed');
      }
      throw new InvalidInputError(`Transfer cannot be confirmed (current status: ${current?.status || 'unknown'})`);
    }

    // Check expiration
    if (isExpired(current.expiresAt)) {
      await tx.ownershipTransfer.update({
        where: { id: transferId },
        data: { status: 'expired' },
      });
      throw new InvalidInputError('Transfer has expired');
    }

    // Execute the ownership transfer based on resource type
    if (current.resourceType === 'wallet') {
      await executeWalletTransferTx(tx, current);
    } else {
      await executeDeviceTransferTx(tx, current);
    }
  }, {
    isolationLevel: 'Serializable',
  });

  // Fetch updated transfer for return
  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

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
 * Execute wallet ownership transfer (uses existing transaction)
 */
async function executeWalletTransferTx(tx: PrismaTx, transfer: OwnershipTransfer): Promise<void> {
  const walletId = transfer.resourceId;

  // 1. Find current owner's WalletUser record
  const currentOwner = await tx.walletUser.findFirst({
    where: { walletId, userId: transfer.fromUserId, role: 'owner' },
  });

  if (!currentOwner) {
    throw new ConflictError('Transfer failed: owner no longer owns this wallet');
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
}

/**
 * Execute device ownership transfer (uses existing transaction)
 */
async function executeDeviceTransferTx(tx: PrismaTx, transfer: OwnershipTransfer): Promise<void> {
  const deviceId = transfer.resourceId;

  // 1. Find current owner's DeviceUser record
  const currentOwner = await tx.deviceUser.findFirst({
    where: { deviceId, userId: transfer.fromUserId, role: 'owner' },
  });

  if (!currentOwner) {
    throw new ConflictError('Transfer failed: owner no longer owns this device');
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
  const where: Prisma.OwnershipTransferWhereInput = {};

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
