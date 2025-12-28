/**
 * Transaction Repository
 *
 * Abstracts database operations for transactions.
 */

import prisma from '../models/prisma';
import type { Transaction, Prisma } from '@prisma/client';

/**
 * Delete all transactions for a wallet
 * Returns count of deleted transactions
 */
export async function deleteByWalletId(walletId: string): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId },
  });
  return result.count;
}

/**
 * Delete all transactions for multiple wallets
 */
export async function deleteByWalletIds(walletIds: string[]): Promise<number> {
  const result = await prisma.transaction.deleteMany({
    where: { walletId: { in: walletIds } },
  });
  return result.count;
}

/**
 * Find transactions by wallet
 */
export async function findByWalletId(
  walletId: string,
  options?: {
    skip?: number;
    take?: number;
    orderBy?: Prisma.TransactionOrderByWithRelationInput;
  }
): Promise<Transaction[]> {
  return prisma.transaction.findMany({
    where: { walletId },
    skip: options?.skip,
    take: options?.take,
    orderBy: options?.orderBy || { blockTime: 'desc' },
  });
}

/**
 * Count transactions for a wallet
 */
export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.transaction.count({
    where: { walletId },
  });
}

/**
 * Find transaction by txid
 */
export async function findByTxid(txid: string, walletId: string): Promise<Transaction | null> {
  return prisma.transaction.findFirst({
    where: { txid, walletId },
  });
}

/**
 * Find transactions for balance history chart
 */
export async function findForBalanceHistory(
  walletId: string,
  startDate: Date
): Promise<{ blockTime: Date | null; balanceAfter: bigint | null }[]> {
  return prisma.transaction.findMany({
    where: {
      walletId,
      blockTime: { gte: startDate },
      type: { not: 'consolidation' },
    },
    select: {
      blockTime: true,
      balanceAfter: true,
    },
    orderBy: { blockTime: 'asc' },
  });
}

/**
 * Find transactions with labels for export
 */
export async function findWithLabels(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { label: { not: null } },
        { memo: { not: null } },
        { transactionLabels: { some: {} } },
      ],
    },
    include: {
      transactionLabels: {
        include: {
          label: true,
        },
      },
    },
  });
}

// Export as namespace
export const transactionRepository = {
  deleteByWalletId,
  deleteByWalletIds,
  findByWalletId,
  countByWalletId,
  findByTxid,
  findForBalanceHistory,
  findWithLabels,
};

export default transactionRepository;
