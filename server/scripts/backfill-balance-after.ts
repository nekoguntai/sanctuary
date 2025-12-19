/**
 * Backfill balanceAfter for existing transactions
 *
 * This script calculates the running balance for each transaction in each wallet
 * and updates the balanceAfter field.
 *
 * Run with: npx tsx scripts/backfill-balance-after.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillBalanceAfter() {
  console.log('Starting balanceAfter backfill...');

  // Get all wallets
  const wallets = await prisma.wallet.findMany({
    select: { id: true, name: true },
  });

  console.log(`Found ${wallets.length} wallets to process`);

  for (const wallet of wallets) {
    console.log(`\nProcessing wallet: ${wallet.name} (${wallet.id})`);

    // Get all transactions for this wallet, sorted by blockTime (oldest first)
    // For unconfirmed transactions (no blockTime), use createdAt
    const transactions = await prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: [
        { blockTime: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        txid: true,
        amount: true,
        blockTime: true,
      },
    });

    console.log(`  Found ${transactions.length} transactions`);

    if (transactions.length === 0) {
      continue;
    }

    // Calculate running balance
    let runningBalance = BigInt(0);
    let updateCount = 0;

    for (const tx of transactions) {
      runningBalance += tx.amount;

      // Update the transaction with balanceAfter
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { balanceAfter: runningBalance },
      });

      updateCount++;
    }

    console.log(`  Updated ${updateCount} transactions`);
    console.log(`  Final balance: ${runningBalance} sats`);
  }

  console.log('\nBackfill complete!');
}

backfillBalanceAfter()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
