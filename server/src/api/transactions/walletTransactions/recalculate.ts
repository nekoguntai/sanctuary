/**
 * Wallet Transactions - Recalculate Route
 *
 * Endpoint for recalculating running balances for wallet transactions.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { db as prisma } from '../../../repositories/db';
import { recalculateWalletBalances } from '../../../services/bitcoin/blockchain';
import { asyncHandler } from '../../../errors/errorHandler';

/**
 * Create the recalculate router
 */
export function createRecalculateRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/wallets/:walletId/transactions/recalculate
   * Recalculate running balances (balanceAfter) for all transactions in a wallet
   */
  router.post('/wallets/:walletId/transactions/recalculate', requireWalletAccess('view'), asyncHandler(async (req, res) => {
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
  }));

  return router;
}
