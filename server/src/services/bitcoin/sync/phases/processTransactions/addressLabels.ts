/**
 * Address Label Auto-Application
 *
 * Automatically applies address labels to new transactions based on
 * labels already assigned to the transaction's associated address.
 */

import { transactionRepository } from '../../../../../repositories';
import { createLogger } from '../../../../../utils/logger';
import type { TransactionCreateData } from '../../types';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/**
 * Auto-apply address labels to new transactions
 */
export async function applyAddressLabels(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    const addressIds = [...new Set(newTransactions.map(tx => tx.addressId).filter(Boolean))] as string[];
    if (addressIds.length === 0) return;

    const addressLabels = await transactionRepository.findAddressLabelsByAddressIds(addressIds);

    if (addressLabels.length === 0) return;

    const labelsByAddress = new Map<string, string[]>();
    for (const al of addressLabels) {
      const labels = labelsByAddress.get(al.addressId) || [];
      labels.push(al.labelId);
      labelsByAddress.set(al.addressId, labels);
    }

    const createdTxs = await transactionRepository.findByWalletIdAndTxids(
      walletId,
      newTransactions.map(tx => tx.txid),
      { id: true, txid: true, addressId: true }
    );

    const txLabelData: { transactionId: string; labelId: string }[] = [];
    for (const tx of createdTxs) {
      if (tx.addressId) {
        const labels = labelsByAddress.get(tx.addressId) || [];
        for (const labelId of labels) {
          txLabelData.push({ transactionId: tx.id, labelId });
        }
      }
    }

    if (txLabelData.length > 0) {
      await transactionRepository.createManyTransactionLabels(txLabelData, { skipDuplicates: true });
    }
  } catch (labelError) {
    log.warn(`[SYNC] Failed to auto-apply address labels: ${labelError}`);
  }
}
