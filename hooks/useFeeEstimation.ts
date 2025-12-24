/**
 * useFeeEstimation Hook
 *
 * Encapsulates fee calculation logic for transactions:
 * - Transaction fee calculation based on inputs/outputs
 * - Maximum sendable amount calculation
 * - Per-output max calculation for send-max mode
 *
 * Extracted from SendTransaction.tsx for reusability.
 */

import { useCallback, useMemo } from 'react';
import { calculateFee as calculateTxFee } from '../utils/feeCalculation';
import type { UTXO } from '../types';
import type { OutputEntry } from './useOutputManagement';

export interface UseFeeEstimationOptions {
  // Wallet info
  scriptType?: string;

  // UTXO data
  spendableUtxos: UTXO[];

  // Coin control state
  showCoinControl: boolean;
  selectedUTXOs: Set<string>;
  selectedTotal: number;

  // Output data
  outputs: OutputEntry[];
  isSendMax: boolean;

  // Fee rate
  feeRate: number;
}

export interface UseFeeEstimationResult {
  // Fee calculation function
  calculateFee: (numInputs: number, numOutputs: number, rate: number) => number;

  // Calculate total fee for current transaction
  calculateTotalFee: () => number;

  // Calculate max sendable for a specific output
  calculateMaxForOutput: (outputIndex: number) => number;

  // Remaining unallocated balance (0 if sendMax is active)
  maxSendableAmount: number;
}

export function useFeeEstimation({
  scriptType,
  spendableUtxos,
  showCoinControl,
  selectedUTXOs,
  selectedTotal,
  outputs,
  isSendMax,
  feeRate,
}: UseFeeEstimationOptions): UseFeeEstimationResult {
  // Get primary amount from first output for estimation
  const amount = outputs[0]?.amount || '0';

  // Calculate transaction fee given inputs, outputs, and fee rate
  const calculateFee = useCallback((numInputs: number, numOutputs: number, rate: number) => {
    return calculateTxFee(numInputs, numOutputs, rate, scriptType);
  }, [scriptType]);

  // Calculate total fee for current transaction (for display purposes)
  const calculateTotalFee = useCallback(() => {
    // Determine number of inputs
    let numInputs: number;
    if (showCoinControl && selectedUTXOs.size > 0) {
      numInputs = selectedUTXOs.size;
    } else {
      // Estimate: use minimum number of UTXOs needed to cover amount + fee
      const amountNeeded = parseInt(amount || '0');
      if (amountNeeded === 0) {
        numInputs = 1;
      } else {
        // Rough estimate: sort UTXOs by amount desc, count how many needed
        const sorted = [...spendableUtxos].sort((a, b) => b.amount - a.amount);
        let running = 0;
        numInputs = 0;
        for (const u of sorted) {
          running += u.amount;
          numInputs++;
          if (running >= amountNeeded + calculateFee(numInputs, 2, feeRate)) break;
        }
        numInputs = Math.max(1, numInputs);
      }
    }

    // Number of outputs: 1 for sendMax (no change), 2 for normal (recipient + change)
    const numOutputs = isSendMax ? 1 : 2;

    return calculateFee(numInputs, numOutputs, feeRate);
  }, [showCoinControl, selectedUTXOs.size, amount, spendableUtxos, isSendMax, feeRate, calculateFee]);

  // Calculate maximum sendable amount for a specific output (accounting for other outputs)
  const calculateMaxForOutput = useMemo(() => {
    return (outputIndex: number) => {
      // Determine available balance
      let availableBalance: number;
      let numInputs: number;

      if (showCoinControl && selectedUTXOs.size > 0) {
        availableBalance = selectedTotal;
        numInputs = selectedUTXOs.size;
      } else if (showCoinControl) {
        return 0;
      } else {
        availableBalance = spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
        numInputs = spendableUtxos.length;
      }

      if (availableBalance <= 0 || numInputs === 0) return 0;

      // Sum of other outputs' amounts (excluding the sendMax output)
      const otherOutputsTotal = outputs.reduce((sum, o, i) => {
        if (i === outputIndex || o.sendMax) return sum;
        return sum + (parseInt(o.amount) || 0);
      }, 0);

      // Number of outputs (sendMax means no change output)
      const hasSendMax = outputs.some(o => o.sendMax);
      const numOutputs = hasSendMax ? outputs.length : outputs.length + 1;
      const estimatedFee = calculateFee(numInputs, numOutputs, feeRate);

      // Max for this output = available - other outputs - fee
      return Math.max(0, availableBalance - otherOutputsTotal - estimatedFee);
    };
  }, [showCoinControl, selectedUTXOs.size, selectedTotal, spendableUtxos, outputs, feeRate, calculateFee]);

  // Calculate max sendable for display - remaining unallocated balance
  const maxSendableAmount = useMemo(() => {
    // If any output has sendMax, all remaining balance is allocated to it, so max sendable is 0
    if (outputs.some(o => o.sendMax)) {
      return 0;
    }

    // No sendMax output - calculate remaining balance after all fixed outputs
    let availableBalance: number;
    let numInputs: number;

    if (showCoinControl && selectedUTXOs.size > 0) {
      availableBalance = selectedTotal;
      numInputs = selectedUTXOs.size;
    } else if (showCoinControl) {
      return 0;
    } else {
      availableBalance = spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
      numInputs = spendableUtxos.length;
    }

    if (availableBalance <= 0 || numInputs === 0) return 0;

    // Sum all output amounts
    const totalOutputs = outputs.reduce((sum, o) => sum + (parseInt(o.amount) || 0), 0);

    // Estimate fee (outputs + change)
    const numOutputs = outputs.length + 1; // +1 for change
    const estimatedFee = calculateFee(numInputs, numOutputs, feeRate);

    return Math.max(0, availableBalance - totalOutputs - estimatedFee);
  }, [outputs, showCoinControl, selectedUTXOs.size, selectedTotal, spendableUtxos, feeRate, calculateFee]);

  return {
    calculateFee,
    calculateTotalFee,
    calculateMaxForOutput,
    maxSendableAmount,
  };
}
