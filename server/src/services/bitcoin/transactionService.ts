/**
 * Transaction Service
 *
 * Handles complete transaction creation, signing, and broadcasting flow
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, estimateTransactionSize, calculateFee } from './utils';
import { broadcastTransaction } from './blockchain';
import { RBF_SEQUENCE } from './advancedTx';
import prisma from '../../models/prisma';
import { getElectrumClient } from './electrum';

/**
 * UTXO Selection Strategy
 */
export enum UTXOSelectionStrategy {
  LARGEST_FIRST = 'largest_first',
  SMALLEST_FIRST = 'smallest_first',
  BRANCH_AND_BOUND = 'branch_and_bound', // Most efficient
}

/**
 * Select UTXOs for a transaction
 */
export async function selectUTXOs(
  walletId: string,
  targetAmount: number,
  feeRate: number,
  strategy: UTXOSelectionStrategy = UTXOSelectionStrategy.LARGEST_FIRST,
  selectedUtxoIds?: string[]
): Promise<{
  utxos: Array<{
    id: string;
    txid: string;
    vout: number;
    amount: bigint;
    scriptPubKey: string;
    address: string;
  }>;
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
}> {
  // Get available UTXOs (exclude frozen UTXOs)
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false, // Frozen UTXOs cannot be spent
    },
    orderBy:
      strategy === UTXOSelectionStrategy.LARGEST_FIRST
        ? { amount: 'desc' }
        : { amount: 'asc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Select UTXOs to cover the amount
  const selectedUtxos: typeof utxos = [];
  let totalAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalAmount += Number(utxo.amount);

    // Estimate fee with current selection
    // 2 outputs: recipient + change
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      2,
      'native_segwit'
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    // Check if we have enough
    if (totalAmount >= targetAmount + estimatedFee) {
      const changeAmount = totalAmount - targetAmount - estimatedFee;

      return {
        utxos: selectedUtxos,
        totalAmount,
        estimatedFee,
        changeAmount,
      };
    }
  }

  // Not enough funds
  const finalSize = estimateTransactionSize(selectedUtxos.length, 2, 'native_segwit');
  const finalFee = calculateFee(finalSize, feeRate);

  throw new Error(
    `Insufficient funds. Need ${targetAmount + finalFee} sats, have ${totalAmount} sats`
  );
}

/**
 * Create a transaction
 */
