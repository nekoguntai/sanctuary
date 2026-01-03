/**
 * Balance Calculation Utilities
 *
 * Handles wallet balance recalculation, running balance updates,
 * and correction of misclassified transactions.
 */

import prisma from '../../../models/prisma';
import { createLogger } from '../../../utils/logger';

const log = createLogger('BALANCE');

/**
 * Correct misclassified consolidation transactions
 *
 * During sync, a consolidation can be misclassified as "sent" if the output
 * address wasn't in the wallet's address set yet (it gets derived later via
 * gap limit expansion). This function finds such transactions and corrects them.
 *
 * A transaction should be a "consolidation" if:
 * - It's currently marked as "sent"
 * - ALL outputs go to wallet addresses (no external outputs)
 *
 * @returns Number of transactions corrected
 */
export async function correctMisclassifiedConsolidations(walletId: string): Promise<number> {
  // Get all wallet addresses
  const walletAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });
  const walletAddressSet = new Set(walletAddresses.map(a => a.address));

  // Find all "sent" transactions with their outputs
  const sentTransactions = await prisma.transaction.findMany({
    where: { walletId, type: 'sent' },
    include: {
      outputs: {
        select: { id: true, address: true, isOurs: true },
      },
    },
  });

  let corrected = 0;

  for (const tx of sentTransactions) {
    // Skip if no outputs recorded (can't verify)
    if (!tx.outputs || tx.outputs.length === 0) continue;

    // Check if ALL outputs go to wallet addresses
    let allOutputsToWallet = true;
    const outputsToFix: string[] = [];

    for (const output of tx.outputs) {
      if (!output.address) {
        // Unknown address (e.g., OP_RETURN) - skip this output
        continue;
      }
      if (walletAddressSet.has(output.address)) {
        // Output is to our wallet
        if (!output.isOurs) {
          outputsToFix.push(output.id);
        }
      } else {
        // Output to external address - this is NOT a consolidation
        allOutputsToWallet = false;
        break;
      }
    }

    if (allOutputsToWallet) {
      // This is actually a consolidation - fix it
      log.info(`Correcting misclassified consolidation: ${tx.txid}`);

      // Update transaction type and amount
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          type: 'consolidation',
          // Amount for consolidation is -fee (only fee is lost)
          amount: tx.fee !== null ? -tx.fee : BigInt(0),
        },
      });

      // Fix isOurs flag on outputs
      if (outputsToFix.length > 0) {
        await prisma.transactionOutput.updateMany({
          where: { id: { in: outputsToFix } },
          data: { isOurs: true, outputType: 'consolidation' },
        });
      }

      corrected++;
    }
  }

  if (corrected > 0) {
    log.info(`Corrected ${corrected} misclassified consolidations in wallet ${walletId}`);
  }

  return corrected;
}

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
