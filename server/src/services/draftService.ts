/**
 * Draft Service
 *
 * Business logic for draft transaction management.
 * Handles creation, updates, deletions, and UTXO locking.
 */

import type { DraftTransaction, Prisma } from '@prisma/client';
import * as bitcoin from 'bitcoinjs-lib';
import prisma from '../models/prisma';
import { draftRepository, DraftStatus } from '../repositories';
import { requireWalletAccess, checkWalletAccess } from './accessControl';
import { lockUtxosForDraft, resolveUtxoIds } from './draftLockService';
import { notifyNewDraft } from './notifications/notificationService';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from './errors';
import { createLogger } from '../utils/logger';
import { DEFAULT_DRAFT_EXPIRATION_DAYS } from '../constants';
import * as walletService from './wallet';

const log = createLogger('DRAFT_SVC');

/**
 * Input for creating a draft
 */
export interface CreateDraftInput {
  recipient: string;
  amount: number | string;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  outputs?: Prisma.JsonValue;
  inputs?: Prisma.JsonValue;
  decoyOutputs?: Prisma.JsonValue;
  payjoinUrl?: string;
  isRBF?: boolean;
  label?: string;
  memo?: string;
  psbtBase64: string;
  fee?: number | string;
  totalInput?: number | string;
  totalOutput?: number | string;
  changeAmount?: number | string;
  changeAddress?: string;
  effectiveAmount?: number | string;
  inputPaths?: string[];
}

/**
 * Input for updating a draft
 */
export interface UpdateDraftInput {
  signedPsbtBase64?: string;
  signedDeviceId?: string;
  status?: DraftStatus;
  label?: string;
  memo?: string;
}

/**
 * Get draft expiration days from system settings
 */
async function getDraftExpirationDays(): Promise<number> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'draftExpirationDays' },
    });
    if (setting) {
      return JSON.parse(setting.value);
    }
  } catch (error) {
    log.warn('Failed to get draftExpirationDays from settings', { error: String(error) });
  }
  return DEFAULT_DRAFT_EXPIRATION_DAYS;
}

// ========================================
// DRAFT CRUD OPERATIONS
// ========================================

/**
 * Get all drafts for a wallet
 */
export async function getDraftsForWallet(
  walletId: string,
  userId: string
): Promise<DraftTransaction[]> {
  // Verify user has access to this wallet
  const wallet = await walletService.getWalletById(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet');
  }

  return draftRepository.findByWalletId(walletId);
}

/**
 * Get a specific draft
 */
export async function getDraft(
  walletId: string,
  draftId: string,
  userId: string
): Promise<DraftTransaction> {
  // Verify user has access to this wallet
  const wallet = await walletService.getWalletById(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet');
  }

  const draft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!draft) {
    throw new NotFoundError('Draft');
  }

  return draft;
}

/**
 * Create a new draft transaction
 */
export async function createDraft(
  walletId: string,
  userId: string,
  data: CreateDraftInput
): Promise<DraftTransaction> {
  // Verify user has access and is at least a signer
  const wallet = await walletService.getWalletById(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet');
  }

  if (wallet.userRole === 'viewer') {
    throw new ForbiddenError('Viewers cannot create draft transactions');
  }

  // Validation
  if (!data.recipient || data.amount === undefined || !data.feeRate || !data.psbtBase64) {
    throw new ValidationError('recipient, amount, feeRate, and psbtBase64 are required');
  }

  // Get expiration from system settings
  const expirationDays = await getDraftExpirationDays();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  const draft = await draftRepository.create({
    walletId,
    userId,
    recipient: data.recipient,
    amount: BigInt(data.amount),
    feeRate: data.feeRate,
    selectedUtxoIds: data.selectedUtxoIds || [],
    enableRBF: data.enableRBF ?? true,
    subtractFees: data.subtractFees ?? false,
    sendMax: data.sendMax ?? false,
    outputs: data.outputs || null,
    inputs: data.inputs || null,
    decoyOutputs: data.decoyOutputs || null,
    payjoinUrl: data.payjoinUrl || null,
    isRBF: data.isRBF ?? false,
    label: data.label || null,
    memo: data.memo || null,
    psbtBase64: data.psbtBase64,
    fee: BigInt(data.fee || 0),
    totalInput: BigInt(data.totalInput || 0),
    totalOutput: BigInt(data.totalOutput || 0),
    changeAmount: BigInt(data.changeAmount || 0),
    changeAddress: data.changeAddress || null,
    effectiveAmount: BigInt(data.effectiveAmount || data.amount),
    inputPaths: data.inputPaths || [],
    expiresAt,
  });

  // Lock UTXOs for this draft (unless it's an RBF transaction)
  if (data.selectedUtxoIds && data.selectedUtxoIds.length > 0 && !data.isRBF) {
    const { found: utxoIds, notFound } = await resolveUtxoIds(walletId, data.selectedUtxoIds);

    if (notFound.length > 0) {
      log.warn('Some UTXOs not found for locking', { notFound, draftId: draft.id });
    }

    if (utxoIds.length > 0) {
      const lockResult = await lockUtxosForDraft(draft.id, utxoIds, { isRBF: false });

      if (!lockResult.success) {
        // UTXOs are already locked by another draft - delete the draft and throw error
        await draftRepository.remove(draft.id);

        throw new ConflictError('One or more UTXOs are already locked by another draft transaction');
      }

      log.debug('Locked UTXOs for draft', {
        draftId: draft.id,
        lockedCount: lockResult.lockedCount
      });
    }
  }

  log.info('Created draft', { draftId: draft.id, walletId, userId, isRBF: data.isRBF ?? false });

  // Send notifications to other wallet users (async, don't block response)
  notifyNewDraft(walletId, {
    id: draft.id,
    amount: draft.amount,
    recipient: draft.recipient,
    label: draft.label,
    feeRate: draft.feeRate,
  }, userId).catch(err => {
    log.warn('Failed to send draft notification', { error: String(err) });
  });

  return draft;
}

