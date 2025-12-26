/**
 * Balance Calculation Utilities
 *
 * Handles wallet balance recalculation and running balance updates.
 */

import prisma from '../../../models/prisma';
import { createLogger } from '../../../utils/logger';

const log = createLogger('BALANCE');

/**
 * Recalculate balanceAfter for all transactions in a wallet
 * Called after new transactions are inserted to ensure running balances are accurate
 * OPTIMIZED: Uses batched updates instead of N+1 individual queries
 */
export async function recalculateWalletBalances(walletId: string): Promise<void> {
  // Get all transactions sorted by block time (oldest first)
  const transactions = await prisma.transaction.findMany({
    where: { walletId },
    orderBy: [
      { blockTime: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, amount: true },
  });

  if (transactions.length === 0) {
    return;
  }

  // Calculate all running balances first
  let runningBalance = BigInt(0);
  const updates: { id: string; balanceAfter: bigint }[] = [];

  for (const tx of transactions) {
    runningBalance += tx.amount;
    updates.push({ id: tx.id, balanceAfter: runningBalance });
  }

  // Batch update in chunks of 500 to avoid overwhelming the database
  const BATCH_SIZE = 500;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: { balanceAfter: u.balanceAfter },
        })
      )
    );
  }

  log.debug(`Recalculated balances for ${transactions.length} transactions in wallet ${walletId}`);
}
