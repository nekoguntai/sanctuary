/**
 * Transaction Service
 *
 * Handles complete transaction creation, signing, and broadcasting flow
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import { getNetwork, estimateTransactionSize, calculateFee } from './utils';
import { broadcastTransaction, recalculateWalletBalances } from './blockchain';
import { RBF_SEQUENCE } from './advancedTx';
import prisma from '../../models/prisma';
import { getElectrumClient } from './electrum';
import { parseDescriptor } from './addressDerivation';
import { getNodeClient } from './nodeClient';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DUST_THRESHOLD } from '../../constants';
import { unlockUtxosForDraft } from '../draftLockService';
import { createLogger } from '../../utils/logger';

const log = createLogger('TRANSACTION');


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
 * Check if a script type is legacy (requires nonWitnessUtxo)
 * Legacy P2PKH wallets use full previous transactions instead of witnessUtxo
 */
function isLegacyScriptType(scriptType: string | null): boolean {
  return scriptType === 'legacy' || scriptType === 'p2pkh' || scriptType === 'P2PKH';
}

/**
 * Fetch raw transaction hex for nonWitnessUtxo (required for legacy inputs)
 */
async function getRawTransactionHex(txid: string): Promise<string> {
  const client = await getNodeClient();
  // getTransaction with verbose=false returns raw hex
  const rawHex = await client.getTransaction(txid, false);
  return rawHex;
}

// Initialize BIP32 for key derivation
const bip32 = BIP32Factory(ecc);

// Initialize ECC for bitcoinjs-lib (required for Taproot)
bitcoin.initEccLib(ecc);

/**
 * Generate realistic-looking decoy amounts from a total change amount
 * Amounts avoid round numbers and vary in magnitude to look like real payments
 */
