/**
 * Wallets - CRUD Router
 *
 * Core wallet lifecycle operations (create, read, update, delete)
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import * as walletService from '../../services/wallet';
import { isValidScriptType, scriptTypeRegistry } from '../../services/scriptTypes';

const router = Router();
const log = createLogger('WALLETS:CRUD');

/**
 * GET /api/v1/wallets
 * Get all wallets for authenticated user
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const wallets = await walletService.getUserWallets(userId);

    res.json(wallets);
  } catch (error) {
    log.error('Get wallets error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallets',
    });
  }
});

/**
 * POST /api/v1/wallets
 * Create a new wallet
 */
router.post('/', async (req: Request, res: Response) => {
  try {
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
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, type, and scriptType are required',
      });
    }

    if (!['single_sig', 'multi_sig'].includes(type)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'type must be single_sig or multi_sig',
      });
    }

    if (!isValidScriptType(scriptType)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid scriptType. Valid types: ${scriptTypeRegistry.getIds().join(', ')}`,
      });
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
  } catch (error) {
    log.error('Create wallet error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create wallet'),
    });
  }
});

/**
 * GET /api/v1/wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const wallet = await walletService.getWalletById(walletId, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json(wallet);
  } catch (error) {
    log.error('Get wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet (owner only)
 */
router.patch('/:id', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { name, descriptor } = req.body;

    const wallet = await walletService.updateWallet(walletId, userId, {
      name,
      descriptor,
    });

    res.json(wallet);
  } catch (error) {
    log.error('Update wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update wallet',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet (owner only)
 */
router.delete('/:id', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    await walletService.deleteWallet(walletId, userId);

    res.status(204).send();
  } catch (error) {
    log.error('Delete wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete wallet',
    });
  }
});

export default router;
