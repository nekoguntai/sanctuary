/**
 * Draft Transaction API Routes
 *
 * API endpoints for managing draft transactions (saved, unsigned/partially signed PSBTs)
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import * as walletService from '../services/wallet';

const router = Router();
const log = createLogger('DRAFTS');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/wallets/:walletId/drafts
 * Get all draft transactions for a wallet
 */
router.get('/wallets/:walletId/drafts', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Verify user has access to this wallet
    const wallet = await walletService.getWalletById(walletId, userId);
    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const drafts = await prisma.draftTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
    });

    // Convert BigInt to numbers for JSON serialization
    const serializedDrafts = drafts.map(draft => ({
      ...draft,
      amount: Number(draft.amount),
      fee: Number(draft.fee),
      totalInput: Number(draft.totalInput),
      totalOutput: Number(draft.totalOutput),
      changeAmount: Number(draft.changeAmount),
      effectiveAmount: Number(draft.effectiveAmount),
    }));

    res.json(serializedDrafts);
  } catch (error) {
    log.error('[DRAFTS] Get drafts error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch drafts',
    });
  }
});

/**
 * GET /api/v1/wallets/:walletId/drafts/:draftId
 * Get a specific draft transaction
 */
router.get('/wallets/:walletId/drafts/:draftId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, draftId } = req.params;

    // Verify user has access to this wallet
    const wallet = await walletService.getWalletById(walletId, userId);
    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const draft = await prisma.draftTransaction.findFirst({
      where: { id: draftId, walletId },
    });

    if (!draft) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Draft not found',
      });
    }

    // Convert BigInt to numbers for JSON serialization
    const serializedDraft = {
      ...draft,
      amount: Number(draft.amount),
      fee: Number(draft.fee),
      totalInput: Number(draft.totalInput),
      totalOutput: Number(draft.totalOutput),
      changeAmount: Number(draft.changeAmount),
      effectiveAmount: Number(draft.effectiveAmount),
    };

    res.json(serializedDraft);
  } catch (error) {
    log.error('[DRAFTS] Get draft error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch draft',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/drafts
 * Create a new draft transaction
 */
router.post('/wallets/:walletId/drafts', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;
    const {
      recipient,
      amount,
      feeRate,
      selectedUtxoIds,
      enableRBF,
      subtractFees,
      sendMax,
      label,
      memo,
      psbtBase64,
      fee,
      totalInput,
      totalOutput,
      changeAmount,
      changeAddress,
      effectiveAmount,
      inputPaths,
    } = req.body;

    // Verify user has access to this wallet (and is at least a signer)
    const wallet = await walletService.getWalletById(walletId, userId);
    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Check user role - need at least signer access
    if (wallet.userRole === 'viewer') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Viewers cannot create draft transactions',
      });
    }

    // Validation
    if (!recipient || amount === undefined || !feeRate || !psbtBase64) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipient, amount, feeRate, and psbtBase64 are required',
      });
    }

    const draft = await prisma.draftTransaction.create({
      data: {
        walletId,
        userId,
        recipient,
        amount: BigInt(amount),
        feeRate,
        selectedUtxoIds: selectedUtxoIds || [],
        enableRBF: enableRBF ?? true,
        subtractFees: subtractFees ?? false,
        sendMax: sendMax ?? false,
        label,
        memo,
        psbtBase64,
        fee: BigInt(fee || 0),
        totalInput: BigInt(totalInput || 0),
        totalOutput: BigInt(totalOutput || 0),
        changeAmount: BigInt(changeAmount || 0),
        changeAddress,
        effectiveAmount: BigInt(effectiveAmount || amount),
        inputPaths: inputPaths || [],
        status: 'unsigned',
        signedDeviceIds: [],
      },
    });

    log.info('[DRAFTS] Created draft', { draftId: draft.id, walletId, userId });

    // Convert BigInt to numbers for JSON serialization
    const serializedDraft = {
      ...draft,
      amount: Number(draft.amount),
      fee: Number(draft.fee),
      totalInput: Number(draft.totalInput),
      totalOutput: Number(draft.totalOutput),
      changeAmount: Number(draft.changeAmount),
      effectiveAmount: Number(draft.effectiveAmount),
    };

    res.status(201).json(serializedDraft);
  } catch (error: any) {
    log.error('[DRAFTS] Create draft error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create draft',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:walletId/drafts/:draftId
 * Update a draft transaction (e.g., add signature)
 */
router.patch('/wallets/:walletId/drafts/:draftId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, draftId } = req.params;
    const {
      signedPsbtBase64,
      signedDeviceId,
      status,
      label,
      memo,
    } = req.body;

    // Verify user has access to this wallet
    const wallet = await walletService.getWalletById(walletId, userId);
    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Check user role - need at least signer access for modifying
    if (wallet.userRole === 'viewer') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Viewers cannot modify draft transactions',
      });
    }

    // Get existing draft
    const existingDraft = await prisma.draftTransaction.findFirst({
      where: { id: draftId, walletId },
    });

    if (!existingDraft) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Draft not found',
      });
    }

    // Build update data
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (signedPsbtBase64 !== undefined) {
      updateData.signedPsbtBase64 = signedPsbtBase64;
    }

    if (signedDeviceId) {
      // Add device to signed list if not already there
      const currentSigned = existingDraft.signedDeviceIds || [];
      if (!currentSigned.includes(signedDeviceId)) {
        updateData.signedDeviceIds = [...currentSigned, signedDeviceId];
      }
    }

    if (status !== undefined) {
      if (!['unsigned', 'partial', 'signed'].includes(status)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid status. Must be unsigned, partial, or signed',
        });
      }
      updateData.status = status;
    }

    if (label !== undefined) {
      updateData.label = label;
    }

    if (memo !== undefined) {
      updateData.memo = memo;
    }

    const draft = await prisma.draftTransaction.update({
      where: { id: draftId },
      data: updateData,
    });

    log.info('[DRAFTS] Updated draft', { draftId, walletId, status: draft.status });

    // Convert BigInt to numbers for JSON serialization
    const serializedDraft = {
      ...draft,
      amount: Number(draft.amount),
      fee: Number(draft.fee),
      totalInput: Number(draft.totalInput),
      totalOutput: Number(draft.totalOutput),
      changeAmount: Number(draft.changeAmount),
      effectiveAmount: Number(draft.effectiveAmount),
    };

    res.json(serializedDraft);
  } catch (error: any) {
    log.error('[DRAFTS] Update draft error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to update draft',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:walletId/drafts/:draftId
 * Delete a draft transaction
 */
router.delete('/wallets/:walletId/drafts/:draftId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, draftId } = req.params;

    // Verify user has access to this wallet
    const wallet = await walletService.getWalletById(walletId, userId);
    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Get existing draft
    const existingDraft = await prisma.draftTransaction.findFirst({
      where: { id: draftId, walletId },
    });

    if (!existingDraft) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Draft not found',
      });
    }

    // Only owner/creator or owner role can delete
    if (existingDraft.userId !== userId && wallet.userRole !== 'owner') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the creator or wallet owner can delete drafts',
      });
    }

    await prisma.draftTransaction.delete({
      where: { id: draftId },
    });

    log.info('[DRAFTS] Deleted draft', { draftId, walletId, userId });

    res.status(204).send();
  } catch (error) {
    log.error('[DRAFTS] Delete draft error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete draft',
    });
  }
});

export default router;
