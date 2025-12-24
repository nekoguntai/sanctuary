/**
 * Fee Calculation Utilities
 *
 * Pure functions for calculating Bitcoin transaction sizes and fees.
 * Extracted from SendTransaction.tsx for reusability and testability.
 */

/**
 * Calculate input size based on script type (vbytes per input)
 */
export function getInputSize(scriptType?: string): number {
  switch (scriptType) {
    case 'native_segwit': return 68;   // P2WPKH
    case 'nested_segwit': return 91;   // P2SH-P2WPKH
    case 'taproot': return 58;         // P2TR
    case 'legacy': return 148;         // P2PKH
    default: return 68;                // Default to native segwit
  }
}

/**
 * Calculate output size based on script type (vbytes per output)
 */
export function getOutputSize(scriptType?: string): number {
  switch (scriptType) {
    case 'native_segwit': return 31;   // P2WPKH
    case 'nested_segwit': return 32;   // P2SH
    case 'taproot': return 43;         // P2TR
    case 'legacy': return 34;          // P2PKH
    default: return 31;                // Default to native segwit
  }
}

/**
 * Calculate transaction fee given inputs, outputs, fee rate, and script type
 */
export function calculateFee(
  numInputs: number,
  numOutputs: number,
  feeRate: number,
  scriptType?: string
): number {
  const inputSize = getInputSize(scriptType);
  const outputSize = getOutputSize(scriptType);
  // Version (4) + locktime (4) + input count (1) + output count (1) + segwit marker/flag (1)
  const overhead = 11;
  const vbytes = (numInputs * inputSize) + (numOutputs * outputSize) + overhead;
  return Math.ceil(vbytes * feeRate);
}

/**
 * Estimate transaction vbytes
 */
export function estimateVbytes(
  numInputs: number,
  numOutputs: number,
  scriptType?: string
): number {
  const inputSize = getInputSize(scriptType);
  const outputSize = getOutputSize(scriptType);
  const overhead = 11;
  return (numInputs * inputSize) + (numOutputs * outputSize) + overhead;
}
