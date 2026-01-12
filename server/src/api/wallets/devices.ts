/**
 * Wallets - Devices Router
 *
 * Device and address management for wallets
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import * as walletService from '../../services/wallet';

const router = Router();
const log = createLogger('WALLETS:DEVICES');

/**
 * POST /api/v1/wallets/:id/addresses
 * Generate a new receiving address (edit access - signer or owner)
 */
router.post('/:id/addresses', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const address = await walletService.generateAddress(walletId, userId);

    res.status(201).json({ address });
  } catch (error) {
    log.error('Generate address error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate address',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/devices
 * Add a device to wallet (edit access - signer or owner)
 */
router.post('/:id/devices', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { deviceId, signerIndex } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'deviceId is required',
      });
    }

    await walletService.addDeviceToWallet(walletId, deviceId, userId, signerIndex);

    res.status(201).json({ message: 'Device added to wallet' });
  } catch (error) {
    log.error('Add device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add device to wallet',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/repair
 * Repair wallet descriptor - regenerate from attached devices
 */
router.post('/:id/repair', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const result = await walletService.repairWalletDescriptor(walletId, userId);

    res.json(result);
  } catch (error) {
    log.error('Repair wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to repair wallet'),
    });
  }
});

export default router;
