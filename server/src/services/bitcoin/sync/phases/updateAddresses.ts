/**
 * Update Addresses Phase
 *
 * Marks addresses as "used" if they have transaction history.
 * This enables proper gap limit tracking for BIP-44 wallets.
 */

import prisma from '../../../../models/prisma';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-ADDRESSES');

/**
 * Execute update addresses phase
 *
 * After fetching histories, this phase marks all addresses that
 * have at least one transaction as "used".
 */
export async function updateAddressesPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, historyResults } = ctx;

  walletLog(walletId, 'debug', 'SYNC', 'Updating address states...');

  // Collect addresses with transaction history
  const usedAddresses = new Set<string>();
  for (const [addressStr, history] of historyResults) {
    if (history.length > 0) {
      usedAddresses.add(addressStr);
    }
  }

  if (usedAddresses.size > 0) {
    const result = await prisma.address.updateMany({
      where: {
        walletId,
        address: { in: Array.from(usedAddresses) },
        used: false,
      },
      data: { used: true },
    });

    if (result.count > 0) {
      ctx.stats.addressesUpdated = result.count;
      log.debug(`[SYNC] Marked ${result.count} addresses as used`);
    }
  }

  return ctx;
}
