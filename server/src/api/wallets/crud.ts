/**
 * Wallets - CRUD Router
 *
 * Core wallet lifecycle operations (create, read, update, delete)
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import * as walletService from '../../services/wallet';
import { isValidScriptType, scriptTypeRegistry } from '../../services/scriptTypes';

const router = Router();

/**
 * GET /api/v1/wallets
 * Get all wallets for authenticated user
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const wallets = await walletService.getUserWallets(userId);

  res.json(wallets);
}));

/**
 * POST /api/v1/wallets
 * Create a new wallet
 */
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const {
    name,
    type,
    scriptType,
    network,
    quorum,
    totalSigners,
    descriptor,
    fingerprint,
    groupId,
    deviceIds,
  } = req.body;

  // Validation
  if (!name || !type || !scriptType) {
    throw new InvalidInputError('name, type, and scriptType are required');
  }

  if (!['single_sig', 'multi_sig'].includes(type)) {
    throw new InvalidInputError('type must be single_sig or multi_sig');
  }

  if (!isValidScriptType(scriptType)) {
    throw new InvalidInputError(`Invalid scriptType. Valid types: ${scriptTypeRegistry.getIds().join(', ')}`);
  }

  const wallet = await walletService.createWallet(userId, {
    name,
    type,
    scriptType,
    network,
    quorum,
    totalSigners,
    descriptor,
    fingerprint,
    groupId,
    deviceIds,
  });

  res.status(201).json(wallet);
}));

/**
 * GET /api/v1/wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const walletId = req.walletId!;

  const wallet = await walletService.getWalletById(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  res.json(wallet);
}));

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet (owner only)
 */
router.patch('/:id', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const walletId = req.walletId!;
  const { name, descriptor } = req.body;

  const wallet = await walletService.updateWallet(walletId, userId, {
    name,
    descriptor,
  });

  res.json(wallet);
}));

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet (owner only)
 */
router.delete('/:id', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const walletId = req.walletId!;

  await walletService.deleteWallet(walletId, userId);

  res.status(204).send();
}));

export default router;
