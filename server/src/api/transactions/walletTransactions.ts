/**
 * Transactions - Wallet Transactions Router
 *
 * Endpoints for listing, stats, and managing wallet-specific transactions
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { handleApiError, validatePagination, bigIntToNumber, bigIntToNumberOrZero } from '../../utils/errors';
import { recalculateWalletBalances, getCachedBlockHeight } from '../../services/bitcoin/blockchain';
import { walletCache } from '../../services/cache';

const router = Router();
const log = createLogger('TX:WALLET');

/**
 * Calculate confirmations dynamically from block height using cached current height
 * This avoids network calls while providing accurate confirmation counts
 */
function calculateConfirmations(txBlockHeight: number | null, cachedHeight: number): number {
  if (!txBlockHeight || txBlockHeight <= 0 || cachedHeight <= 0) return 0;
  return Math.max(0, cachedHeight - txBlockHeight + 1);
}

/**
 * GET /api/v1/wallets/:walletId/transactions
 * Get all transactions for a wallet
 */
router.get('/wallets/:walletId/transactions', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { limit, offset } = validatePagination(
      req.query.limit as string,
      req.query.offset as string
    );

    // Get wallet network for network-specific block height cache
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });
    const network = (wallet?.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

    // Get cached block height for this network (no network call)
    const currentHeight = getCachedBlockHeight(network);

    const transactions = await prisma.transaction.findMany({
      where: {
        walletId,
        // Exclude replaced RBF transactions which are no longer in mempool
        // These show as "pending" forever since they'll never confirm
        rbfStatus: { not: 'replaced' },
      },
      include: {
        address: {
          select: {
            address: true,
            derivationPath: true,
          },
        },
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      // Sort pending transactions (null blockTime) first, then by date descending
      // Pending txs use createdAt for ordering, confirmed txs use blockTime
      orderBy: [
        { blockTime: { sort: 'desc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
      take: limit,
      skip: offset,
    });

    // Convert BigInt amounts to numbers
    // The amounts in the database are already correctly signed:
    // - sent: negative (amount + fee already deducted during sync)
    // - consolidation: negative fee only (only fee lost)
    // - received: positive (what you received)
    //
    // PRECISION NOTE: BigInt to Number conversion is safe for Bitcoin amounts
    // up to ~90 million BTC (Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9,007,199,254,740,991 sats).
    // This exceeds Bitcoin's 21 million coin cap by 4x, so precision loss is not a concern
    // for transaction amounts. For amounts exceeding this threshold in other contexts,
    // consider converting to string instead.
    const serializedTransactions = transactions.map(tx => {
      const blockHeight = bigIntToNumber(tx.blockHeight);
      const rawAmount = bigIntToNumberOrZero(tx.amount);

      // The amount is already correctly signed in the database
      // Don't re-apply signing logic to avoid double-counting fees

      return {
        ...tx,
        amount: rawAmount,
        fee: bigIntToNumber(tx.fee),
        balanceAfter: bigIntToNumber(tx.balanceAfter),
        blockHeight,
        // Calculate confirmations dynamically from cached block height
        // Falls back to stored value if cache not yet populated
        confirmations: currentHeight > 0 ? calculateConfirmations(blockHeight, currentHeight) : tx.confirmations,
        labels: tx.transactionLabels.map(tl => tl.label),
        transactionLabels: undefined, // Remove the raw join data
      };
    });

    res.json(serializedTransactions);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get transactions');
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/stats
 * Get transaction summary statistics for a wallet
 * Returns counts and totals independent of pagination
 * CACHED: Results are cached for 30 seconds to reduce database load
 */
router.get('/wallets/:walletId/transactions/stats', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Use cache to reduce database load for frequently accessed stats (30 second TTL)
    const cacheKey = `tx-stats:${walletId}`;

    interface TxStatsCache {
      totalSent: string;
      totalReceived: string;
      transactionCount: number;
      avgFee: string;
      totalFees: string;
      currentBalance: string;
      _receivedCount: number;
      _sentCount: number;
      _consolidationCount: number;
    }

    let stats = await walletCache.get<TxStatsCache>(cacheKey);

    if (!stats) {
      // OPTIMIZED: Use aggregate queries instead of loading all transactions
      const [typeStats, feeStats, lastTx] = await Promise.all([
        prisma.transaction.groupBy({
          by: ['type'],
          where: { walletId },
          _count: { id: true },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            walletId,
            type: { in: ['sent', 'consolidation'] },
            fee: { gt: 0 },
          },
          _sum: { fee: true },
        }),
        prisma.transaction.findFirst({
          where: { walletId },
          orderBy: [
            { blockTime: { sort: 'desc', nulls: 'first' } },
            { createdAt: 'desc' },
          ],
          select: { balanceAfter: true },
        }),
      ]);

      // Extract stats from grouped results
      let totalCount = 0;
      let receivedCount = 0;
      let sentCount = 0;
      let consolidationCount = 0;
      let totalReceived = BigInt(0);
      let totalSent = BigInt(0);

      for (const stat of typeStats) {
        const count = stat._count.id;
        const amount = stat._sum.amount || BigInt(0);
        totalCount += count;

        if (stat.type === 'received') {
          receivedCount = count;
          totalReceived = amount > 0 ? amount : -amount;
        } else if (stat.type === 'sent') {
          sentCount = count;
          totalSent = amount < 0 ? -amount : amount;
        } else if (stat.type === 'consolidation') {
          consolidationCount = count;
        }
      }

      const totalFees = feeStats._sum.fee || BigInt(0);
      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      // Store as strings for cache (BigInt not serializable)
      stats = {
        totalSent: totalSent.toString(),
        totalReceived: totalReceived.toString(),
        transactionCount: totalCount,
        avgFee: totalCount > 0 ? (Number(totalFees) / totalCount).toString() : '0',
        totalFees: totalFees.toString(),
        currentBalance: walletBalance.toString(),
        // Include detailed counts for response
        _receivedCount: receivedCount,
        _sentCount: sentCount,
        _consolidationCount: consolidationCount,
      };

      await walletCache.set(cacheKey, stats, 30);
    }

    res.json({
      totalCount: stats.transactionCount,
      receivedCount: stats._receivedCount,
      sentCount: stats._sentCount,
      consolidationCount: stats._consolidationCount,
      totalReceived: Number(BigInt(stats.totalReceived)),
      totalSent: Number(BigInt(stats.totalSent)),
      totalFees: Number(BigInt(stats.totalFees)),
      walletBalance: Number(BigInt(stats.currentBalance)),
    });
  } catch (error: unknown) {
    handleApiError(error, res, 'Get transaction stats');
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/pending
 * Get pending (unconfirmed) transactions for a wallet
 * Returns data formatted for block queue visualization
 */
router.get('/wallets/:walletId/transactions/pending', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get pending transactions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch pending transactions',
    });
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/export
 * Export transactions for a wallet in CSV or JSON format
 */
router.get('/wallets/:walletId/transactions/export', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { format = 'csv', startDate, endDate } = req.query;

    // Build date filter
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      // Set to end of day
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Get wallet name for filename
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true },
    });

    // Query all transactions (no pagination for export)
    const transactions = await prisma.transaction.findMany({
      where: {
        walletId,
        ...(Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
      },
      include: {
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { blockTime: 'asc' },  // Oldest first to match Sparrow format
    });

    // Convert to export format
    // The amount in DB is already correctly signed:
    // - sent: negative (includes fee)
    // - consolidation: negative (just the fee)
    // - received: positive
    const exportData = transactions.map(tx => {
      // Use the stored amount directly - it's already correctly signed
      const signedAmount = Number(tx.amount);

      return {
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: signedAmount / 100000000,
        amountSats: signedAmount,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        feeSats: tx.fee ? Number(tx.fee) : null,
        confirmations: tx.confirmations,
        label: tx.label || '',
        memo: tx.memo || '',
        counterpartyAddress: tx.counterpartyAddress || '',
        blockHeight: tx.blockHeight ? Number(tx.blockHeight) : null,
      };
    });

    const walletName = wallet?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.json"`);
      return res.json(exportData);
    }

    // Generate CSV
    const csvHeaders = [
      'Date',
      'Transaction ID',
      'Type',
      'Amount (BTC)',
      'Amount (sats)',
      'Balance After (BTC)',
      'Balance After (sats)',
      'Fee (sats)',
      'Confirmations',
      'Label',
      'Memo',
      'Counterparty Address',
      'Block Height',
    ];

    const escapeCSV = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = exportData.map(tx => [
      escapeCSV(tx.date),
      escapeCSV(tx.txid),
      escapeCSV(tx.type),
      escapeCSV(tx.amountBtc),
      escapeCSV(tx.amountSats),
      escapeCSV(tx.balanceAfterBtc),
      escapeCSV(tx.balanceAfterSats),
      escapeCSV(tx.feeSats),
      escapeCSV(tx.confirmations),
      escapeCSV(tx.label),
      escapeCSV(tx.memo),
      escapeCSV(tx.counterpartyAddress),
      escapeCSV(tx.blockHeight),
    ].join(','));

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.csv"`);
    res.send(csv);
  } catch (error) {
    log.error('Export transactions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export transactions',
    });
  }
});

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

export default router;
