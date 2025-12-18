/**
 * Advanced Transaction Features
 *
 * Implements advanced Bitcoin transaction functionality including:
 * - RBF (Replace-By-Fee)
 * - CPFP (Child-Pays-For-Parent)
 * - Batch transactions
 * - Advanced fee estimation
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, estimateTransactionSize, calculateFee, parseTransaction } from './utils';
import { getElectrumClient } from './electrum';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { DEFAULT_DUST_THRESHOLD } from '../../constants';

const log = createLogger('ADVANCED_TX');

/**
 * Get dust threshold from system settings
 */
async function getDustThreshold(): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'dustThreshold' },
  });
  return setting ? JSON.parse(setting.value) : DEFAULT_DUST_THRESHOLD;
}

/**
 * RBF (Replace-By-Fee) Configuration
 */
export const RBF_SEQUENCE = 0xfffffffd; // Signals RBF is enabled
export const MAX_RBF_SEQUENCE = 0xfffffffe;
export const MIN_RBF_FEE_BUMP = 1; // Minimum 1 sat/vB increase

/**
 * Check if a transaction signals RBF
 */
export function isRBFSignaled(txHex: string): boolean {
  try {
    const tx = bitcoin.Transaction.fromHex(txHex);
    return tx.ins.some(input => input.sequence < 0xfffffffe);
  } catch (error) {
    return false;
  }
}

/**
 * Check if a transaction can be replaced (RBF)
 */
export async function canReplaceTransaction(txid: string): Promise<{
  replaceable: boolean;
  reason?: string;
  currentFeeRate?: number;
  minNewFeeRate?: number;
}> {
  try {
    const client = getElectrumClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    // Get transaction details
    const txDetails = await client.getTransaction(txid);

    // Check if transaction is confirmed
    if (txDetails.confirmations && txDetails.confirmations > 0) {
      return {
        replaceable: false,
        reason: 'Transaction is already confirmed',
      };
    }

    // Parse transaction to check RBF signal
    const txHex = txDetails.hex;
    if (!txHex) {
      log.warn('Transaction hex not available for RBF check', { txid });
      return {
        replaceable: false,
        reason: 'Transaction data not available from server',
      };
    }

    if (!isRBFSignaled(txHex)) {
      // Log more details for debugging
      try {
        const tx = bitcoin.Transaction.fromHex(txHex);
        const sequences = tx.ins.map(input => input.sequence.toString(16));
        log.debug('RBF check failed', { txid, sequences });
      } catch (e) {
        log.debug('Could not parse tx for sequence logging', { txid });
      }
      return {
        replaceable: false,
        reason: 'Transaction does not signal RBF (BIP-125). All inputs have final sequence numbers.',
      };
    }

    // Calculate current fee rate
    const tx = bitcoin.Transaction.fromHex(txHex);
    const vsize = tx.virtualSize();

    // Get input values to calculate fee
    let inputValue = 0;
    for (const input of tx.ins) {
      const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
      const inputTx = await client.getTransaction(inputTxid);
      const prevOut = inputTx.vout[input.index];
      inputValue += Math.round(prevOut.value * 100000000);
    }

    let outputValue = 0;
    for (const output of tx.outs) {
      outputValue += output.value;
    }

    const currentFee = inputValue - outputValue;
    // Preserve decimal precision for fee rate (2 decimal places)
    const currentFeeRate = parseFloat((currentFee / vsize).toFixed(2));
    // Minimum bump is 1 sat/vB or 10% higher, whichever is greater
    const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
    const minNewFeeRate = parseFloat((currentFeeRate + minBump).toFixed(2));

    return {
      replaceable: true,
      currentFeeRate,
      minNewFeeRate,
    };
  } catch (error: any) {
    return {
      replaceable: false,
      reason: error.message || 'Failed to check transaction',
    };
  }
}

/**
 * Create an RBF replacement transaction
 */
