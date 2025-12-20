/**
 * PSBT Validation Utilities for Payjoin (BIP78)
 *
 * Provides validation and comparison functions for Payjoin PSBTs:
 * - Validate original PSBT format and structure
 * - Validate Payjoin proposal against original
 * - Ensure BIP78 compliance
 */

import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../utils/logger';

const log = createLogger('PSBT-VALIDATION');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PsbtOutput {
  address: string;
  value: number;
}

export interface PsbtInput {
  txid: string;
  vout: number;
  sequence: number;
}

/**
 * Parse PSBT from base64 string
 */
export function parsePsbt(
  psbtBase64: string,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(psbtBase64, { network });
  } catch (error) {
    throw new Error(`Invalid PSBT format: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get inputs from a PSBT
 */
export function getPsbtInputs(psbt: bitcoin.Psbt): PsbtInput[] {
  return psbt.txInputs.map(input => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
    sequence: input.sequence ?? 0xffffffff,
  }));
}

/**
 * Get outputs from a PSBT
 */
export function getPsbtOutputs(
  psbt: bitcoin.Psbt,
  network: bitcoin.Network = bitcoin.networks.bitcoin
): PsbtOutput[] {
  return psbt.txOutputs.map(output => {
    let address = '';
    try {
      address = bitcoin.address.fromOutputScript(output.script, network);
    } catch {
      address = 'unknown';
    }
    return {
      address,
      value: output.value,
    };
  });
}

/**
 * Validate basic PSBT structure
 */
export function validatePsbtStructure(psbtBase64: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const psbt = parsePsbt(psbtBase64);

    // Check has inputs
    if (psbt.inputCount === 0) {
      errors.push('PSBT has no inputs');
    }

    // Check has outputs
    if (psbt.txOutputs.length === 0) {
      errors.push('PSBT has no outputs');
    }

    // Check inputs have required data
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (!input.witnessUtxo && !input.nonWitnessUtxo) {
        warnings.push(`Input ${i} missing UTXO data`);
      }
    }
  } catch (error) {
    errors.push(`Failed to parse PSBT: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a Payjoin proposal against the original PSBT
 * Implements BIP78 validation rules
 */
export function validatePayjoinProposal(
  originalBase64: string,
  proposalBase64: string,
  senderInputIndices: number[],
  network: bitcoin.Network = bitcoin.networks.bitcoin
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const original = parsePsbt(originalBase64, network);
    const proposal = parsePsbt(proposalBase64, network);

    const originalOutputs = getPsbtOutputs(original, network);
    const proposalOutputs = getPsbtOutputs(proposal, network);
    const originalInputs = getPsbtInputs(original);
    const proposalInputs = getPsbtInputs(proposal);

    // Rule 1: Sender's outputs must be preserved or increased
    for (const origOutput of originalOutputs) {
      if (origOutput.address === 'unknown') continue;

      const matchingOutput = proposalOutputs.find(
        o => o.address === origOutput.address
      );

      if (!matchingOutput) {
        errors.push(`Original output to ${origOutput.address} was removed`);
      } else if (matchingOutput.value < origOutput.value) {
        errors.push(
          `Output to ${origOutput.address} decreased from ${origOutput.value} to ${matchingOutput.value}`
        );
      } else if (matchingOutput.value > origOutput.value) {
        // This is allowed - receiver can contribute more
        warnings.push(
          `Output to ${origOutput.address} increased from ${origOutput.value} to ${matchingOutput.value}`
        );
      }
    }

    // Rule 2: Sender's inputs must not be modified
    for (const idx of senderInputIndices) {
      if (idx >= originalInputs.length) {
        errors.push(`Sender input index ${idx} out of range`);
        continue;
      }
      if (idx >= proposalInputs.length) {
        errors.push(`Sender input ${idx} was removed from proposal`);
        continue;
      }

      const origInput = originalInputs[idx];
      const propInput = proposalInputs[idx];

      if (origInput.txid !== propInput.txid || origInput.vout !== propInput.vout) {
        errors.push(
          `Sender input ${idx} was modified: ${origInput.txid}:${origInput.vout} -> ${propInput.txid}:${propInput.vout}`
        );
      }
    }

    // Rule 3: Fee must not increase unreasonably
    const calculateFee = (psbt: bitcoin.Psbt): number => {
      let inputTotal = 0;
      for (let i = 0; i < psbt.inputCount; i++) {
        const input = psbt.data.inputs[i];
        if (input.witnessUtxo) {
          inputTotal += input.witnessUtxo.value;
        } else if (input.nonWitnessUtxo) {
          const tx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
          inputTotal += tx.outs[psbt.txInputs[i].index].value;
        }
      }

      const outputTotal = psbt.txOutputs.reduce((sum, out) => sum + out.value, 0);
      return inputTotal - outputTotal;
    };

    const originalFee = calculateFee(original);
    const proposalFee = calculateFee(proposal);

    if (proposalFee > originalFee * 1.5) {
      errors.push(
        `Fee increased by more than 50%: ${originalFee} -> ${proposalFee} (${((proposalFee / originalFee - 1) * 100).toFixed(1)}%)`
      );
    } else if (proposalFee > originalFee * 1.2) {
      warnings.push(
        `Fee increased significantly: ${originalFee} -> ${proposalFee} (${((proposalFee / originalFee - 1) * 100).toFixed(1)}%)`
      );
    }

    // Rule 4: Proposal must have at least as many inputs as original
    // (receiver should add inputs, not remove)
    if (proposalInputs.length < originalInputs.length) {
      errors.push(
        `Proposal has fewer inputs than original: ${proposalInputs.length} < ${originalInputs.length}`
      );
    }

    // Rule 5: Check for receiver contribution (at least one new input)
    const newInputs = proposalInputs.filter(
      propInput => !originalInputs.some(
        origInput => origInput.txid === propInput.txid && origInput.vout === propInput.vout
      )
    );

    if (newInputs.length === 0) {
      warnings.push('Receiver did not add any inputs - this is not a proper Payjoin');
    }

  } catch (error) {
    errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a transaction is RBF-enabled (has any input with sequence < 0xfffffffe)
 */
export function isRbfEnabled(psbt: bitcoin.Psbt): boolean {
  return psbt.txInputs.some(input => (input.sequence ?? 0xffffffff) < 0xfffffffe);
}

/**
 * Calculate the virtual size of a PSBT
 */
export function calculateVSize(psbt: bitcoin.Psbt): number {
  try {
    // Try to extract the transaction for accurate vsize
    const tx = psbt.extractTransaction(true);
    return tx.virtualSize();
  } catch {
    // Estimate based on input/output counts
    const inputCount = psbt.inputCount;
    const outputCount = psbt.txOutputs.length;
    // Rough estimation for P2WPKH
    return 10.5 + inputCount * 68 + outputCount * 34;
  }
}

/**
 * Calculate fee rate of a PSBT
 */
export function calculateFeeRate(psbt: bitcoin.Psbt): number {
  let inputTotal = 0;

  for (let i = 0; i < psbt.inputCount; i++) {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo) {
      inputTotal += input.witnessUtxo.value;
    } else if (input.nonWitnessUtxo) {
      const tx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
      inputTotal += tx.outs[psbt.txInputs[i].index].value;
    }
  }

  const outputTotal = psbt.txOutputs.reduce((sum, out) => sum + out.value, 0);
  const fee = inputTotal - outputTotal;
  const vsize = calculateVSize(psbt);

  return vsize > 0 ? fee / vsize : 0;
}

/**
 * Clone a PSBT
 */
export function clonePsbt(psbt: bitcoin.Psbt): bitcoin.Psbt {
  return bitcoin.Psbt.fromBase64(psbt.toBase64());
}

/**
 * Merge receiver's signed inputs into sender's PSBT
 */
export function mergeSignedInputs(
  senderPsbt: bitcoin.Psbt,
  receiverPsbt: bitcoin.Psbt,
  receiverInputIndices: number[]
): bitcoin.Psbt {
  const merged = clonePsbt(senderPsbt);

  for (const idx of receiverInputIndices) {
    if (idx >= receiverPsbt.inputCount) continue;

    const receiverInput = receiverPsbt.data.inputs[idx];

    // Copy signature data from receiver
    if (receiverInput.partialSig) {
      merged.data.inputs[idx].partialSig = receiverInput.partialSig;
    }
    if (receiverInput.finalScriptSig) {
      merged.data.inputs[idx].finalScriptSig = receiverInput.finalScriptSig;
    }
    if (receiverInput.finalScriptWitness) {
      merged.data.inputs[idx].finalScriptWitness = receiverInput.finalScriptWitness;
    }
  }

  return merged;
}
