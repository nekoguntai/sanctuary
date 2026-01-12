/**
 * Transactions - Cross-Wallet Router
 *
 * Endpoints for aggregated transaction data across all user's wallets
 * These are optimized aggregate endpoints that replace N separate API calls
 */

import { Router, Request, Response } from 'express';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { handleApiError, bigIntToNumber, bigIntToNumberOrZero } from '../../utils/errors';
import { getCachedBlockHeight, type Network } from '../../services/bitcoin/blockchain';

const router = Router();
const log = createLogger('TX:CROSSWALLET');

/**
 * Calculate confirmations dynamically from block height using cached current height
 * This avoids network calls while providing accurate confirmation counts
 */
function calculateConfirmations(txBlockHeight: number | null, cachedHeight: number): number {
  if (!txBlockHeight || txBlockHeight <= 0 || cachedHeight <= 0) return 0;
  return Math.max(0, cachedHeight - txBlockHeight + 1);
}

/**
 * Helper to get timeframe start date
 */
function getTimeframeStartDate(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case '1D':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '1W':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '1M':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '1Y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'ALL':
    default:
      return new Date(0); // Beginning of time
  }
}

/**
 * GET /api/v1/transactions/recent
 * Get recent transactions across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 *
 * Query params:
 * - limit: max transactions to return (default: 10, max: 50)
 * - walletIds: comma-separated list of wallet IDs to filter (optional)
 */
router.get('/transactions/recent', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
    const requestedWalletIds = req.query.walletIds
      ? (req.query.walletIds as string).split(',').filter(Boolean)
      : null;

    // Get all wallet IDs the user has access to (include network for block height lookups)
    const accessibleWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
        // If specific wallets requested, filter to only those
        ...(requestedWalletIds && { id: { in: requestedWalletIds } }),
      },
      select: { id: true, name: true, network: true },
    });

    if (accessibleWallets.length === 0) {
      return res.json([]);
    }

    const walletIds = accessibleWallets.map(w => w.id);
    const walletNameMap = new Map(accessibleWallets.map(w => [w.id, w.name]));
    const walletNetworkMap = new Map(accessibleWallets.map(w => [w.id, w.network as Network]));

    const transactions = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
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
      orderBy: [
        { blockTime: { sort: 'desc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
      take: limit,
    });

    // Serialize transactions with wallet name included
    const serializedTransactions = transactions.map(tx => {
      const blockHeight = bigIntToNumber(tx.blockHeight);
      const rawAmount = bigIntToNumberOrZero(tx.amount);
      // Get cached block height for this wallet's network (no network call)
      const network = walletNetworkMap.get(tx.walletId) || 'mainnet';
      const currentHeight = getCachedBlockHeight(network);

      return {
        ...tx,
        amount: rawAmount,
        fee: bigIntToNumber(tx.fee),
        balanceAfter: bigIntToNumber(tx.balanceAfter),
        blockHeight,
        // Calculate confirmations dynamically from cached block height for this network
        confirmations: currentHeight > 0 ? calculateConfirmations(blockHeight, currentHeight) : tx.confirmations,
        labels: tx.transactionLabels.map(tl => tl.label),
        transactionLabels: undefined,
        walletName: walletNameMap.get(tx.walletId),
      };
    });

    res.json(serializedTransactions);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get recent transactions');
  }
});

/**
 * GET /api/v1/transactions/pending
 * Get pending (unconfirmed) transactions across all wallets the user has access to
 * Used for mempool visualization showing user's transactions in the block queue
 *
 * Query params: none
 */
router.get('/transactions/pending', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get all wallet IDs the user has access to
    const accessibleWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: { id: true, name: true },
    });

    if (accessibleWallets.length === 0) {
      return res.json([]);
    }

    const walletIds = accessibleWallets.map(w => w.id);
    const walletNameMap = new Map(accessibleWallets.map(w => [w.id, w.name]));

    // Fetch pending (unconfirmed) transactions - those with blockHeight of 0 or null
    // Exclude replaced RBF transactions which are no longer in mempool
    const pendingTransactions = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        rbfStatus: { not: 'replaced' },
        OR: [
          { blockHeight: 0 },
          { blockHeight: null },
        ],
      },
      select: {
        txid: true,
        walletId: true,
        type: true,
        amount: true,
        fee: true,
        rawTx: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Serialize and include fee rate (needed for mempool visualization)
    const serializedPending = pendingTransactions.map(tx => {
      const fee = bigIntToNumber(tx.fee) || 0;
      // Calculate size from rawTx hex (2 hex chars = 1 byte), or estimate ~200 bytes
      const size = tx.rawTx ? Math.ceil(tx.rawTx.length / 2) : 200;
      const feeRate = size > 0 ? fee / size : 0;

      return {
        txid: tx.txid,
        walletId: tx.walletId,
        walletName: walletNameMap.get(tx.walletId),
        type: tx.type,
        amount: bigIntToNumberOrZero(tx.amount),
        fee,
        size,
        feeRate: Math.round(feeRate * 100) / 100, // 2 decimal places
        createdAt: tx.createdAt,
      };
    });

    // Sort by fee rate descending (higher fee rate first)
    serializedPending.sort((a, b) => b.feeRate - a.feeRate);

    res.json(serializedPending);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get pending transactions');
  }
});

/**
 * GET /api/v1/transactions/balance-history
 * Get balance history chart data across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 *
 * Query params:
 * - timeframe: '1D' | '1W' | '1M' | '1Y' | 'ALL' (default: '1W')
 * - totalBalance: current total balance in satoshis (required for chart calculation)
 */
router.get('/transactions/balance-history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const timeframe = (req.query.timeframe as string) || '1W';
    const totalBalance = parseInt(req.query.totalBalance as string, 10) || 0;

    // Get all wallet IDs the user has access to
    const accessibleWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });

    if (accessibleWallets.length === 0) {
      return res.json([
        { name: 'Start', value: totalBalance },
        { name: 'Now', value: totalBalance },
      ]);
    }

    const walletIds = accessibleWallets.map(w => w.id);
    const startDate = getTimeframeStartDate(timeframe);

    // Fetch transactions within timeframe from all accessible wallets
    const transactions = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        blockTime: { gte: startDate },
      },
      select: {
        amount: true,
        blockTime: true,
      },
      orderBy: { blockTime: 'asc' }, // Oldest first for building history
    });

    if (transactions.length === 0) {
      // No transactions in range - return flat line
      return res.json([
        { name: 'Start', value: totalBalance },
        { name: 'Now', value: totalBalance },
      ]);
    }

    // Calculate running balance backwards from current total
    let runningBalance = totalBalance;
    const chartData: { name: string; value: number }[] = [];

    // Start with current balance
    chartData.push({ name: 'Now', value: totalBalance });

    // Work backwards through transactions to reconstruct history
    // Transactions are sorted oldest first, so reverse iterate
    for (let i = transactions.length - 1; i >= 0; i--) {
      const tx = transactions[i];
      const amount = bigIntToNumberOrZero(tx.amount);
      // Subtract the transaction amount to get balance before
      runningBalance -= amount;
      const txDate = tx.blockTime ? new Date(tx.blockTime) : new Date();
      chartData.unshift({
        name: txDate.toLocaleDateString(),
        value: runningBalance,
      });
    }

    res.json(chartData);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get balance history');
  }
});

export default router;
