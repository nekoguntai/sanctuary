/**
 * Bitcoin - Sync Router
 *
 * Wallet synchronization and confirmation update operations
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('BITCOIN:SYNC');

// All sync routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/bitcoin/wallet/:walletId/sync
 * Sync wallet with blockchain
 */
router.post('/wallet/:walletId/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const result = await blockchain.syncWallet(walletId);

    res.json({
      message: 'Wallet synced successfully',
      ...result,
    });
  } catch (error) {
    log.error('Sync wallet error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync wallet',
    });
  }
});

/**
 * POST /api/v1/bitcoin/wallet/:walletId/update-confirmations
 * Update transaction confirmations for a wallet
 */
router.post('/wallet/:walletId/update-confirmations', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const updated = await blockchain.updateTransactionConfirmations(walletId);

    res.json({
      message: 'Confirmations updated',
      updated,
    });
  } catch (error) {
    log.error('Update confirmations error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update confirmations',
    });
  }
});

export default router;
