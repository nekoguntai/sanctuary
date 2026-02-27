/**
 * Draft Repository
 *
 * Abstracts database operations for draft transactions.
 * Provides centralized access patterns for draft management.
 */

import prisma from '../models/prisma';
import { Prisma } from '@prisma/client';
import type { DraftTransaction } from '@prisma/client';

/**
 * Draft status types
 */
export type DraftStatus = 'unsigned' | 'partial' | 'signed';

/**
 * Create draft input
 */
export interface CreateDraftInput {
  walletId: string;
  userId: string;
  recipient: string;
  amount: bigint;
  feeRate: number;
  selectedUtxoIds: string[];
  enableRBF: boolean;
  subtractFees: boolean;
  sendMax: boolean;
  outputs?: Prisma.JsonValue;
  inputs?: Prisma.JsonValue;
  decoyOutputs?: Prisma.JsonValue;
  payjoinUrl?: string | null;
  isRBF: boolean;
  label?: string | null;
  memo?: string | null;
  psbtBase64: string;
  signedPsbtBase64?: string | null;
  fee: bigint;
  totalInput: bigint;
  totalOutput: bigint;
  changeAmount: bigint;
  changeAddress?: string | null;
  effectiveAmount: bigint;
  inputPaths: string[];
  expiresAt: Date;
}

/**
 * Update draft input
 */
export interface UpdateDraftInput {
  signedPsbtBase64?: string;
  signedDeviceIds?: string[];
  status?: DraftStatus;
  label?: string | null;
  memo?: string | null;
  expectedUpdatedAt?: Date;
}

/**
 * Find all drafts for a wallet
 */
export async function findByWalletId(walletId: string): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: { walletId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find a draft by ID
 */
export async function findById(draftId: string): Promise<DraftTransaction | null> {
  return prisma.draftTransaction.findUnique({
    where: { id: draftId },
  });
}

/**
 * Find a draft by ID within a specific wallet
 */
export async function findByIdInWallet(
  draftId: string,
  walletId: string
): Promise<DraftTransaction | null> {
  return prisma.draftTransaction.findFirst({
    where: { id: draftId, walletId },
  });
}

/**
 * Find drafts by user ID
 */
export async function findByUserId(userId: string): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find expired drafts
 */
export async function findExpired(): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
}

/**
 * Create a new draft
 */
export async function create(data: CreateDraftInput): Promise<DraftTransaction> {
  return prisma.draftTransaction.create({
    data: {
      walletId: data.walletId,
      userId: data.userId,
      recipient: data.recipient,
      amount: data.amount,
      feeRate: data.feeRate,
      selectedUtxoIds: data.selectedUtxoIds,
      enableRBF: data.enableRBF,
      subtractFees: data.subtractFees,
      sendMax: data.sendMax,
      outputs: data.outputs ?? Prisma.DbNull,
      inputs: data.inputs ?? Prisma.DbNull,
      decoyOutputs: data.decoyOutputs ?? Prisma.DbNull,
      payjoinUrl: data.payjoinUrl ?? null,
      isRBF: data.isRBF,
      label: data.label ?? null,
      memo: data.memo ?? null,
      psbtBase64: data.psbtBase64,
      signedPsbtBase64: data.signedPsbtBase64 ?? null,
      fee: data.fee,
      totalInput: data.totalInput,
      totalOutput: data.totalOutput,
      changeAmount: data.changeAmount,
      changeAddress: data.changeAddress ?? null,
      effectiveAmount: data.effectiveAmount,
      inputPaths: data.inputPaths,
      status: 'unsigned',
      signedDeviceIds: [],
      expiresAt: data.expiresAt,
    },
  });
}

/**
 * Update a draft
 */
export async function update(
  draftId: string,
  data: UpdateDraftInput
): Promise<DraftTransaction> {
  const updateData = {
    ...(data.signedPsbtBase64 !== undefined && { signedPsbtBase64: data.signedPsbtBase64 }),
    ...(data.signedDeviceIds !== undefined && { signedDeviceIds: data.signedDeviceIds }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.label !== undefined && { label: data.label }),
    ...(data.memo !== undefined && { memo: data.memo }),
    updatedAt: new Date(),
  };

  // Optional compare-and-swap update for optimistic concurrency control.
  // Useful for signature aggregation where concurrent updates may otherwise
  // overwrite each other.
  if (data.expectedUpdatedAt) {
    const result = await prisma.draftTransaction.updateMany({
      where: {
        id: draftId,
        updatedAt: data.expectedUpdatedAt,
      },
      data: updateData,
    });

    if (result.count === 0) {
      throw new Error('DRAFT_UPDATE_CONFLICT');
    }

    const updated = await prisma.draftTransaction.findUnique({
      where: { id: draftId },
    });

    if (!updated) {
      throw new Error('Draft not found after update');
    }

    return updated;
  }

  return prisma.draftTransaction.update({
    where: { id: draftId },
    data: updateData,
  });
}

/**
 * Delete a draft
 */
export async function remove(draftId: string): Promise<void> {
  await prisma.draftTransaction.delete({
    where: { id: draftId },
  });
}

/**
 * Delete expired drafts
 */
export async function deleteExpired(): Promise<number> {
  const result = await prisma.draftTransaction.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Count drafts for a wallet
 */
export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.draftTransaction.count({
    where: { walletId },
  });
}

/**
 * Count drafts by status for a wallet
 */
export async function countByStatus(
  walletId: string,
  status: DraftStatus
): Promise<number> {
  return prisma.draftTransaction.count({
    where: { walletId, status },
  });
}

// Export all functions as namespace
export const draftRepository = {
  findByWalletId,
  findById,
  findByIdInWallet,
  findByUserId,
  findExpired,
  create,
  update,
  remove,
  deleteExpired,
  countByWalletId,
  countByStatus,
};

export default draftRepository;
