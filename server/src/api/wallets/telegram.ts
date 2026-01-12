/**
 * Wallets - Telegram Router
 *
 * Per-wallet Telegram notification settings
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('WALLETS:TELEGRAM');

/**
 * GET /api/v1/wallets/:id/telegram
 * Get Telegram notification settings for a specific wallet
 */
router.get('/:id/telegram', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const userId = req.user!.userId;

    const { getWalletTelegramSettings } = await import('../../services/telegram/telegramService');
    const settings = await getWalletTelegramSettings(userId, walletId);

    res.json({
      settings: settings || {
        enabled: false,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: true,
        notifyDraft: true,
      },
    });
  } catch (error) {
    log.error('Get Telegram settings error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Telegram settings',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id/telegram
 * Update Telegram notification settings for a specific wallet
 */
router.patch('/:id/telegram', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const userId = req.user!.userId;
    const { enabled, notifyReceived, notifySent, notifyConsolidation, notifyDraft } = req.body;

    const { updateWalletTelegramSettings } = await import('../../services/telegram/telegramService');
    await updateWalletTelegramSettings(userId, walletId, {
      enabled: enabled ?? false,
      notifyReceived: notifyReceived ?? true,
      notifySent: notifySent ?? true,
      notifyConsolidation: notifyConsolidation ?? true,
      notifyDraft: notifyDraft ?? true,
    });

    res.json({
      success: true,
      message: 'Telegram settings updated',
    });
  } catch (error) {
    log.error('Update Telegram settings error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update Telegram settings',
    });
  }
});

export default router;
