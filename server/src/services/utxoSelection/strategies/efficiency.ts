/**
 * Efficiency-focused UTXO Selection Strategy
 *
 * Minimizes transaction fees by using largest UTXOs first.
 */

import type { SelectionStrategyHandler, SelectionContext, SelectionResult, SelectedUtxo } from '../types';
import { calculateFee, calculatePrivacyImpact } from '../utils';

export const efficiencyStrategy: SelectionStrategyHandler = {
  id: 'efficiency',
  name: 'Fee Efficient',
  description: 'Minimize transaction fees by using largest UTXOs first',
  priority: 90,
  tags: ['efficiency', 'fees'],

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
      strategy: 'efficiency',
      warnings,
      privacyImpact: calculatePrivacyImpact(selected),
    };
  },
};
