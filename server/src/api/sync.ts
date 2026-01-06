/**
 * Sync API Routes
 *
 * API endpoints for wallet synchronization management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { rateLimitByUser } from '../middleware/rateLimit';
import { getSyncService } from '../services/syncService';
import { walletRepository, transactionRepository, addressRepository } from '../repositories';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { walletLogBuffer } from '../services/walletLogBuffer';

const router = Router();
const log = createLogger('SYNC_API');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/sync/wallet/:walletId
 * Trigger immediate sync for a wallet
 */
router.post('/wallet/:walletId', rateLimitByUser('sync:trigger'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

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
  } catch (error) {
    log.error('[SYNC_API] Sync wallet error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to sync wallet'),
    });
  }
});

/**
 * POST /api/v1/sync/queue/:walletId
 * Queue a wallet for background sync
 */
router.post('/queue/:walletId', rateLimitByUser('sync:trigger'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;
    const { priority = 'normal' } = req.body;

    // Check user has access to wallet
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

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
  } catch (error) {
    log.error('[SYNC_API] Queue sync error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to queue sync'),
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
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const syncService = getSyncService();
    const status = await syncService.getSyncStatus(walletId);

    res.json(status);
  } catch (error) {
    log.error('[SYNC_API] Get sync status error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to get sync status'),
    });
  }
});

/**
 * GET /api/v1/sync/logs/:walletId
 * Get buffered sync logs for a wallet
 * Returns the most recent logs stored in memory (up to 200 entries)
 */
router.get('/logs/:walletId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const logs = walletLogBuffer.get(walletId);

    res.json({ logs });
  } catch (error) {
    log.error('[SYNC_API] Get sync logs error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to get sync logs'),
    });
  }
});

/**
 * POST /api/v1/sync/user
 * Queue all user's wallets for background sync (called on login/page load)
 */
router.post('/user', rateLimitByUser('sync:batch'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { priority = 'normal' } = req.body;

    const syncService = getSyncService();
    await syncService.queueUserWallets(userId, priority);

    res.json({
      success: true,
      message: 'All wallets queued for sync',
    });
  } catch (error) {
    log.error('[SYNC_API] Queue user wallets error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to queue wallets'),
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
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Reset the sync state
    await walletRepository.updateSyncState(walletId, { syncInProgress: false });

    res.json({
      success: true,
      message: 'Sync state reset',
    });
  } catch (error) {
    log.error('[SYNC_API] Reset sync error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to reset sync state'),
    });
  }
});

/**
 * POST /api/v1/sync/resync/:walletId
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
router.post('/resync/:walletId', rateLimitByUser('sync:trigger'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

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
    const deletedCount = await transactionRepository.deleteByWalletId(walletId);

    // Reset address used flags so they get properly marked during sync
    await addressRepository.resetUsedFlags(walletId);

    // Reset the wallet sync state
    await walletRepository.resetSyncState(walletId);

    // Trigger immediate high-priority sync
    const syncService = getSyncService();
    syncService.queueSync(walletId, 'high');

    res.json({
      success: true,
      message: `Cleared ${deletedCount} transactions. Full resync queued.`,
      deletedTransactions: deletedCount,
    });
  } catch (error) {
    log.error('[SYNC_API] Resync error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to resync wallet'),
    });
  }
});

/**
 * POST /api/v1/sync/network/:network
 * Queue all user's wallets for a specific network
 */
router.post('/network/:network', rateLimitByUser('sync:batch'), async (req: Request, res: Response) => {
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
    const walletIds = await walletRepository.getIdsByNetwork(userId, network as any);

    if (walletIds.length === 0) {
      return res.json({
        success: true,
        queued: 0,
        walletIds: [],
        message: `No ${network} wallets found`,
      });
    }

    const syncService = getSyncService();

    // Queue each wallet
    for (const walletId of walletIds) {
      syncService.queueSync(walletId, priority);
    }

    res.json({
      success: true,
      queued: walletIds.length,
      walletIds,
    });
  } catch (error) {
    log.error('[SYNC_API] Queue network wallets error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to queue network wallets'),
    });
  }
});

/**
 * POST /api/v1/sync/network/:network/resync
 * Full resync for all user's wallets of a specific network
 * Requires X-Confirm-Resync: true header
 */
router.post('/network/:network/resync', rateLimitByUser('sync:batch'), async (req: Request, res: Response) => {
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

    // Find all user's wallets for this network with sync status
    const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, network as any);

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

    // Clear transactions and reset state for each wallet
    let totalDeletedTxs = 0;
    for (const walletId of walletIds) {
      const deletedCount = await transactionRepository.deleteByWalletId(walletId);
      totalDeletedTxs += deletedCount;

      // Reset address used flags
      await addressRepository.resetUsedFlags(walletId);

      // Reset wallet sync state
      await walletRepository.resetSyncState(walletId);
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
  } catch (error) {
    log.error('[SYNC_API] Resync network wallets error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to resync network wallets'),
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
    const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, network as any);

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
  } catch (error) {
    log.error('[SYNC_API] Get network sync status error:', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to get network sync status'),
    });
  }
});

export default router;