export async function createTransaction(
  walletId: string,
  recipient: string,
  amount: number,
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
    sendMax?: boolean; // Send entire balance (no change output)
    subtractFees?: boolean; // Subtract fees from amount instead of adding
  } = {}
): Promise<{
  psbt: bitcoin.Psbt;
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  inputPaths: string[]; // Derivation paths for hardware wallet signing
  effectiveAmount: number; // The actual amount being sent
}> {
  const { selectedUtxoIds, enableRBF = true, label, memo, sendMax = false, subtractFees = false } = options;

  // Get wallet info
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Validate recipient address
  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  try {
    bitcoin.address.toOutputScript(recipient, networkObj);
  } catch (error) {
    throw new Error('Invalid recipient address');
  }

  // For sendMax, we need to select all UTXOs first, then calculate the amount
  let effectiveAmount = amount;
  let selection;

  if (sendMax) {
    // Select all available UTXOs (or specified ones), excluding frozen UTXOs
    let utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
        frozen: false, // Frozen UTXOs cannot be spent
      },
    });

    // Filter by selected UTXOs if provided (format: "txid:vout")
    if (selectedUtxoIds && selectedUtxoIds.length > 0) {
      utxos = utxos.filter((utxo) =>
        selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
      );
    }

    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs found');
    }

    const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
    // For sendMax, only 1 output (no change)
    const estimatedSize = estimateTransactionSize(utxos.length, 1, 'native_segwit');
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalAmount <= estimatedFee) {
      throw new Error(`Insufficient funds. Total ${totalAmount} sats is not enough to cover fee ${estimatedFee} sats`);
    }

    effectiveAmount = totalAmount - estimatedFee;

    selection = {
      utxos: utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount: 0, // No change for sendMax
    };
  } else if (subtractFees) {
    // Select UTXOs for the full amount, then subtract fee from output
    selection = await selectUTXOs(
      walletId,
      amount,
      feeRate,
      UTXOSelectionStrategy.LARGEST_FIRST,
      selectedUtxoIds
    );
    // Fee is subtracted from the amount being sent
    effectiveAmount = amount - selection.estimatedFee;
    if (effectiveAmount <= 0) {
      throw new Error(`Amount ${amount} sats is not enough to cover fee ${selection.estimatedFee} sats`);
    }
  } else {
    // Normal selection: amount + fee must be covered
    selection = await selectUTXOs(
      walletId,
      amount,
      feeRate,
      UTXOSelectionStrategy.LARGEST_FIRST,
      selectedUtxoIds
    );
  }

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // Add inputs and collect derivation paths
  const sequence = enableRBF ? RBF_SEQUENCE : 0xffffffff;
  const inputPaths: string[] = [];

  // Get addresses with their derivation paths for the UTXOs being spent
  const utxoAddresses = selection.utxos.map(u => u.address);
  const addressRecords = await prisma.address.findMany({
    where: {
      walletId,
      address: { in: utxoAddresses },
    },
    select: {
      address: true,
      derivationPath: true,
    },
  });
  const addressPathMap = new Map(addressRecords.map(a => [a.address, a.derivationPath]));

  for (const utxo of selection.utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, 'hex'),
        value: Number(utxo.amount),
      },
    });

    // Get derivation path for this input (for hardware wallet signing)
    const derivationPath = addressPathMap.get(utxo.address) || '';
    inputPaths.push(derivationPath);
  }

  // Add recipient output
  psbt.addOutput({
    address: recipient,
    value: effectiveAmount,
  });

  // Add change output if needed (skip for sendMax - no change)
  const dustThreshold = 546;
  let changeAddress: string | undefined;

  if (!sendMax && selection.changeAmount >= dustThreshold) {
    // Get or create a change address
    // Note: Address model doesn't distinguish between receive/change in schema
    // We use derivationPath to identify change addresses (path includes '/1/')
    const existingChangeAddress = await prisma.address.findFirst({
      where: {
        walletId,
        used: false,
        derivationPath: {
          contains: '/1/',  // Change addresses use index 1 in BIP44
        },
      },
      orderBy: { index: 'asc' },
    });

    if (existingChangeAddress) {
      changeAddress = existingChangeAddress.address;
    } else {
      // For now, use any unused receiving address as fallback
      // In production, you'd derive a proper change address
      const receivingAddress = await prisma.address.findFirst({
        where: {
          walletId,
          used: false,
        },
        orderBy: { index: 'asc' },
      });

      if (!receivingAddress) {
        throw new Error('No change address available');
      }

      changeAddress = receivingAddress.address;
    }

    psbt.addOutput({
      address: changeAddress,
      value: selection.changeAmount,
    });
  }

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: selection.estimatedFee,
    totalInput: selection.totalAmount,
    totalOutput: effectiveAmount + (sendMax ? 0 : (selection.changeAmount >= dustThreshold ? selection.changeAmount : 0)),
    changeAmount: sendMax ? 0 : selection.changeAmount,
    changeAddress,
    utxos: selection.utxos.map((u) => ({ txid: u.txid, vout: u.vout })),
    inputPaths,
    effectiveAmount, // The actual amount being sent (may differ from requested if sendMax or subtractFees)
  };
}

/**
 * Broadcast a signed transaction and save to database
 */
export async function broadcastAndSave(
  walletId: string,
  signedPsbtBase64: string,
  metadata: {
    recipient: string;
    amount: number;
    fee: number;
    label?: string;
    memo?: string;
    utxos: Array<{ txid: string; vout: number }>;
  }
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  // Parse signed PSBT
  const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64);

  // Finalize and extract transaction
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const rawTx = tx.toHex();
  const txid = tx.getId();

  // Broadcast to network
  const broadcastResult = await broadcastTransaction(rawTx);

  if (!broadcastResult.broadcasted) {
    throw new Error('Failed to broadcast transaction');
  }

  // Mark UTXOs as spent
  for (const utxo of metadata.utxos) {
    await prisma.uTXO.update({
      where: {
        txid_vout: {
          txid: utxo.txid,
          vout: utxo.vout,
        },
      },
      data: {
        spent: true,
      },
    });
  }

  // Save transaction to database
  await prisma.transaction.create({
    data: {
      txid,
      walletId,
      type: 'sent',
      amount: BigInt(metadata.amount),
      fee: BigInt(metadata.fee),
      confirmations: 0,
      label: metadata.label,
      memo: metadata.memo,
      blockHeight: null,
      blockTime: null,
    },
  });

  return {
    txid,
    broadcasted: true,
  };
}

