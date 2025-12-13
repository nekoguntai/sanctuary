/**
 * Sync API Routes
 *
 * API endpoints for wallet synchronization management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getSyncService } from '../services/syncService';
import prisma from '../models/prisma';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/sync/wallet/:walletId
 * Trigger immediate sync for a wallet
 */
router.post('/wallet/:walletId', async (req: Request, res: Response) => {
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

    const syncService = getSyncService();
    const result = await syncService.syncNow(walletId);

    res.json({
      success: result.success,
      syncedAddresses: result.addresses,
      newTransactions: result.transactions,
      newUtxos: result.utxos,
      error: result.error,
    });
  } catch (error: any) {
    console.error('[SYNC API] Sync wallet error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to sync wallet',
    });
  }
});

/**
 * POST /api/v1/sync/queue/:walletId
 * Queue a wallet for background sync
 */
router.post('/queue/:walletId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;
    const { priority = 'normal' } = req.body;

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

    const syncService = getSyncService();
    syncService.queueSync(walletId, priority);

    const status = await syncService.getSyncStatus(walletId);

    res.json({
      queued: true,
      queuePosition: status.queuePosition,
      syncInProgress: status.syncInProgress,
    });
  } catch (error: any) {
    console.error('[SYNC API] Queue sync error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to queue sync',
    });
  }
});

/**
 * GET /api/v1/sync/status/:walletId
 * Get sync status for a wallet
 */
router.get('/status/:walletId', async (req: Request, res: Response) => {
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

    const syncService = getSyncService();
    const status = await syncService.getSyncStatus(walletId);

    res.json(status);
  } catch (error: any) {
    console.error('[SYNC API] Get sync status error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to get sync status',
    });
  }
});

/**
 * POST /api/v1/sync/user
 * Queue all user's wallets for background sync (called on login/page load)
 */
router.post('/user', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { priority = 'normal' } = req.body;

    const syncService = getSyncService();
    await syncService.queueUserWallets(userId, priority);

    res.json({
      success: true,
      message: 'All wallets queued for sync',
    });
  } catch (error: any) {
    console.error('[SYNC API] Queue user wallets error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to queue wallets',
    });
  }
});

/**
 * POST /api/v1/sync/reset/:walletId
 * Reset a stuck sync state
 */
router.post('/reset/:walletId', async (req: Request, res: Response) => {
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

    // Reset the sync state
    await prisma.wallet.update({
      where: { id: walletId },
      data: { syncInProgress: false },
    });

    res.json({
      success: true,
      message: 'Sync state reset',
    });
  } catch (error: any) {
    console.error('[SYNC API] Reset sync error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to reset sync state',
    });
  }
});

/**
 * POST /api/v1/sync/resync/:walletId
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
router.post('/resync/:walletId', async (req: Request, res: Response) => {
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

    // Check if sync is already in progress
    if (wallet.syncInProgress) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Sync already in progress for this wallet',
      });
    }

    // Clear all transactions for this wallet
    const deletedTxs = await prisma.transaction.deleteMany({
      where: { walletId },
    });

    // Reset address used flags so they get properly marked during sync
    await prisma.address.updateMany({
      where: { walletId },
      data: { used: false },
    });

    // Reset the wallet sync state
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
      },
    });

    // Trigger immediate high-priority sync
    const syncService = getSyncService();
    syncService.queueSync(walletId, 'high');

    res.json({
      success: true,
      message: `Cleared ${deletedTxs.count} transactions. Full resync queued.`,
      deletedTransactions: deletedTxs.count,
    });
  } catch (error: any) {
    console.error('[SYNC API] Resync error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to resync wallet',
    });
  }
});

export default router;
