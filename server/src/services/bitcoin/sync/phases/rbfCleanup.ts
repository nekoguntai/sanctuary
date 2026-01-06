/**
 * RBF Cleanup Phase
 *
 * Marks pending transactions as replaced if a confirmed transaction
 * shares the same inputs. This catches RBF replacements from external
 * software or prior syncs.
 */

import prisma from '../../../../models/prisma';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-RBF');

/**
 * Execute RBF cleanup phase
 *
 * This phase runs at the start of sync to:
 * 1. Find pending transactions with stored inputs
 * 2. Check if any confirmed transaction uses the same inputs
 * 3. Mark the pending tx as "replaced" and link to the replacement
 * 4. Also repair orphaned replaced transactions (missing replacedByTxid)
 */
export async function rbfCleanupPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;

  // Find pending transactions that have inputs stored
  const pendingTxsWithInputs = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: { some: {} },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

  // Check each pending tx against confirmed transactions
  for (const pendingTx of pendingTxsWithInputs) {
    const confirmedReplacement = await prisma.transaction.findFirst({
      where: {
        walletId,
        confirmations: { gt: 0 },
        txid: { not: pendingTx.txid },
        inputs: {
          some: {
            OR: pendingTx.inputs.map(i => ({
              txid: i.txid,
              vout: i.vout,
            })),
          },
        },
      },
      select: { txid: true },
    });

    if (confirmedReplacement) {
      await prisma.transaction.update({
        where: { id: pendingTx.id },
        data: {
          rbfStatus: 'replaced',
          replacedByTxid: confirmedReplacement.txid,
        },
      });

      walletLog(
        walletId,
        'info',
        'RBF',
        `Cleanup: Marked ${pendingTx.txid.slice(0, 8)}... as replaced by ${confirmedReplacement.txid.slice(0, 8)}...`
      );
    }
  }

  // Retroactive RBF linking: Find replaced transactions without replacedByTxid
  const unlinkedReplacedTxs = await prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: 'replaced',
      replacedByTxid: null,
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

  if (unlinkedReplacedTxs.length > 0) {
    for (const replacedTx of unlinkedReplacedTxs) {
      if (replacedTx.inputs.length === 0) continue;

      const replacementTx = await prisma.transaction.findFirst({
        where: {
          walletId,
          confirmations: { gt: 0 },
          txid: { not: replacedTx.txid },
          inputs: {
            some: {
              OR: replacedTx.inputs.map(i => ({
                txid: i.txid,
                vout: i.vout,
              })),
            },
          },
        },
        select: { txid: true },
      });

      if (replacementTx) {
        await prisma.transaction.update({
          where: { id: replacedTx.id },
          data: { replacedByTxid: replacementTx.txid },
        });

        walletLog(
          walletId,
          'info',
          'RBF',
          `Retroactive link: ${replacedTx.txid.slice(0, 8)}... replaced by ${replacementTx.txid.slice(0, 8)}...`
        );
      }
    }
  }

  return ctx;
}
