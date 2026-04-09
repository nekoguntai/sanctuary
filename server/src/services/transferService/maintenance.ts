/**
 * Transfer Maintenance
 *
 * Background maintenance functions for the transfer system.
 */

import { transferRepository } from '../../repositories';

/**
 * Expire old transfers (called by maintenance job)
 */
export async function expireOldTransfers(): Promise<number> {
  return transferRepository.expireOverdue();
}
