/**
 * Transaction Repository
 *
 * Abstracts database operations for transactions.
 */

import prisma from '../models/prisma';
import type { Transaction, Prisma } from '@prisma/client';
import type {
  TransactionPaginationOptions,
  TransactionPaginatedResult,
  TransactionCursor,
} from './types';

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
 * Find transactions by wallet with cursor-based pagination
 * Uses (blockTime, id) compound cursor for stable ordering
 * Much more efficient than offset-based for deep pagination
 */
export async function findByWalletIdPaginated(
  walletId: string,
  options: TransactionPaginationOptions = {}
): Promise<TransactionPaginatedResult> {
  const { limit = 50, cursor, direction = 'forward', includeCount = false } = options;
  const take = Math.min(limit, 200) + 1; // Fetch one extra to detect hasMore

  // Build cursor condition for compound (blockTime, id) cursor
  let cursorCondition: Prisma.TransactionWhereInput = {};
  if (cursor) {
    if (direction === 'forward') {
      // Forward = older transactions (descending blockTime)
      cursorCondition = {
        OR: [
          { blockTime: { lt: cursor.blockTime } },
          {
            blockTime: cursor.blockTime,
            id: { lt: cursor.id },
          },
        ],
      };
    } else {
      // Backward = newer transactions (ascending blockTime)
      cursorCondition = {
        OR: [
          { blockTime: { gt: cursor.blockTime } },
          {
            blockTime: cursor.blockTime,
            id: { gt: cursor.id },
          },
        ],
      };
    }
  }

  const [transactions, totalCount] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        walletId,
        ...cursorCondition,
      },
      take,
      orderBy: direction === 'forward'
        ? [{ blockTime: 'desc' }, { id: 'desc' }]
        : [{ blockTime: 'asc' }, { id: 'asc' }],
    }),
    includeCount ? prisma.transaction.count({ where: { walletId } }) : Promise.resolve(undefined),
  ]);

  const hasMore = transactions.length > limit;
  const items = transactions.slice(0, limit);

  // Reverse if paginating backward to maintain consistent descending order
  if (direction === 'backward') {
    items.reverse();
  }

  // Build next cursor from last item
  let nextCursor: TransactionCursor | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem.blockTime) {
      nextCursor = {
        blockTime: lastItem.blockTime,
        id: lastItem.id,
      };
    }
  }

  return {
    items,
    nextCursor,
    hasMore,
    ...(totalCount !== undefined ? { totalCount } : {}),
  };
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
  findByWalletIdPaginated,
  countByWalletId,
  findByTxid,
  findForBalanceHistory,
  findWithLabels,
};

export default transactionRepository;