function generateDecoyAmounts(totalChange: number, count: number, dustThreshold: number): number[] {
  if (count < 2) {
    return [totalChange];
  }

  // Reserve dust threshold for each output
  const minPerOutput = dustThreshold;
  const usableChange = totalChange - (minPerOutput * count);

  if (usableChange <= 0) {
    // Not enough change to split into decoys, return single output
    return [totalChange];
  }

  // Generate random weights for splitting
  const weights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < count; i++) {
    // Use varied weight ranges to create different sized outputs
    // Some outputs will be larger, some smaller
    const weight = 0.3 + Math.random() * 0.7; // 0.3 to 1.0
    weights.push(weight);
    totalWeight += weight;
  }

  // Distribute change according to weights
  const amounts: number[] = [];
  let remaining = totalChange;

  for (let i = 0; i < count - 1; i++) {
    // Calculate proportional amount
    let amount = Math.floor((weights[i] / totalWeight) * usableChange) + minPerOutput;

    // Add small random variation to avoid patterns (+/- up to 3%)
    const variation = Math.floor(amount * (Math.random() * 0.06 - 0.03));
    amount += variation;

    // Ensure minimum threshold
    amount = Math.max(amount, minPerOutput);

    // Don't exceed remaining
    if (amount >= remaining - minPerOutput) {
      amount = Math.floor(remaining / 2);
    }

    amounts.push(amount);
    remaining -= amount;
  }

  // Last output gets the remainder
  amounts.push(remaining);

  // Shuffle the amounts so the largest isn't predictably in a certain position
  for (let i = amounts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
  }

  return amounts;
}

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
  // Get confirmation threshold setting
  const thresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: 'confirmationThreshold' },
  });
  const confirmationThreshold = thresholdSetting
    ? JSON.parse(thresholdSetting.value)
    : DEFAULT_CONFIRMATION_THRESHOLD;

  // Get available UTXOs (exclude frozen, unconfirmed, and locked-by-draft UTXOs)
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false, // Frozen UTXOs cannot be spent
      confirmations: { gte: confirmationThreshold }, // Must have enough confirmations
      // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
      ...(selectedUtxoIds && selectedUtxoIds.length > 0
        ? {} // Don't filter locks if user selected specific UTXOs
        : { draftLock: null }), // Auto-selection: exclude locked UTXOs
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
    decoyOutputs?: {
      enabled: boolean;
      count: number; // 2-4 additional outputs
    };
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
  decoyOutputs?: Array<{ address: string; amount: number }>; // Decoy change outputs
}> {
  const { selectedUtxoIds, enableRBF = true, label, memo, sendMax = false, subtractFees = false, decoyOutputs } = options;

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet info including devices (for fingerprint)
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  console.log('[TransactionService] createTransaction - walletId:', walletId, 'scriptType:', wallet.scriptType);

  // Validate recipient address
  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Get wallet fingerprint and xpub for BIP32 derivation info
  // For single-sig wallets, get from the first associated device
  // For multi-sig, this is more complex (not yet fully supported)
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;

  if (wallet.devices && wallet.devices.length > 0) {
    const primaryDevice = wallet.devices[0].device;
    if (primaryDevice.fingerprint) {
      masterFingerprint = Buffer.from(primaryDevice.fingerprint, 'hex');
    }
    if (primaryDevice.xpub) {
      accountXpub = primaryDevice.xpub;
    }
  } else if (wallet.fingerprint) {
    // Fallback to wallet fingerprint if available
    masterFingerprint = Buffer.from(wallet.fingerprint, 'hex');
  }

  // Try to get xpub from descriptor if not from device
  if (!accountXpub && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.xpub) {
        accountXpub = parsed.xpub;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

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
    // When subtracting fees, we only need UTXOs to cover the amount (fee comes out of it)
    // Select UTXOs manually without requiring amount + fee coverage
    let utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
        frozen: false,
      },
      orderBy: { amount: 'desc' },
    });

    if (selectedUtxoIds && selectedUtxoIds.length > 0) {
      utxos = utxos.filter((utxo) =>
        selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
      );
    }

    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs available');
    }

    // Select UTXOs to cover just the amount
    const selectedUtxos: typeof utxos = [];
    let totalAmount = 0;

    for (const utxo of utxos) {
      selectedUtxos.push(utxo);
      totalAmount += Number(utxo.amount);

      if (totalAmount >= amount) {
        break;
      }
    }

    if (totalAmount < amount) {
      throw new Error(`Insufficient funds. Have ${totalAmount} sats, need ${amount} sats`);
    }

    // Calculate fee based on actual selection
    const estimatedSize = estimateTransactionSize(selectedUtxos.length, 2, 'native_segwit');
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    // Fee is subtracted from the amount being sent
    effectiveAmount = amount - estimatedFee;
    if (effectiveAmount <= dustThreshold) {
      throw new Error(`Amount ${amount} sats is not enough to cover fee ${estimatedFee} sats (would leave ${effectiveAmount} sats)`);
    }

    // Calculate change
    const changeAmount = totalAmount - amount;

    selection = {
      utxos: selectedUtxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount,
    };
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

  // Parse account xpub for deriving public keys
  let accountNode: ReturnType<typeof bip32.fromBase58> | undefined;
  if (accountXpub) {
    try {
      accountNode = bip32.fromBase58(accountXpub, networkObj);
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // Check if this is a legacy wallet (requires nonWitnessUtxo)
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // For legacy wallets, we need to fetch raw transactions for nonWitnessUtxo
  const rawTxCache: Map<string, Buffer> = new Map();
  if (isLegacy) {
    // Fetch all raw transactions in parallel
    const uniqueTxids = Array.from(new Set(selection.utxos.map(u => u.txid)));
    const rawTxPromises = uniqueTxids.map(async (txid: string) => {
      const rawHex = await getRawTransactionHex(txid);
      return { txid, rawTx: Buffer.from(rawHex, 'hex') };
    });
    const rawTxResults = await Promise.all(rawTxPromises);
    rawTxResults.forEach(({ txid, rawTx }) => rawTxCache.set(txid, rawTx));
  }

  for (const utxo of selection.utxos) {
    const derivationPath = addressPathMap.get(utxo.address) || '';
    inputPaths.push(derivationPath);

    // Build base input data
    // Legacy (P2PKH) requires nonWitnessUtxo (full previous tx)
    // SegWit (P2WPKH, P2SH-P2WPKH, P2TR) uses witnessUtxo
    const inputOptions: Parameters<typeof psbt.addInput>[0] = {
      hash: utxo.txid,
      index: utxo.vout,
      sequence,
    };

    if (isLegacy) {
      // Legacy: use nonWitnessUtxo (full previous transaction)
      const rawTx = rawTxCache.get(utxo.txid);
      if (rawTx) {
        inputOptions.nonWitnessUtxo = rawTx;
      } else {
        throw new Error(`Failed to fetch raw transaction for ${utxo.txid}`);
      }
    } else {
      // SegWit: use witnessUtxo (just the output script and value)
      inputOptions.witnessUtxo = {
        script: Buffer.from(utxo.scriptPubKey, 'hex'),
        value: Number(utxo.amount),
      };
    }

    psbt.addInput(inputOptions);

    // Add BIP32 derivation info if we have the master fingerprint
    if (masterFingerprint && derivationPath && accountNode) {
      try {
        // Parse the derivation path
        const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);

        // For BIP44/49/84/86, account path is first 3 levels (purpose'/coin'/account')
        // Address derivation is the remaining levels (change/index)
        // The accountNode is at the account level, so we derive from there
        let pubkeyNode = accountNode;

        // Find where the account path ends (after 3 hardened levels)
        let accountPathEnd = 0;
        for (let i = 0; i < pathParts.length && i < 3; i++) {
          if (pathParts[i].endsWith("'") || pathParts[i].endsWith('h')) {
            accountPathEnd = i + 1;
          }
        }

        // Derive from account node using the remaining path (change/index)
        for (let i = accountPathEnd; i < pathParts.length; i++) {
          const part = pathParts[i];
          const idx = parseInt(part.replace(/['h]/g, ''), 10);
          pubkeyNode = pubkeyNode.derive(idx);
        }

        if (pubkeyNode.publicKey) {
          // Update input with bip32Derivation using the correct path format (string)
          psbt.updateInput(inputPaths.length - 1, {
            bip32Derivation: [{
              masterFingerprint,
              path: derivationPath,
              pubkey: pubkeyNode.publicKey,
            }],
          });
        }
      } catch (e) {
        // Skip BIP32 derivation if we can't derive the key
      }
    }
  }

  // Add recipient output
  psbt.addOutput({
    address: recipient,
    value: effectiveAmount,
  });

  // Add change output(s) if needed (skip for sendMax - no change)
  let changeAddress: string | undefined;
  let decoyOutputsResult: Array<{ address: string; amount: number }> | undefined;
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  if (!sendMax && selection.changeAmount >= dustThreshold) {
    // Determine number of change outputs needed
    const useDecoys = decoyOutputs?.enabled && decoyOutputs.count >= 2;
    const numChangeOutputs = useDecoys ? Math.min(Math.max(decoyOutputs.count, 2), 4) : 1;

    // If using decoys, recalculate fee for extra outputs
    // Each additional P2WPKH output adds ~34 vBytes
    if (useDecoys && numChangeOutputs > 1) {
      const extraOutputs = numChangeOutputs - 1;
      const extraVbytes = extraOutputs * 34;
      const extraFee = Math.ceil(extraVbytes * feeRate);

      // Recalculate change after accounting for extra fee
      actualFee = selection.estimatedFee + extraFee;
      actualChangeAmount = selection.totalAmount - effectiveAmount - actualFee;

      // If change is now below threshold, fall back to single output
      if (actualChangeAmount < dustThreshold * numChangeOutputs) {
        // Not enough change for decoys, use single output
        actualFee = selection.estimatedFee;
        actualChangeAmount = selection.changeAmount;
      }
    }

    // Check if we still have enough for decoys after fee adjustment
    const canUseDecoys = useDecoys && actualChangeAmount >= dustThreshold * numChangeOutputs;

    if (canUseDecoys) {
      // Get multiple unused change addresses
      const changeAddresses = await prisma.address.findMany({
        where: {
          walletId,
          used: false,
          derivationPath: {
            contains: '/1/', // Change addresses use index 1 in BIP44
          },
        },
        orderBy: { index: 'asc' },
        take: numChangeOutputs,
      });

      // Fallback to receiving addresses if not enough change addresses
      if (changeAddresses.length < numChangeOutputs) {
        const additionalNeeded = numChangeOutputs - changeAddresses.length;
        const receivingAddresses = await prisma.address.findMany({
          where: {
            walletId,
            used: false,
            address: { notIn: changeAddresses.map(a => a.address) },
          },
          orderBy: { index: 'asc' },
          take: additionalNeeded,
        });
        changeAddresses.push(...receivingAddresses);
      }

      if (changeAddresses.length < numChangeOutputs) {
        throw new Error(`Not enough change addresses for ${numChangeOutputs} decoy outputs`);
      }

      // Generate decoy amounts
      const amounts = generateDecoyAmounts(actualChangeAmount, numChangeOutputs, dustThreshold);

      // Shuffle addresses too for additional obfuscation
      const shuffledAddresses = [...changeAddresses];
      for (let i = shuffledAddresses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledAddresses[i], shuffledAddresses[j]] = [shuffledAddresses[j], shuffledAddresses[i]];
      }

      // Add all change outputs
      decoyOutputsResult = [];
      for (let i = 0; i < numChangeOutputs; i++) {
        const addr = shuffledAddresses[i].address;
        const amt = amounts[i];

        psbt.addOutput({
          address: addr,
          value: amt,
        });

        decoyOutputsResult.push({ address: addr, amount: amt });

        // Set the primary change address to the first one (for backward compatibility)
        if (i === 0) {
          changeAddress = addr;
        }
      }

      log.info(`Created ${numChangeOutputs} decoy change outputs for wallet ${walletId}`);
    } else {
      // Single change output (no decoys or not enough change)
      const existingChangeAddress = await prisma.address.findFirst({
        where: {
          walletId,
          used: false,
          derivationPath: {
            contains: '/1/', // Change addresses use index 1 in BIP44
          },
        },
        orderBy: { index: 'asc' },
      });

      if (existingChangeAddress) {
        changeAddress = existingChangeAddress.address;
      } else {
        // Fallback to any unused receiving address
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
        value: actualChangeAmount,
      });
    }
  }

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: actualFee,
    totalInput: selection.totalAmount,
    totalOutput: effectiveAmount + (sendMax ? 0 : (actualChangeAmount >= dustThreshold ? actualChangeAmount : 0)),
    changeAmount: sendMax ? 0 : actualChangeAmount,
    changeAddress,
    utxos: selection.utxos.map((u) => ({ txid: u.txid, vout: u.vout })),
    inputPaths,
    effectiveAmount, // The actual amount being sent (may differ from requested if sendMax or subtractFees)
    decoyOutputs: decoyOutputsResult, // Decoy change outputs (if enabled)
  };
}

