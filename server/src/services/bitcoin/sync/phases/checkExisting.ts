/**
 * Check Existing Phase
 *
 * Checks which transactions already exist in the database to avoid
 * re-processing them. Populates existingTxMap, existingTxidSet, and newTxids.
 */

import prisma from '../../../../models/prisma';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-CHECK');

/**
 * Execute check existing phase
 *
 * Queries the database for existing transactions to identify
 * which txids are new and need to be fetched and processed.
 */
export async function checkExistingPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, allTxids } = ctx;

  walletLog(walletId, 'debug', 'SYNC', `Checking ${allTxids.size} transactions against database...`);

  // Batch check which transactions already exist
  const existingTxs = await prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: Array.from(allTxids) },
    },
    select: { txid: true, type: true },
  });

  // Build lookup maps
  ctx.existingTxMap = new Map(existingTxs.map(tx => [`${tx.txid}:${tx.type}`, true]));
  ctx.existingTxidSet = new Set(existingTxs.map(tx => tx.txid));

  // Filter to only new txids
  ctx.newTxids = Array.from(allTxids).filter(txid => !ctx.existingTxidSet.has(txid));

  log.debug(
    `[SYNC] Found ${ctx.newTxids.length} new transactions to process (${ctx.existingTxidSet.size} already exist)`
  );

  if (ctx.newTxids.length > 0) {
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Fetching ${ctx.newTxids.length} new transactions`, {
      existing: ctx.existingTxidSet.size,
    });
  }

  return ctx;
}
