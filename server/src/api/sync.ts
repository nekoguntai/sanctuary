/**
 * Sync API Routes
 *
 * API endpoints for wallet synchronization management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getSyncService } from '../services/syncService';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const router = Router();
const log = createLogger('SYNC_API');

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
    log.error('[SYNC_API] Sync wallet error:', error);
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
    log.error('[SYNC_API] Queue sync error:', error);
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
    log.error('[SYNC_API] Get sync status error:', error);
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
    log.error('[SYNC_API] Queue user wallets error:', error);
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
    log.error('[SYNC_API] Reset sync error:', error);
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

    // Full resync should reset everything, including stuck sync flags
    // Don't block on syncInProgress - that's the point of a full resync
    if (wallet.syncInProgress) {
      log.info(`[SYNC_API] Full resync clearing stuck syncInProgress for wallet ${walletId}`);
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
    log.error('[SYNC_API] Resync error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to resync wallet',
    });
  }
});

/**
 * POST /api/v1/sync/network/:network
 * Queue all user's wallets for a specific network
 */
router.post('/network/:network', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { network } = req.params;
    const { priority = 'normal' } = req.body;

    // Validate network
    if (!['mainnet', 'testnet', 'signet'].includes(network)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid network. Must be mainnet, testnet, or signet.',
      });
    }

    // Find all user's wallets for this network
    const wallets = await prisma.wallet.findMany({
      where: {
        network,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });

    if (wallets.length === 0) {
      return res.json({
        success: true,
        queued: 0,
        walletIds: [],
        message: `No ${network} wallets found`,
      });
    }

    const syncService = getSyncService();
    const walletIds = wallets.map(w => w.id);

    // Queue each wallet
    for (const walletId of walletIds) {
      syncService.queueSync(walletId, priority);
    }

    res.json({
      success: true,
      queued: walletIds.length,
      walletIds,
    });
  } catch (error: any) {
    log.error('[SYNC_API] Queue network wallets error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to queue network wallets',
    });
  }
});

/**
 * POST /api/v1/sync/network/:network/resync
 * Full resync for all user's wallets of a specific network
 * Requires X-Confirm-Resync: true header
 */
router.post('/network/:network/resync', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { network } = req.params;

    // Validate network
    if (!['mainnet', 'testnet', 'signet'].includes(network)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid network. Must be mainnet, testnet, or signet.',
      });
    }

    // Require confirmation header for destructive operation
    const confirmHeader = req.headers['x-confirm-resync'];
    if (confirmHeader !== 'true') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Full resync requires X-Confirm-Resync: true header',
      });
    }

    // Find all user's wallets for this network
    const wallets = await prisma.wallet.findMany({
      where: {
        network,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: { id: true, syncInProgress: true },
    });

    if (wallets.length === 0) {
      return res.json({
        success: true,
        queued: 0,
        walletIds: [],
        message: `No ${network} wallets found`,
      });
    }

    // Full resync should reset everything, including stuck sync flags
    // Don't skip wallets with syncInProgress - that's the point of a full resync
    const stuckWallets = wallets.filter(w => w.syncInProgress);
    if (stuckWallets.length > 0) {
      log.info(`[SYNC_API] Full network resync clearing ${stuckWallets.length} stuck syncInProgress flags`);
    }

    const walletIds = wallets.map(w => w.id);
    let totalDeletedTxs = 0;

    // Clear transactions and reset state for each wallet
    for (const walletId of walletIds) {
      const deletedTxs = await prisma.transaction.deleteMany({
        where: { walletId },
      });
      totalDeletedTxs += deletedTxs.count;

      // Reset address used flags
      await prisma.address.updateMany({
        where: { walletId },
        data: { used: false },
      });

      // Reset wallet sync state
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          syncInProgress: false,
          lastSyncedAt: null,
          lastSyncStatus: null,
        },
      });
    }

    // Queue all wallets for high-priority sync
    const syncService = getSyncService();
    for (const walletId of walletIds) {
      syncService.queueSync(walletId, 'high');
    }

    res.json({
      success: true,
      queued: walletIds.length,
      walletIds,
      deletedTransactions: totalDeletedTxs,
      clearedStuckFlags: stuckWallets.length,
    });
  } catch (error: any) {
    log.error('[SYNC_API] Resync network wallets error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to resync network wallets',
    });
  }
});

/**
 * GET /api/v1/sync/network/:network/status
 * Get aggregate sync status for all wallets of a network
 */
router.get('/network/:network/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { network } = req.params;

    // Validate network
    if (!['mainnet', 'testnet', 'signet'].includes(network)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid network. Must be mainnet, testnet, or signet.',
      });
    }

    // Find all user's wallets for this network with sync status
    const wallets = await prisma.wallet.findMany({
      where: {
        network,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: {
        id: true,
        syncInProgress: true,
        lastSyncStatus: true,
        lastSyncedAt: true,
      },
    });

    const syncing = wallets.filter(w => w.syncInProgress).length;
    const synced = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'success').length;
    const failed = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'failed').length;
    const pending = wallets.filter(w => !w.syncInProgress && !w.lastSyncStatus).length;

    // Find the most recent sync time
    const syncTimes = wallets
      .filter(w => w.lastSyncedAt)
      .map(w => new Date(w.lastSyncedAt!).getTime());
    const lastSyncAt = syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null;

    res.json({
      network,
      total: wallets.length,
      syncing,
      synced,
      failed,
      pending,
      lastSyncAt,
    });
  } catch (error: any) {
    log.error('[SYNC_API] Get network sync status error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to get network sync status',
    });
  }
});

export default router;
