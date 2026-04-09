/**
 * Transaction Repository
 *
 * Abstracts database operations for transactions.
 */

import prisma from '../models/prisma';
import type { Transaction, Prisma } from '../generated/prisma/client';
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

/**
 * Get bucketed balance deltas using raw SQL (for balance history charts)
 */
export async function getBucketedBalanceDeltas(
  walletIds: string[],
  startDate: Date,
  bucketUnit: 'hour' | 'day' | 'week' | 'month'
): Promise<Array<{ bucket: Date; amount: bigint }>> {
  switch (bucketUnit) {
    case 'hour':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('hour', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'day':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('day', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'week':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('week', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
    case 'month':
      return prisma.$queryRaw<Array<{ bucket: Date; amount: bigint }>>`
        SELECT date_trunc('month', "blockTime") AS bucket,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "transactions"
        WHERE "walletId" = ANY(${walletIds}::text[])
          AND "blockTime" IS NOT NULL
          AND "blockTime" >= ${startDate}
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
  }
}

/**
 * Find the most recent transaction for a wallet (for balance lookups)
 */
export async function findLastByWalletId(
  walletId: string,
  options?: { select?: Prisma.TransactionSelect }
) {
  return prisma.transaction.findFirst({
    where: { walletId },
    orderBy: [
      { blockTime: { sort: 'desc', nulls: 'first' } },
      { createdAt: 'desc' },
    ],
    select: options?.select,
  });
}

/**
 * Find a transaction by ID with wallet access check
 */
export async function findByIdWithAccess(
  id: string,
  userId: string,
  options?: { select?: Prisma.TransactionSelect; include?: Prisma.TransactionInclude }
) {
  const query: Prisma.TransactionFindFirstArgs = {
    where: {
      id,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findFirst(query);
}

/**
 * Find a transaction by txid with wallet access check
 */
export async function findByTxidWithAccess(
  txid: string,
  userId: string,
  options?: { select?: Prisma.TransactionSelect; include?: Prisma.TransactionInclude }
) {
  const query: Prisma.TransactionFindFirstArgs = {
    where: {
      txid,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
  };
  if (options?.select) query.select = options.select;
  if (options?.include) query.include = options.include;
  return prisma.transaction.findFirst(query);
}

/**
 * Group transactions by type with counts and sums
 */
export async function groupByType(walletId: string) {
  return prisma.transaction.groupBy({
    by: ['type'],
    where: { walletId },
    _count: { id: true },
    _sum: { amount: true },
  });
}

/**
 * Aggregate fees for sent/consolidation transactions
 */
export async function aggregateFees(walletId: string) {
  return prisma.transaction.aggregate({
    where: {
      walletId,
      type: { in: ['sent', 'consolidation'] },
      fee: { gt: 0 },
    },
    _sum: { fee: true },
  });
}

/**
 * Find transactions by wallet with full details (includes, labels, etc.)
 */
export async function findByWalletIdWithDetails(
  walletId: string,
  options?: {
    where?: Prisma.TransactionWhereInput;
    include?: Prisma.TransactionInclude;
    orderBy?: Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[];
    take?: number;
    skip?: number;
  }
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      ...options?.where,
    },
    include: options?.include,
    orderBy: options?.orderBy ?? { blockTime: 'desc' },
    take: options?.take,
    skip: options?.skip,
  });
}

/**
 * Find transactions across multiple wallets with details
 */
export async function findByWalletIdsWithDetails(
  walletIds: string[],
  options?: {
    where?: Prisma.TransactionWhereInput;
    include?: Prisma.TransactionInclude;
    orderBy?: Prisma.TransactionOrderByWithRelationInput | Prisma.TransactionOrderByWithRelationInput[];
    select?: Prisma.TransactionSelect;
    take?: number;
  }
) {
  const query: Prisma.TransactionFindManyArgs = {
    where: {
      walletId: { in: walletIds },
      ...options?.where,
    },
    orderBy: options?.orderBy ?? { blockTime: 'desc' },
    take: options?.take,
  };
  if (options?.select) query.select = options.select;
  else if (options?.include) query.include = options.include;
  return prisma.transaction.findMany(query);
}

/**
 * Aggregate spending by period for a wallet
 */
export async function aggregateSpending(
  walletId: string,
  cutoff: Date
) {
  return prisma.transaction.aggregate({
    where: { walletId, type: 'sent', blockTime: { gte: cutoff } },
    _count: { _all: true },
    _sum: { amount: true },
  });
}

/**
 * Find transactions for export with labels
 */
export async function findForExport(
  walletId: string,
  dateFilter?: { gte?: Date; lte?: Date }
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      ...(dateFilter && Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
    },
    include: {
      transactionLabels: {
        include: {
          label: true,
        },
      },
    },
    orderBy: { blockTime: 'asc' },
  });
}

/**
 * Find block times for transactions by txids (for UTXO date enrichment)
 */
export async function findBlockTimesByTxids(
  walletId: string,
  txids: string[]
): Promise<Map<string, Date | null>> {
  const transactions = await prisma.transaction.findMany({
    where: {
      txid: { in: txids },
      walletId,
    },
    select: {
      txid: true,
      blockTime: true,
    },
  });
  return new Map(transactions.map(t => [t.txid, t.blockTime]));
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
  getBucketedBalanceDeltas,
  findLastByWalletId,
  findByIdWithAccess,
  findByTxidWithAccess,
  groupByType,
  aggregateFees,
  findByWalletIdWithDetails,
  findByWalletIdsWithDetails,
  aggregateSpending,
  findForExport,
  findBlockTimesByTxids,
};

export default transactionRepository;