/**
 * Broadcast a signed transaction and save to database
 * Supports two modes:
 * 1. signedPsbtBase64: Extract and broadcast from signed PSBT (Ledger, file upload)
 * 2. rawTxHex: Broadcast raw transaction hex directly (Trezor)
 */
export async function broadcastAndSave(
  walletId: string,
  signedPsbtBase64: string | undefined,
  metadata: {
    recipient: string;
    amount: number;
    fee: number;
    label?: string;
    memo?: string;
    utxos: Array<{ txid: string; vout: number }>;
    rawTxHex?: string; // For Trezor: fully signed raw transaction hex
    draftId?: string; // If broadcasting from a draft, release UTXO locks
  }
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  let rawTx: string;
  let txid: string;

  if (metadata.rawTxHex) {
    // Trezor path: Use raw transaction hex directly
    rawTx = metadata.rawTxHex;
    // Parse the transaction to get the txid
    const tx = bitcoin.Transaction.fromHex(rawTx);
    txid = tx.getId();
  } else if (signedPsbtBase64) {
    // Ledger/file upload path: Extract from signed PSBT
    const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64);

    // Check if all inputs are already finalized (e.g., from hardware wallet signing)
    const allFinalized = psbt.data.inputs.every(
      (input) => input.finalScriptSig || input.finalScriptWitness
    );

    // Only finalize if not already finalized
    if (!allFinalized) {
      psbt.finalizeAllInputs();
    }
    const tx = psbt.extractTransaction();
    rawTx = tx.toHex();
    txid = tx.getId();
  } else {
    throw new Error('Either signedPsbtBase64 or rawTxHex is required');
  }

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

  // Release UTXO locks if broadcasting from a draft
  if (metadata.draftId) {
    const unlockedCount = await unlockUtxosForDraft(metadata.draftId);
    if (unlockedCount > 0) {
      log.debug(`Released ${unlockedCount} UTXO locks for draft ${metadata.draftId}`);
    }
  }

  // Check if recipient is a wallet address (consolidation) or external (sent)
  const isConsolidation = await prisma.address.findFirst({
    where: {
      walletId,
      address: metadata.recipient,
    },
  });

  // Check if this is an RBF transaction (memo starts with "Replacing transaction ")
  let replacementForTxid: string | undefined;
  let labelToUse = metadata.label;
  let memoToUse = metadata.memo;

  if (metadata.memo && metadata.memo.startsWith('Replacing transaction ')) {
    // Extract original txid from memo
    replacementForTxid = metadata.memo.replace('Replacing transaction ', '').trim();

    // Find the original transaction
    const originalTx = await prisma.transaction.findFirst({
      where: {
        txid: replacementForTxid,
        walletId,
      },
    });

    if (originalTx) {
      // Mark original transaction as replaced
      await prisma.transaction.update({
        where: { id: originalTx.id },
        data: {
          rbfStatus: 'replaced',
          replacedByTxid: txid,
        },
      });

      // Copy label from original if not already set
      if (!labelToUse && originalTx.label) {
        labelToUse = originalTx.label;
      }
    }
  }

  // Save transaction to database
  const txType = isConsolidation ? 'consolidation' : 'sent';
  await prisma.transaction.create({
    data: {
      txid,
      walletId,
      type: txType,
      amount: BigInt(metadata.amount),
      fee: BigInt(metadata.fee),
      confirmations: 0,
      label: labelToUse,
      memo: memoToUse,
      blockHeight: null,
      blockTime: null,
      replacementForTxid,
      rbfStatus: 'active',
    },
  });

  // Recalculate running balances for all transactions in this wallet
  await recalculateWalletBalances(walletId);

  // Send notifications for the broadcast transaction (Telegram + Push)
  // This is async and fire-and-forget to not block the response
  import('../notifications/notificationService').then(({ notifyNewTransactions }) => {
    notifyNewTransactions(walletId, [{
      txid,
      type: txType,
      amount: BigInt(metadata.amount),
    }]).catch(err => {
      // Log but don't fail the broadcast
      console.warn(`[TRANSACTION] Failed to send notifications: ${err}`);
    });
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
    const dustThreshold = await getDustThreshold();
    const selection = await selectUTXOs(
      walletId,
      amount,
      feeRate,
      UTXOSelectionStrategy.LARGEST_FIRST,
      selectedUtxoIds
    );

    const outputCount = selection.changeAmount >= dustThreshold ? 2 : 1;

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

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get wallet info including devices (for fingerprint)
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  if (outputs.length === 0) {
    throw new Error('At least one output is required');
  }

  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Get wallet fingerprint and xpub for BIP32 derivation info
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;

  if (wallet.devices && wallet.devices.length > 0) {
    const primaryDevice = wallet.devices[0].device;
    if (primaryDevice.fingerprint) {
      masterFingerprint = Buffer.from(primaryDevice.fingerprint, 'hex');
    }
    if (primaryDevice.xpub) {
      accountXpub = primaryDevice.xpub;
    }
  } else if (wallet.fingerprint) {
    masterFingerprint = Buffer.from(wallet.fingerprint, 'hex');
  }

  if (!accountXpub && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.xpub) {
        accountXpub = parsed.xpub;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

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

  // Parse account xpub for deriving public keys
  let accountNode: ReturnType<typeof bip32.fromBase58> | undefined;
  if (accountXpub) {
    try {
      accountNode = bip32.fromBase58(accountXpub, networkObj);
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // Check if this is a legacy wallet (requires nonWitnessUtxo)
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // For legacy wallets, we need to fetch raw transactions for nonWitnessUtxo
  const rawTxCache: Map<string, Buffer> = new Map();
  if (isLegacy) {
    const uniqueTxids = [...new Set(utxos.map(u => u.txid))];
    const rawTxPromises = uniqueTxids.map(async (txid) => {
      const rawHex = await getRawTransactionHex(txid);
      return { txid, rawTx: Buffer.from(rawHex, 'hex') };
    });
    const rawTxResults = await Promise.all(rawTxPromises);
    rawTxResults.forEach(({ txid, rawTx }) => rawTxCache.set(txid, rawTx));
  }

  // Add inputs with BIP32 derivation info
  for (const utxo of utxos) {
    const derivationPath = addressPathMap.get(utxo.address) || '';
    inputPaths.push(derivationPath);

    const inputOptions: Parameters<typeof psbt.addInput>[0] = {
      hash: utxo.txid,
      index: utxo.vout,
      sequence,
    };

    if (isLegacy) {
      // Legacy: use nonWitnessUtxo (full previous transaction)
      const rawTx = rawTxCache.get(utxo.txid);
      if (rawTx) {
        inputOptions.nonWitnessUtxo = rawTx;
      } else {
        throw new Error(`Failed to fetch raw transaction for ${utxo.txid}`);
      }
    } else {
      // SegWit: use witnessUtxo
      inputOptions.witnessUtxo = {
        script: Buffer.from(utxo.scriptPubKey || '', 'hex'),
        value: Number(utxo.amount),
      };
    }

    psbt.addInput(inputOptions);

    // Add BIP32 derivation info if we have the master fingerprint
    if (masterFingerprint && derivationPath && accountNode) {
      try {
        const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);
        let pubkeyNode = accountNode;

        // Find where the account path ends (after 3 hardened levels)
        let accountPathEnd = 0;
        for (let i = 0; i < pathParts.length && i < 3; i++) {
          if (pathParts[i].endsWith("'") || pathParts[i].endsWith('h')) {
            accountPathEnd = i + 1;
          }
        }

        // Derive from account node using the remaining path (change/index)
        for (let i = accountPathEnd; i < pathParts.length; i++) {
          const part = pathParts[i];
          const idx = parseInt(part.replace(/['h]/g, ''), 10);
          pubkeyNode = pubkeyNode.derive(idx);
        }

        if (pubkeyNode.publicKey) {
          psbt.updateInput(inputPaths.length - 1, {
            bip32Derivation: [{
              masterFingerprint,
              path: derivationPath,
              pubkey: pubkeyNode.publicKey,
            }],
          });
        }
      } catch (e) {
        // Skip BIP32 derivation if we can't derive the key
      }
    }
  }

  // Add recipient outputs
  for (const output of finalOutputs) {
    psbt.addOutput({
      address: output.address,
      value: output.amount,
    });
  }

  // Add change output if needed
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