/**
 * Create and broadcast a transaction in one step
 * (For software wallets with keys in memory - NOT RECOMMENDED for production)
 */
export async function createAndBroadcastTransaction(
  walletId: string,
  recipient: string,
  amount: number,
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
  } = {}
): Promise<{
  txid: string;
  broadcasted: boolean;
  fee: number;
}> {
  // Create transaction
  const txData = await createTransaction(
    walletId,
    recipient,
    amount,
    feeRate,
    options
  );

  // Note: In production, you would NOT sign here
  // Hardware wallets should sign the PSBT
  // This is just a placeholder for the flow

  throw new Error(
    'Automatic signing not implemented. Use hardware wallet to sign PSBT.'
  );
}

/**
 * Estimate transaction details before creating
 */
export async function estimateTransaction(
  walletId: string,
  recipient: string,
  amount: number,
  feeRate: number,
  selectedUtxoIds?: string[]
): Promise<{
  fee: number;
  totalCost: number;
  inputCount: number;
  outputCount: number;
  changeAmount: number;
  sufficient: boolean;
  error?: string;
}> {
  try {
    const selection = await selectUTXOs(
      walletId,
      amount,
      feeRate,
      UTXOSelectionStrategy.LARGEST_FIRST,
      selectedUtxoIds
    );

    const outputCount = selection.changeAmount >= 546 ? 2 : 1;

    return {
      fee: selection.estimatedFee,
      totalCost: amount + selection.estimatedFee,
      inputCount: selection.utxos.length,
      outputCount,
      changeAmount: selection.changeAmount,
      sufficient: true,
    };
  } catch (error: any) {
    return {
      fee: 0,
      totalCost: amount,
      inputCount: 0,
      outputCount: 1,
      changeAmount: 0,
      sufficient: false,
      error: error.message,
    };
  }
}

/**
 * Output definition for batch transactions
 */
export interface TransactionOutput {
  address: string;
  amount: number;
  sendMax?: boolean; // If true, allocate remaining balance to this output
}

/**
 * Create a batch transaction with multiple outputs
 */