export async function createRBFTransaction(
  originalTxid: string,
  newFeeRate: number,
  walletId: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  fee: number;
  feeRate: number;
  feeDelta: number;
  inputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address: string; value: number }>;
}> {
  const client = getElectrumClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Check if transaction can be replaced
  const rbfCheck = await canReplaceTransaction(originalTxid);
  if (!rbfCheck.replaceable) {
    throw new Error(rbfCheck.reason || 'Transaction cannot be replaced');
  }

  if (newFeeRate <= (rbfCheck.currentFeeRate || 0)) {
    throw new Error(
      `New fee rate must be higher than current rate (${rbfCheck.currentFeeRate} sat/vB). Minimum: ${rbfCheck.minNewFeeRate} sat/vB`
    );
  }

  // Get original transaction
  const txDetails = await client.getTransaction(originalTxid);
  const tx = bitcoin.Transaction.fromHex(txDetails.hex);
  const networkObj = getNetwork(network);

  // Create new PSBT with same inputs and outputs
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // Add inputs with RBF sequence
  const inputs: Array<{ txid: string; vout: number; value: number }> = [];
  let totalInput = 0;

  for (const input of tx.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    const value = Math.round(prevOut.value * 100000000);

    psbt.addInput({
      hash: inputTxid,
      index: input.index,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: Buffer.from(prevOut.scriptPubKey.hex, 'hex'),
        value,
      },
    });

    inputs.push({
      txid: inputTxid,
      vout: input.index,
      value,
    });

    totalInput += value;
  }

  // Calculate new fee
  const vsize = tx.virtualSize();
  const newFee = calculateFee(vsize, newFeeRate);

  // Add outputs (adjust change output if present)
  const outputs: Array<{ address: string; value: number }> = [];
  let totalOutput = 0;

  // Get wallet addresses to identify change output
  const walletAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });
  const walletAddressSet = new Set(walletAddresses.map(a => a.address));

  let changeOutputIndex = -1;
  for (let i = 0; i < tx.outs.length; i++) {
    const output = tx.outs[i];
    const address = bitcoin.address.fromOutputScript(output.script, networkObj);

    if (walletAddressSet.has(address)) {
      changeOutputIndex = i;
    }

    outputs.push({ address, value: output.value });
  }

  // Calculate fee difference
  const oldFee = totalInput - tx.outs.reduce((sum, out) => sum + out.value, 0);
  const feeDelta = newFee - oldFee;

  // Adjust change output to account for fee increase
  if (changeOutputIndex >= 0 && feeDelta > 0) {
    outputs[changeOutputIndex].value -= feeDelta;

    // Ensure change output is still above dust threshold
    if (outputs[changeOutputIndex].value < dustThreshold) {
      throw new Error(
        `Insufficient funds in change output to increase fee. Need ${feeDelta} sats more, but change would be dust.`
      );
    }
  } else if (feeDelta > 0) {
    throw new Error('No change output found to deduct additional fee from');
  }

  // Add adjusted outputs to PSBT
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
    totalOutput += output.value;
  }

  return {
    psbt,
    fee: newFee,
    feeRate: newFeeRate,
    feeDelta,
    inputs,
    outputs,
  };
}

/**
 * CPFP (Child-Pays-For-Parent) Configuration
 */
export const CPFP_MIN_FEE_RATE = 1;

/**
 * Calculate CPFP fee to achieve target fee rate
 */
export function calculateCPFPFee(
  parentTxSize: number,
  parentFeeRate: number,
  childTxSize: number,
  targetFeeRate: number
): {
  childFee: number;
  childFeeRate: number;
  totalFee: number;
  totalSize: number;
  effectiveFeeRate: number;
} {
  // Calculate parent fee
  const parentFee = Math.ceil(parentTxSize * parentFeeRate);

  // Calculate total fee needed for target rate
  const totalSize = parentTxSize + childTxSize;
  const totalFee = Math.ceil(totalSize * targetFeeRate);

  // Child fee is the difference
  const childFee = totalFee - parentFee;
  const childFeeRate = Math.ceil(childFee / childTxSize);

  // Effective fee rate for the package
  const effectiveFeeRate = totalFee / totalSize;

  return {
    childFee,
    childFeeRate,
    totalFee,
    totalSize,
    effectiveFeeRate,
  };
}

/**
 * Create a CPFP transaction
 */
