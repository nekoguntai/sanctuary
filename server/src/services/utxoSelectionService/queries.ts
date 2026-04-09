/**
 * UTXO Selection Queries
 *
 * Database queries for fetching available UTXOs.
 */

import { utxoRepository } from '../../repositories';
import type { SelectedUtxo } from './types';

/**
 * Get available UTXOs for selection
 */
export async function getAvailableUtxos(
  walletId: string,
  options: {
    excludeFrozen?: boolean;
    excludeUnconfirmed?: boolean;
    excludeUtxoIds?: string[];
  }
): Promise<SelectedUtxo[]> {
  const utxos = await utxoRepository.findAvailableForSelection(walletId, options);

  return utxos.map(u => ({
    id: u.id,
    txid: u.txid,
    vout: u.vout,
    address: u.address,
    amount: u.amount,
    confirmations: u.confirmations,
    blockHeight: u.blockHeight ?? undefined,
  }));
}