export async function createBatchTransaction(
  walletId: string,
  outputs: TransactionOutput[],
  feeRate: number,
  options: {
    selectedUtxoIds?: string[];
    enableRBF?: boolean;
    label?: string;
    memo?: string;
  } = {}
): Promise<{
  psbt: bitcoin.Psbt;
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  inputPaths: string[];
  outputs: Array<{ address: string; amount: number }>;
}> {
  const { selectedUtxoIds, enableRBF = true } = options;

  // Get wallet info
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  if (outputs.length === 0) {
    throw new Error('At least one output is required');
  }

  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Validate all output addresses
  for (const output of outputs) {
    try {
      bitcoin.address.toOutputScript(output.address, networkObj);
    } catch (error) {
      throw new Error(`Invalid address: ${output.address}`);
    }
  }

  // Check if any output has sendMax
  const sendMaxOutputIndex = outputs.findIndex(o => o.sendMax);
  const hasSendMax = sendMaxOutputIndex !== -1;

  // Get available UTXOs
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
    orderBy: { amount: 'desc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Calculate total available
  const totalAvailable = utxos.reduce((sum, u) => sum + Number(u.amount), 0);

  // Calculate fixed output amounts (non-sendMax outputs)
  const fixedOutputTotal = outputs
    .filter((_, i) => i !== sendMaxOutputIndex)
    .reduce((sum, o) => sum + o.amount, 0);

  // Determine number of outputs: specified outputs + possible change
  // For sendMax, no change output; otherwise include change
  const numOutputs = hasSendMax ? outputs.length : outputs.length + 1;

  // Estimate fee
  const estimatedSize = estimateTransactionSize(utxos.length, numOutputs, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  // Calculate sendMax amount if applicable
  let finalOutputs: Array<{ address: string; amount: number }>;
  let changeAmount = 0;

  if (hasSendMax) {
    // Calculate remaining balance for sendMax output
    const sendMaxAmount = totalAvailable - fixedOutputTotal - estimatedFee;
    if (sendMaxAmount <= 0) {
      throw new Error(
        `Insufficient funds. Need ${fixedOutputTotal + estimatedFee} sats for outputs and fee, have ${totalAvailable} sats`
      );
    }

    finalOutputs = outputs.map((o, i) => ({
      address: o.address,
      amount: i === sendMaxOutputIndex ? sendMaxAmount : o.amount,
    }));
  } else {
    // Normal batch: select UTXOs to cover all outputs + fee
    const targetAmount = fixedOutputTotal;
    const selectedUtxos: typeof utxos = [];
    let selectedTotal = 0;

    for (const utxo of utxos) {
      selectedUtxos.push(utxo);
      selectedTotal += Number(utxo.amount);

      // Re-estimate fee with current selection
      const currentSize = estimateTransactionSize(selectedUtxos.length, outputs.length + 1, 'native_segwit');
      const currentFee = calculateFee(currentSize, feeRate);

      if (selectedTotal >= targetAmount + currentFee) {
        changeAmount = selectedTotal - targetAmount - currentFee;
        utxos = selectedUtxos; // Use only selected UTXOs
        break;
      }
    }

    // Check if we have enough
    const finalSize = estimateTransactionSize(utxos.length, outputs.length + 1, 'native_segwit');
    const finalFee = calculateFee(finalSize, feeRate);
    if (selectedTotal < targetAmount + finalFee) {
      throw new Error(
        `Insufficient funds. Need ${targetAmount + finalFee} sats, have ${selectedTotal} sats`
      );
    }

    finalOutputs = outputs.map(o => ({
      address: o.address,
      amount: o.amount,
    }));
  }

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: networkObj });
  const sequence = enableRBF ? RBF_SEQUENCE : 0xffffffff;
  const inputPaths: string[] = [];

  // Get derivation paths for inputs
  const utxoAddresses = utxos.map(u => u.address);
  const addressRecords = await prisma.address.findMany({
    where: {
      walletId,
      address: { in: utxoAddresses },
    },
    select: {
      address: true,
      derivationPath: true,
    },
  });
  const addressPathMap = new Map(addressRecords.map(a => [a.address, a.derivationPath]));

  // Add inputs
  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey || '', 'hex'),
        value: Number(utxo.amount),
      },
    });
    inputPaths.push(addressPathMap.get(utxo.address) || '');
  }

  // Add recipient outputs
  for (const output of finalOutputs) {
    psbt.addOutput({
      address: output.address,
      value: output.amount,
    });
  }

  // Add change output if needed
  const dustThreshold = 546;
  let changeAddress: string | undefined;

  if (!hasSendMax && changeAmount >= dustThreshold) {
    const existingChangeAddress = await prisma.address.findFirst({
      where: {
        walletId,
        used: false,
        derivationPath: { contains: '/1/' },
      },
      orderBy: { index: 'asc' },
    });

    if (existingChangeAddress) {
      changeAddress = existingChangeAddress.address;
    } else {
      const receivingAddress = await prisma.address.findFirst({
        where: { walletId, used: false },
        orderBy: { index: 'asc' },
      });
      if (!receivingAddress) {
        throw new Error('No change address available');
      }
      changeAddress = receivingAddress.address;
    }

    psbt.addOutput({
      address: changeAddress,
      value: changeAmount,
    });
  }

  const totalInput = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  const totalOutput = finalOutputs.reduce((sum, o) => sum + o.amount, 0) + (changeAmount >= dustThreshold ? changeAmount : 0);

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: estimatedFee,
    totalInput,
    totalOutput,
    changeAmount: hasSendMax ? 0 : changeAmount,
    changeAddress,
    utxos: utxos.map(u => ({ txid: u.txid, vout: u.vout })),
    inputPaths,
    outputs: finalOutputs,
  };
}

/**
 * Get transaction hex from PSBT for hardware wallet display
 */
export function getPSBTInfo(psbtBase64: string): {
  inputs: Array<{
    txid: string;
    vout: number;
    value: number;
  }>;
  outputs: Array<{
    address?: string;
    value: number;
    isChange: boolean;
  }>;
  fee: number;
} {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

  // Get inputs
  const inputs = psbt.data.inputs.map((input, index) => {
    const txInput = psbt.txInputs[index];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const vout = txInput.index;
    const value = input.witnessUtxo?.value || 0;

    return { txid, vout, value };
  });

  // Get outputs
  const outputs = psbt.txOutputs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(
        output.script,
        bitcoin.networks.bitcoin
      );
    } catch (e) {
      // Some outputs might not have addresses (e.g., OP_RETURN)
    }

    return {
      address,
      value: output.value,
      isChange: false, // Would need wallet context to determine this
    };
  });

  // Calculate fee
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0);
  const totalOutput = outputs.reduce((sum, output) => sum + output.value, 0);
  const fee = totalInput - totalOutput;

  return {
    inputs,
    outputs,
    fee,
  };
}