export async function createCPFPTransaction(
  parentTxid: string,
  parentVout: number,
  targetFeeRate: number,
  recipientAddress: string,
  walletId: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  childFee: number;
  childFeeRate: number;
  parentFeeRate: number;
  effectiveFeeRate: number;
}> {
  const client = getElectrumClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get parent transaction
  const parentTx = await client.getTransaction(parentTxid);
  const parentVsize = bitcoin.Transaction.fromHex(parentTx.hex).virtualSize();

  // Get the UTXO from parent transaction
  const utxo = await prisma.uTXO.findUnique({
    where: {
      txid_vout: {
        txid: parentTxid,
        vout: parentVout,
      },
    },
  });

  if (!utxo) {
    throw new Error('UTXO not found');
  }

  if (utxo.spent) {
    throw new Error('UTXO is already spent');
  }

  // Calculate parent fee rate
  let parentInputValue = 0;
  const tx = bitcoin.Transaction.fromHex(parentTx.hex);

  for (const input of tx.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    parentInputValue += Math.round(prevOut.value * 100000000);
  }

  const parentOutputValue = tx.outs.reduce((sum, out) => sum + out.value, 0);
  const parentFee = parentInputValue - parentOutputValue;
  const parentFeeRate = parentFee / parentVsize;

  // Estimate child transaction size (1 input, 1 output)
  const childTxSize = estimateTransactionSize(1, 1, 'native_segwit');

  // Calculate CPFP fees
  const cpfpCalc = calculateCPFPFee(
    parentVsize,
    parentFeeRate,
    childTxSize,
    targetFeeRate
  );

  // Ensure we have enough value to create the transaction
  const utxoValue = Number(utxo.amount);
  if (cpfpCalc.childFee >= utxoValue) {
    throw new Error(
      `UTXO value (${utxoValue} sats) is insufficient to pay child fee (${cpfpCalc.childFee} sats)`
    );
  }

  const outputValue = utxoValue - cpfpCalc.childFee;
  if (outputValue < dustThreshold) {
    throw new Error(
      `Output would be dust (${outputValue} sats). Minimum is ${dustThreshold} sats.`
    );
  }

  // Create PSBT
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  psbt.addInput({
    hash: parentTxid,
    index: parentVout,
    witnessUtxo: {
      script: Buffer.from(utxo.scriptPubKey, 'hex'),
      value: utxoValue,
    },
  });

  psbt.addOutput({
    address: recipientAddress,
    value: outputValue,
  });

  return {
    psbt,
    childFee: cpfpCalc.childFee,
    childFeeRate: cpfpCalc.childFeeRate,
    parentFeeRate,
    effectiveFeeRate: cpfpCalc.effectiveFeeRate,
  };
}

/**
 * Batch Transaction Support
 */

/**
 * Create a batch transaction sending to multiple recipients
 */
export async function createBatchTransaction(
  recipients: Array<{ address: string; amount: number; label?: string }>,
  feeRate: number,
  walletId: string,
  selectedUtxoIds?: string[],
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  savedFees: number; // Savings compared to individual transactions
}> {
  if (recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get available UTXOs
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
    },
    orderBy: { amount: 'desc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter(utxo =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Calculate total output amount
  const totalOutputAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

  // Select UTXOs to cover the amount
  const selectedUtxos: typeof utxos = [];
  let totalInput = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += Number(utxo.amount);

    // Estimate fee with current inputs
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      recipients.length + 1, // +1 for change output
      'native_segwit'
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalInput >= totalOutputAmount + estimatedFee) {
      break;
    }
  }

  // Final fee calculation
  const txSize = estimateTransactionSize(
    selectedUtxos.length,
    recipients.length + 1,
    'native_segwit'
  );
  const fee = calculateFee(txSize, feeRate);

  if (totalInput < totalOutputAmount + fee) {
    throw new Error(
      `Insufficient funds. Need ${totalOutputAmount + fee} sats, have ${totalInput} sats`
    );
  }

  const changeAmount = totalInput - totalOutputAmount - fee;

  // Calculate savings vs individual transactions
  const individualTxFee = calculateFee(
    estimateTransactionSize(1, 2, 'native_segwit'), // 1 in, 2 out (recipient + change)
    feeRate
  );
  const totalIndividualFees = individualTxFee * recipients.length;
  const savedFees = totalIndividualFees - fee;

  // Create PSBT
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // Add inputs with RBF enabled
  for (const utxo of selectedUtxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, 'hex'),
        value: Number(utxo.amount),
      },
    });
  }

  // Add recipient outputs
  for (const recipient of recipients) {
    psbt.addOutput({
      address: recipient.address,
      value: recipient.amount,
    });
  }

  // Add change output
  if (changeAmount >= dustThreshold) {
    // Get a change address from the wallet
    const changeAddress = await prisma.address.findFirst({
      where: {
        walletId,
        used: false,
      },
      orderBy: { index: 'asc' },
    });

    if (!changeAddress) {
      throw new Error('No change address available');
    }

    psbt.addOutput({
      address: changeAddress.address,
      value: changeAmount,
    });
  }

  return {
    psbt,
    fee,
    totalInput,
    totalOutput: totalOutputAmount,
    changeAmount,
    savedFees,
  };
}

