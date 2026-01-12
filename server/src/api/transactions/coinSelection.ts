/**
 * Transactions - UTXO Selection Router
 *
 * Endpoints for UTXO selection strategies
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { handleApiError } from '../../utils/errors';

const router = Router();
const log = createLogger('TX:COINSELECT');

/**
 * POST /api/v1/wallets/:walletId/utxos/select
 * Select UTXOs for a transaction using specified strategy
 */
router.post('/wallets/:walletId/utxos/select', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { amount, feeRate, strategy = 'efficiency', scriptType } = req.body;

    if (!amount || !feeRate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount and feeRate are required',
      });
    }

    const feeRateNum = parseFloat(feeRate);
    if (isNaN(feeRateNum) || feeRateNum <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'feeRate must be a positive number',
      });
    }

    const validStrategies = ['privacy', 'efficiency', 'oldest_first', 'largest_first', 'smallest_first'];
    if (!validStrategies.includes(strategy)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid strategy. Valid options: ${validStrategies.join(', ')}`,
      });
    }

    const selectionService = await import('../../services/utxoSelectionService');
    const result = await selectionService.selectUtxos({
      walletId,
      targetAmount: BigInt(amount),
      feeRate: feeRateNum,
      strategy,
      scriptType,
    });

    // Convert BigInt to number for JSON serialization
    res.json({
      selected: result.selected.map(u => ({
        ...u,
        amount: Number(u.amount),
      })),
      totalAmount: Number(result.totalAmount),
      estimatedFee: Number(result.estimatedFee),
      changeAmount: Number(result.changeAmount),
      inputCount: result.inputCount,
      strategy: result.strategy,
      warnings: result.warnings,
      privacyImpact: result.privacyImpact,
    });
  } catch (error: unknown) {
    handleApiError(error, res, 'Select UTXOs');
  }
});

/**
 * POST /api/v1/wallets/:walletId/utxos/compare-strategies
 * Compare different UTXO selection strategies for a given amount
 */
router.post('/wallets/:walletId/utxos/compare-strategies', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { amount, feeRate, scriptType } = req.body;

    if (!amount || !feeRate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount and feeRate are required',
      });
    }

    const feeRateNum = parseFloat(feeRate);
    if (isNaN(feeRateNum) || feeRateNum <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'feeRate must be a positive number',
      });
    }

    const selectionService = await import('../../services/utxoSelectionService');
    const results = await selectionService.compareStrategies(
      walletId,
      BigInt(amount),
      feeRateNum,
      scriptType
    );

    // Convert BigInt to number for JSON serialization
    const serialized: Record<string, unknown> = {};
    for (const [strategy, result] of Object.entries(results)) {
      serialized[strategy] = {
        selected: result.selected.map(u => ({
          ...u,
          amount: Number(u.amount),
        })),
        totalAmount: Number(result.totalAmount),
        estimatedFee: Number(result.estimatedFee),
        changeAmount: Number(result.changeAmount),
        inputCount: result.inputCount,
        strategy: result.strategy,
        warnings: result.warnings,
        privacyImpact: result.privacyImpact,
      };
    }

    res.json(serialized);
  } catch (error: unknown) {
    handleApiError(error, res, 'Compare selection strategies');
  }
});

/**
 * GET /api/v1/wallets/:walletId/utxos/recommended-strategy
 * Get recommended UTXO selection strategy based on wallet and fee context
 */
router.get('/wallets/:walletId/utxos/recommended-strategy', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const feeRate = parseFloat(req.query.feeRate as string) || 10;
    const prioritizePrivacy = req.query.prioritizePrivacy === 'true';

    // Get UTXO count
    const utxoCount = await prisma.uTXO.count({
      where: {
        walletId,
        spent: false,
        frozen: false,
      },
    });

    const selectionService = await import('../../services/utxoSelectionService');
    const recommendation = selectionService.getRecommendedStrategy(
      utxoCount,
      feeRate,
      prioritizePrivacy
    );

    res.json({
      ...recommendation,
      utxoCount,
      feeRate,
    });
  } catch (error: unknown) {
    handleApiError(error, res, 'Get recommended strategy');
  }
});

export default router;