/**
 * Update a draft transaction
 */
export async function updateDraft(
  walletId: string,
  draftId: string,
  userId: string,
  data: UpdateDraftInput
): Promise<DraftTransaction> {
  // Verify user has access and is at least a signer
  const wallet = await walletService.getWalletById(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet');
  }

  if (wallet.userRole === 'viewer') {
    throw new ForbiddenError('Viewers cannot modify draft transactions');
  }

  // Get existing draft
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft');
  }

  // Build update data
  const updateData: {
    signedPsbtBase64?: string;
    signedDeviceIds?: string[];
    status?: DraftStatus;
    label?: string | null;
    memo?: string | null;
  } = {};

  if (data.signedPsbtBase64 !== undefined) {
    // For multisig: combine new signatures with existing ones
    // This is critical for m-of-n multisig where multiple signers need to add signatures
    const existingPsbt = existingDraft.signedPsbtBase64 || existingDraft.psbtBase64;

    try {
      const existingPsbtObj = bitcoin.Psbt.fromBase64(existingPsbt);
      const newPsbtObj = bitcoin.Psbt.fromBase64(data.signedPsbtBase64);

      // Combine PSBTs - this merges partial signatures from both
      existingPsbtObj.combine(newPsbtObj);

      // Count total signatures after combining
      let totalSigs = 0;
      for (const input of existingPsbtObj.data.inputs) {
        if (input.partialSig) {
          totalSigs += input.partialSig.length;
        }
      }

      log.info('Combined PSBTs for multisig', {
        draftId,
        totalSignatures: totalSigs,
      });

      updateData.signedPsbtBase64 = existingPsbtObj.toBase64();
    } catch (combineError) {
      // If combining fails (e.g., incompatible PSBTs), log and use the new one
      log.warn('Failed to combine PSBTs, using new PSBT directly', {
        draftId,
        error: combineError instanceof Error ? combineError.message : String(combineError),
      });
      updateData.signedPsbtBase64 = data.signedPsbtBase64;
    }
  }

  if (data.signedDeviceId) {
    // Add device to signed list if not already there
    const currentSigned = existingDraft.signedDeviceIds || [];
    if (!currentSigned.includes(data.signedDeviceId)) {
      updateData.signedDeviceIds = [...currentSigned, data.signedDeviceId];
    }
  }

  if (data.status !== undefined) {
    if (!['unsigned', 'partial', 'signed'].includes(data.status)) {
      throw new ValidationError('Invalid status. Must be unsigned, partial, or signed');
    }
    updateData.status = data.status;
  }

  if (data.label !== undefined) {
    updateData.label = data.label;
  }

  if (data.memo !== undefined) {
    updateData.memo = data.memo;
  }

  const draft = await draftRepository.update(draftId, updateData);

  log.info('Updated draft', { draftId, walletId, status: draft.status });

  return draft;
}

/**
 * Delete a draft transaction
 */
export async function deleteDraft(
  walletId: string,
  draftId: string,
  userId: string
): Promise<void> {
  // Verify user has access to this wallet
  const wallet = await walletService.getWalletById(walletId, userId);
  if (!wallet) {
    throw new NotFoundError('Wallet');
  }

  // Get existing draft
  const existingDraft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!existingDraft) {
    throw new NotFoundError('Draft');
  }

  // Only creator or wallet owner can delete
  if (existingDraft.userId !== userId && wallet.userRole !== 'owner') {
    throw new ForbiddenError('Only the creator or wallet owner can delete drafts');
  }

  await draftRepository.remove(draftId);

  log.info('Deleted draft', { draftId, walletId, userId });
}

/**
 * Delete expired drafts (called by maintenance service)
 */
export async function deleteExpiredDrafts(): Promise<number> {
  const count = await draftRepository.deleteExpired();
  if (count > 0) {
    log.info('Deleted expired drafts', { count });
  }
  return count;
}

// Export as namespace
export const draftService = {
  getDraftsForWallet,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteExpiredDrafts,
};

export default draftService;
