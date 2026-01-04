/**
 * UTXO Selection Utilities
 *
 * Shared helper functions for selection strategies.
 */

import { INPUT_VBYTES, DEFAULT_INPUT_VBYTES, OUTPUT_VBYTES, OVERHEAD_VBYTES } from '../bitcoin/constants';
import type { SelectedUtxo } from './types';

/**
 * Calculate transaction fee based on inputs and outputs
 */
export function calculateFee(
  inputCount: number,
  outputCount: number,
  feeRate: number,
  scriptType: string
): bigint {
  const inputVBytes = INPUT_VBYTES[scriptType as keyof typeof INPUT_VBYTES] || DEFAULT_INPUT_VBYTES;
  const vBytes = OVERHEAD_VBYTES + inputCount * inputVBytes + outputCount * OUTPUT_VBYTES;
  return BigInt(Math.ceil(vBytes * feeRate));
}

/**
 * Calculate privacy impact score
 */
export function calculatePrivacyImpact(selected: SelectedUtxo[]): {
  linkedAddresses: number;
  score: number;
} {
  const addressesSeen = new Set(selected.map((u) => u.address));
  return {
    linkedAddresses: addressesSeen.size,
    score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
  };
}
