/**
 * Wallet Transactions - Pending Route
 *
 * Endpoint for listing pending (unconfirmed) transactions
 * with mempool data enrichment.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { asyncHandler } from '../../../errors/errorHandler';

const log = createLogger('TX_PENDING:ROUTE');

/**
 * Create the pending transactions router
 */
export function createPendingRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions/pending
   * Get pending (unconfirmed) transactions for a wallet
   * Returns data formatted for block queue visualization
   */
  router.get('/wallets/:walletId/transactions/pending', requireWalletAccess('view'), asyncHandler(async (req, res) => {
    const walletId = req.walletId!;

    // Get wallet name for display
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true, network: true },
    });

    // Query unconfirmed transactions (blockHeight is null or 0)
    // Exclude replaced RBF transactions which are no longer in mempool
    const pendingTxs = await prisma.transaction.findMany({
      where: {
        walletId,
        rbfStatus: { not: 'replaced' },
        OR: [
          { blockHeight: 0 },
          { blockHeight: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingTxs.length === 0) {
      return res.json([]);
    }

    // Fetch vsize from mempool.space for accurate fee rate calculation
    const mempoolBaseUrl = wallet?.network === 'testnet'
      ? 'https://mempool.space/testnet/api'
      : 'https://mempool.space/api';

    const pendingTransactions = await Promise.all(
      pendingTxs.map(async (tx) => {
        let fee = tx.fee ? Number(tx.fee) : 0;
        let vsize: number | undefined;
        let feeRate = 0;

        // Try to fetch vsize and fee from mempool.space
        try {
          const response = await fetch(`${mempoolBaseUrl}/tx/${tx.txid}`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (response.ok) {
            const txData = await response.json() as { weight?: number; fee?: number };
            vsize = txData.weight ? Math.ceil(txData.weight / 4) : undefined;
            // Use fee from mempool.space if not in database
            if (fee === 0 && txData.fee) {
              fee = txData.fee;
            }
            if (vsize && fee > 0) {
              feeRate = Math.round((fee / vsize) * 10) / 10; // Round to 1 decimal
            }
          }
        } catch (err) {
          // Mempool fetch failed, use estimate if possible
          log.warn('Failed to fetch tx from mempool.space', { txid: tx.txid, error: err });
        }

        // If mempool.space didn't provide feeRate, fallback to rawTx calculation
        if (feeRate === 0 && tx.rawTx && fee > 0) {
          const size = Math.ceil(tx.rawTx.length / 2); // hex to bytes
          if (size > 0) {
            feeRate = Math.round((fee / size) * 10) / 10;
          }
        }

        // Calculate time in queue
        const createdAt = tx.createdAt;
        const timeInQueue = Math.floor((Date.now() - createdAt.getTime()) / 1000);

        // Map 'consolidation' to 'sent' for display (consolidation is sending to yourself)
        const displayType: 'sent' | 'received' =
          tx.type === 'received' || tx.type === 'receive' ? 'received' : 'sent';

        // Sign amount based on type: negative for sent, positive for received
        const rawAmount = Math.abs(Number(tx.amount));
        const signedAmount = displayType === 'sent' ? -rawAmount : rawAmount;

        return {
          txid: tx.txid,
          walletId: tx.walletId,
          walletName: wallet?.name,
          type: displayType,
          amount: signedAmount,
          fee,
          feeRate,
          vsize,
          recipient: tx.counterpartyAddress || undefined,
          timeInQueue,
          createdAt: createdAt.toISOString(),
        };
      })
    );

    res.json(pendingTransactions);
  }));

  return router;
}