/**
 * Advanced Fee Estimation
 */

/**
 * Get detailed fee estimates with time predictions
 */
export async function getAdvancedFeeEstimates(): Promise<{
  fastest: { feeRate: number; blocks: number; minutes: number };
  fast: { feeRate: number; blocks: number; minutes: number };
  medium: { feeRate: number; blocks: number; minutes: number };
  slow: { feeRate: number; blocks: number; minutes: number };
  minimum: { feeRate: number; blocks: number; minutes: number };
}> {
  const client = getElectrumClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  try {
    const [fastest, fast, medium, slow, minimum] = await Promise.all([
      client.estimateFee(1),
      client.estimateFee(3),
      client.estimateFee(6),
      client.estimateFee(12),
      client.estimateFee(144),
    ]);

    return {
      fastest: { feeRate: Math.max(1, Math.ceil(fastest)), blocks: 1, minutes: 10 },
      fast: { feeRate: Math.max(1, Math.ceil(fast)), blocks: 3, minutes: 30 },
      medium: { feeRate: Math.max(1, Math.ceil(medium)), blocks: 6, minutes: 60 },
      slow: { feeRate: Math.max(1, Math.ceil(slow)), blocks: 12, minutes: 120 },
      minimum: { feeRate: Math.max(1, Math.ceil(minimum)), blocks: 144, minutes: 1440 },
    };
  } catch (error) {
    log.error('Failed to get fee estimates', { error });
    // Return sensible defaults
    return {
      fastest: { feeRate: 50, blocks: 1, minutes: 10 },
      fast: { feeRate: 30, blocks: 3, minutes: 30 },
      medium: { feeRate: 15, blocks: 6, minutes: 60 },
      slow: { feeRate: 8, blocks: 12, minutes: 120 },
      minimum: { feeRate: 1, blocks: 144, minutes: 1440 },
    };
  }
}

/**
 * Estimate optimal fee for a transaction based on priority
 */
export async function estimateOptimalFee(
  inputCount: number,
  outputCount: number,
  priority: 'fastest' | 'fast' | 'medium' | 'slow' | 'minimum' = 'medium',
  scriptType: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot' = 'native_segwit'
): Promise<{
  fee: number;
  feeRate: number;
  size: number;
  confirmationTime: string;
}> {
  const fees = await getAdvancedFeeEstimates();
  const feeData = fees[priority];
  const size = estimateTransactionSize(inputCount, outputCount, scriptType);
  const fee = calculateFee(size, feeData.feeRate);

  let confirmationTime = '';
  if (feeData.minutes < 60) {
    confirmationTime = `~${feeData.minutes} minutes`;
  } else if (feeData.minutes < 1440) {
    confirmationTime = `~${Math.round(feeData.minutes / 60)} hours`;
  } else {
    confirmationTime = `~${Math.round(feeData.minutes / 1440)} days`;
  }

  return {
    fee,
    feeRate: feeData.feeRate,
    size,
    confirmationTime,
  };
}
