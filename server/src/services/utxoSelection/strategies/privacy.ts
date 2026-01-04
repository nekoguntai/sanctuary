/**
 * Privacy-focused UTXO Selection Strategy
 *
 * Minimizes address linkage by preferring UTXOs from the same transaction
 * or same address.
 */

import type { SelectionStrategyHandler, SelectionContext, SelectionResult, SelectedUtxo } from '../types';
import { calculateFee, calculatePrivacyImpact } from '../utils';

export const privacyStrategy: SelectionStrategyHandler = {
  id: 'privacy',
  name: 'Privacy First',
  description: 'Minimize address linkage by preferring already-linked UTXOs',
  priority: 100,
  tags: ['privacy', 'recommended'],

  select(context: SelectionContext): SelectionResult {
    const { utxos, targetAmount, feeRate, scriptType } = context;
    const selected: SelectedUtxo[] = [];
    const warnings: string[] = [];

    // Group UTXOs by txid (already linked)
    const byTxid = new Map<string, SelectedUtxo[]>();
    for (const utxo of utxos) {
      const group = byTxid.get(utxo.txid) || [];
      group.push(utxo);
      byTxid.set(utxo.txid, group);
    }

    // Sort groups by total amount descending
    const groups = [...byTxid.values()].sort((a, b) => {
      const totalA = a.reduce((sum, u) => sum + u.amount, BigInt(0));
      const totalB = b.reduce((sum, u) => sum + u.amount, BigInt(0));
      return totalB > totalA ? 1 : -1;
    });

    let totalSelected = BigInt(0);
    const addressesSeen = new Set<string>();

    // First, try to satisfy with UTXOs from a single transaction (already linked)
    for (const group of groups) {
      if (selected.length === 0) {
        const groupTotal = group.reduce((sum, u) => sum + u.amount, BigInt(0));
        const fee = calculateFee(group.length, 2, feeRate, scriptType);

        if (groupTotal >= targetAmount + fee) {
          selected.push(...group);
          totalSelected = groupTotal;
          group.forEach((u) => addressesSeen.add(u.address));
          break;
        }
      }
    }

    // If not satisfied, add more UTXOs preferring same addresses
    if (totalSelected < targetAmount + calculateFee(selected.length || 1, 2, feeRate, scriptType)) {
      // Sort remaining by whether address is already used
      const remaining = utxos.filter((u) => !selected.includes(u));
      remaining.sort((a, b) => {
        const aInSet = addressesSeen.has(a.address) ? 0 : 1;
        const bInSet = addressesSeen.has(b.address) ? 0 : 1;
        if (aInSet !== bInSet) return aInSet - bInSet;
        return b.amount > a.amount ? 1 : -1;
      });

      for (const utxo of remaining) {
        const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
        if (totalSelected >= targetAmount + currentFee) break;

        selected.push(utxo);
        totalSelected += utxo.amount;
        addressesSeen.add(utxo.address);
      }
    }

    const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
    const changeAmount = totalSelected - targetAmount - finalFee;

    if (totalSelected < targetAmount + finalFee) {
      warnings.push('Insufficient funds for this amount');
    }

    if (addressesSeen.size > 1) {
      warnings.push(`Spending from ${addressesSeen.size} different addresses links them together`);
    }

    return {
      selected,
      totalAmount: totalSelected,
      estimatedFee: finalFee,
      changeAmount: changeAmount > BigInt(0) ? changeAmount : BigInt(0),
      inputCount: selected.length,
      strategy: 'privacy',
      warnings,
      privacyImpact: calculatePrivacyImpact(selected),
    };
  },
};
