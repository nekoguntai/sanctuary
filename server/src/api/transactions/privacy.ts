/**
 * Transactions - Privacy Analysis Router
 *
 * Endpoints for UTXO privacy scoring and spend analysis
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { handleApiError } from '../../utils/errors';
import { checkWalletAccess } from '../../services/accessControl';

const router = Router();
const log = createLogger('TX:PRIVACY');

/**
 * GET /api/v1/wallets/:walletId/privacy
 * Get privacy analysis for all UTXOs in a wallet
 */
router.get('/wallets/:walletId/privacy', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    const privacyService = await import('../../services/privacyService');
    const result = await privacyService.calculateWalletPrivacy(walletId);

    // Convert BigInt to number for JSON serialization
    const utxos = result.utxos.map(u => ({
      ...u,
      amount: Number(u.amount),
    }));

    res.json({
      utxos,
      summary: result.summary,
    });
  } catch (error: unknown) {
    handleApiError(error, res, 'Get wallet privacy analysis');
  }
});

/**
 * GET /api/v1/utxos/:utxoId/privacy
 * Get privacy score for a single UTXO
 */
router.get('/utxos/:utxoId/privacy', async (req: Request, res: Response) => {
  try {
    const { utxoId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get UTXO and check wallet access
    const utxo = await prisma.uTXO.findUnique({
      where: { id: utxoId },
      select: { walletId: true },
    });

    if (!utxo) {
      return res.status(404).json({ error: 'UTXO not found' });
    }

    const access = await checkWalletAccess(utxo.walletId, userId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const privacyService = await import('../../services/privacyService');
    const score = await privacyService.calculateUtxoPrivacy(utxoId);

    res.json(score);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get UTXO privacy score');
  }
});

/**
 * POST /api/v1/wallets/:walletId/privacy/spend-analysis
 * Analyze privacy impact of spending selected UTXOs together
 */
router.post('/wallets/:walletId/privacy/spend-analysis', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { utxoIds } = req.body;

    if (!Array.isArray(utxoIds)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'utxoIds must be an array',
      });
    }

    // Verify all UTXOs belong to this wallet
    const utxos = await prisma.uTXO.findMany({
      where: {
        id: { in: utxoIds },
        walletId,
      },
      select: { id: true },
    });

    if (utxos.length !== utxoIds.length) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Some UTXOs not found or do not belong to this wallet',
      });
    }

    const privacyService = await import('../../services/privacyService');
    const analysis = await privacyService.calculateSpendPrivacy(utxoIds);

    res.json(analysis);
  } catch (error: unknown) {
    handleApiError(error, res, 'Analyze spend privacy');
  }
});

export default router;
