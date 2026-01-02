/**
 * Draft Transaction API Routes
 *
 * API endpoints for managing draft transactions (saved, unsigned/partially signed PSBTs)
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, signer, viewer)
 * - WRITE (POST, PATCH, DELETE): Only owner or signer roles
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { draftService } from '../services/draftService';
import { isServiceError, toHttpError } from '../services/errors';
import { serializeDraftTransaction, serializeDraftTransactions } from '../utils/serialization';
import { createLogger } from '../utils/logger';

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

    const drafts = await draftService.getDraftsForWallet(walletId, userId);
    res.json(serializeDraftTransactions(drafts));
  } catch (error) {
    if (isServiceError(error)) {
      const { status, body } = toHttpError(error);
      return res.status(status).json(body);
    }
    log.error('Get drafts error', { error });
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

    const draft = await draftService.getDraft(walletId, draftId, userId);
    res.json(serializeDraftTransaction(draft));
  } catch (error) {
    if (isServiceError(error)) {
      const { status, body } = toHttpError(error);
      return res.status(status).json(body);
    }
    log.error('Get draft error', { error });
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
      outputs,
      inputs,
      decoyOutputs,
      payjoinUrl,
      isRBF,
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

    const draft = await draftService.createDraft(walletId, userId, {
      recipient,
      amount,
      feeRate,
      selectedUtxoIds,
      enableRBF,
      subtractFees,
      sendMax,
      outputs,
      inputs,
      decoyOutputs,
      payjoinUrl,
      isRBF,
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
    });

    res.status(201).json(serializeDraftTransaction(draft));
  } catch (error) {
    if (isServiceError(error)) {
      const { status, body } = toHttpError(error);
      return res.status(status).json(body);
    }
    log.error('Create draft error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create draft',
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
    const { signedPsbtBase64, signedDeviceId, status, label, memo } = req.body;

    const draft = await draftService.updateDraft(walletId, draftId, userId, {
      signedPsbtBase64,
      signedDeviceId,
      status,
      label,
      memo,
    });

    res.json(serializeDraftTransaction(draft));
  } catch (error) {
    if (isServiceError(error)) {
      const { status, body } = toHttpError(error);
      return res.status(status).json(body);
    }
    log.error('Update draft error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update draft',
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

    await draftService.deleteDraft(walletId, draftId, userId);
    res.status(204).send();
  } catch (error) {
    if (isServiceError(error)) {
      const { status, body } = toHttpError(error);
      return res.status(status).json(body);
    }
    log.error('Delete draft error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete draft',
    });
  }
});

export default router;
