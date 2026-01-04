/**
 * Oldest First UTXO Selection Strategy
 *
 * Uses oldest UTXOs first to reduce UTXO set age.
 */

import type { SelectionStrategyHandler, SelectionContext, SelectionResult, SelectedUtxo } from '../types';
import { calculateFee, calculatePrivacyImpact } from '../utils';

export const oldestFirstStrategy: SelectionStrategyHandler = {
  id: 'oldest_first',
  name: 'Oldest First',
  description: 'Use oldest UTXOs first to reduce UTXO set age',
  priority: 70,
  tags: ['age', 'utxo-management'],

  select(context: SelectionContext): SelectionResult {
    const { utxos, targetAmount, feeRate, scriptType } = context;
    const selected: SelectedUtxo[] = [];
    const warnings: string[] = [];

    // Sort by confirmations descending (oldest first)
    const sorted = [...utxos].sort((a, b) => b.confirmations - a.confirmations);
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
      strategy: 'oldest_first',
      warnings,
      privacyImpact: calculatePrivacyImpact(selected),
    };
  },
};
