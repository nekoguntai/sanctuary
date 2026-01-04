/**
 * Largest First UTXO Selection Strategy
 *
 * Uses largest UTXOs first to minimize input count.
 */

import type { SelectionStrategyHandler, SelectionContext, SelectionResult, SelectedUtxo } from '../types';
import { calculateFee, calculatePrivacyImpact } from '../utils';

export const largestFirstStrategy: SelectionStrategyHandler = {
  id: 'largest_first',
  name: 'Largest First',
  description: 'Use largest UTXOs to minimize input count',
  priority: 80,
  tags: ['efficiency', 'size'],

  select(context: SelectionContext): SelectionResult {
    const { utxos, targetAmount, feeRate, scriptType } = context;
    const selected: SelectedUtxo[] = [];
    const warnings: string[] = [];

    // Sort by amount descending
    const sorted = [...utxos].sort((a, b) => (b.amount > a.amount ? 1 : -1));
    let totalSelected = BigInt(0);

    for (const utxo of sorted) {
      const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
      if (totalSelected >= targetAmount + currentFee) break;

      selected.push(utxo);
      totalSelected += utxo.amount;
    }

    const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
    const changeAmount = totalSelected - targetAmount - finalFee;

    if (totalSelected < targetAmount + finalFee) {
      warnings.push('Insufficient funds for this amount');
    }

    return {
      selected,
      totalAmount: totalSelected,
      estimatedFee: finalFee,
      changeAmount: changeAmount > BigInt(0) ? changeAmount : BigInt(0),
      inputCount: selected.length,
      strategy: 'largest_first',
      warnings,
      privacyImpact: calculatePrivacyImpact(selected),
    };
  },
};
