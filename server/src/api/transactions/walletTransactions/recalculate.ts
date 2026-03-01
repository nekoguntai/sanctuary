/**
 * Wallet Transactions - Recalculate Route
 *
 * Endpoint for recalculating running balances for wallet transactions.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { recalculateWalletBalances } from '../../../services/bitcoin/blockchain';

const log = createLogger('TX:WALLET');

/**
 * Create the recalculate router
 */
export function createRecalculateRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/wallets/:walletId/transactions/recalculate
   * Recalculate running balances (balanceAfter) for all transactions in a wallet
   */
  router.post('/wallets/:walletId/transactions/recalculate', requireWalletAccess('view'), async (req: Request, res: Response) => {
    try {
      const walletId = req.walletId!;

      await recalculateWalletBalances(walletId);

      // Get the final balance after recalculation
      const lastTx = await prisma.transaction.findFirst({
        where: { walletId },
        orderBy: [
          { blockTime: { sort: 'desc', nulls: 'first' } },
          { createdAt: 'desc' },
        ],
        select: { balanceAfter: true },
      });

      res.json({
        success: true,
        message: 'Balances recalculated',
        finalBalance: lastTx?.balanceAfter ? Number(lastTx.balanceAfter) : 0,
        finalBalanceBtc: lastTx?.balanceAfter ? Number(lastTx.balanceAfter) / 100000000 : 0,
      });
    } catch (error) {
      log.error('Failed to recalculate balances', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to recalculate balances',
      });
    }
  });

  return router;
}
