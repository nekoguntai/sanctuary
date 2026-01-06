/**
 * Fix Consolidations Phase
 *
 * Corrects transactions that were initially classified as "sent" but should
 * actually be "consolidations" (all outputs go to wallet addresses that were
 * derived after the initial classification).
 */

import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import { correctMisclassifiedConsolidations, recalculateWalletBalances } from '../../utils/balanceCalculation';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-CONSOLIDATIONS');

/**
 * Execute fix consolidations phase
 *
 * After all addresses are synced, checks for "sent" transactions that should
 * actually be consolidations (all outputs go to wallet addresses that were
 * derived after the initial classification).
 */
export async function fixConsolidationsPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;

  walletLog(walletId, 'debug', 'SYNC', 'Checking for misclassified consolidations...');

  const correctedCount = await correctMisclassifiedConsolidations(walletId);

  if (correctedCount > 0) {
    ctx.stats.correctedConsolidations = correctedCount;

    walletLog(
      walletId,
      'info',
      'SYNC',
      `Corrected ${correctedCount} misclassified consolidations, recalculating balances...`
    );

    // Recalculate running balances after corrections
    await recalculateWalletBalances(walletId);
  }

  return ctx;
}
