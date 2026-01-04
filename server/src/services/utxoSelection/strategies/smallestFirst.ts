/**
 * Smallest First UTXO Selection Strategy
 *
 * Uses smallest UTXOs first for consolidation mode.
 */

import type { SelectionStrategyHandler, SelectionContext, SelectionResult, SelectedUtxo } from '../types';
import { calculateFee, calculatePrivacyImpact } from '../utils';

export const smallestFirstStrategy: SelectionStrategyHandler = {
  id: 'smallest_first',
  name: 'Smallest First',
  description: 'Use smallest UTXOs first (consolidation mode)',
  priority: 60,
  tags: ['consolidation', 'utxo-management'],

  select(context: SelectionContext): SelectionResult {
    const { utxos, targetAmount, feeRate, scriptType } = context;
    const selected: SelectedUtxo[] = [];
    const warnings: string[] = [];

    // Sort by amount ascending (smallest first)
    const sorted = [...utxos].sort((a, b) => (a.amount > b.amount ? 1 : -1));
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

    if (selected.length > 5) {
      warnings.push('Consolidation mode: many small UTXOs being combined');
    }

    return {
      selected,
      totalAmount: totalSelected,
      estimatedFee: finalFee,
      changeAmount: changeAmount > BigInt(0) ? changeAmount : BigInt(0),
      inputCount: selected.length,
      strategy: 'smallest_first',
      warnings,
      privacyImpact: calculatePrivacyImpact(selected),
    };
  },
};
