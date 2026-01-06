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
import { parseDescriptor, convertToStandardXpub, MultisigKeyInfo } from './addressDerivation';
import { getNodeClient } from './nodeClient';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DUST_THRESHOLD } from '../../constants';
import { unlockUtxosForDraft } from '../draftLockService';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { eventService } from '../eventService';
import { mapWithConcurrency } from '../../utils/async';
import { transactionBroadcastsTotal } from '../../observability/metrics';
import { safeJsonParse, SystemSettingSchemas } from '../../utils/safeJson';

const log = createLogger('TRANSACTION');


/**
 * Get dust threshold from system settings
 */
async function getDustThreshold(): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'dustThreshold' },
  });
  return safeJsonParse(setting?.value, SystemSettingSchemas.number, DEFAULT_DUST_THRESHOLD, 'dustThreshold');
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
 * BIP32 derivation entry for PSBT inputs/outputs
 */
interface Bip32DerivationEntry {
  masterFingerprint: Buffer;
  path: string;
  pubkey: Buffer;
}

/**
 * Build BIP32 derivation entries for all cosigners in a multisig wallet.
 *
 * This function creates the bip32Derivation field data needed for hardware wallets
 * to identify which keys belong to them when signing multisig transactions.
 *
 * For each cosigner in the multisig, it:
 * 1. Derives the public key at the address path (change/index) from their xpub
 * 2. Constructs the full derivation path (m/{accountPath}/{change}/{index})
 * 3. Returns the fingerprint, path, and derived pubkey
 *
 * @param derivationPath - Full derivation path for the address (e.g., "m/48'/0'/0'/2'/0/5")
 * @param multisigKeys - Array of cosigner key info from parsed descriptor
 * @param network - Bitcoin network object
 * @param inputIndex - Optional input index for logging
 * @returns Array of bip32Derivation entries, or empty array on failure
 */
/**
 * Normalize derivation path to use apostrophe notation for hardened paths.
 * bitcoinjs-lib only recognizes ' notation, not 'h' notation, when encoding PSBT bip32Derivation.
 * Using 'h' notation causes the hardened flag to be lost during PSBT serialization.
 */
function normalizeHardenedPath(path: string): string {
  return path.replace(/h/g, "'");
}

/**
 * Extract change index and address index from a derivation path.
 * For BIP-48: purpose'/coin'/account'/script'/change/index
 * The last two non-hardened parts are change and index.
 */
function extractChangeAndAddressIndex(derivationPath: string): { changeIdx: number; addressIdx: number } {
  const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);
  // The last two parts are change and index (non-hardened)
  const changeIdx = pathParts.length >= 2
    ? parseInt(pathParts[pathParts.length - 2].replace(/['h]/g, ''), 10)
    : 0;
  const addressIdx = pathParts.length >= 1
    ? parseInt(pathParts[pathParts.length - 1].replace(/['h]/g, ''), 10)
    : 0;
  return { changeIdx, addressIdx };
}

export function buildMultisigBip32Derivations(
  derivationPath: string,
  multisigKeys: MultisigKeyInfo[],
  network: bitcoin.Network,
  inputIndex?: number
): Bip32DerivationEntry[] {
  try {
    // Extract change/index from the derivation path (e.g., m/48'/0'/0'/2'/0/5 -> 0, 5)
    const { changeIdx, addressIdx } = extractChangeAndAddressIndex(derivationPath);

    const bip32Derivations: Bip32DerivationEntry[] = [];

    for (const keyInfo of multisigKeys) {
      try {
        // Convert xpub to standard format and create BIP32 node
        const standardXpub = convertToStandardXpub(keyInfo.xpub);
        const keyNode = bip32.fromBase58(standardXpub, network);

        // Derive at change/index level from this key's xpub
        const derivedNode = keyNode.derive(changeIdx).derive(addressIdx);

        if (derivedNode.publicKey) {
          // Build full path for this key: m/{accountPath}/{change}/{index}
          // Normalize to apostrophe notation for PSBT compatibility
          const fullPath = normalizeHardenedPath(`m/${keyInfo.accountPath}/${changeIdx}/${addressIdx}`);

          bip32Derivations.push({
            masterFingerprint: Buffer.from(keyInfo.fingerprint, 'hex'),
            path: fullPath,
            pubkey: derivedNode.publicKey,
          });

          log.debug('Multisig bip32Derivation added', {
            inputIndex,
            fingerprint: keyInfo.fingerprint,
            path: fullPath,
            pubkeyPrefix: derivedNode.publicKey.toString('hex').substring(0, 16),
          });
        }
      } catch (keyError) {
        log.warn('Failed to derive key for multisig input', {
          inputIndex,
          fingerprint: keyInfo.fingerprint,
          error: (keyError as Error).message,
        });
      }
    }

    if (bip32Derivations.length > 0) {
      log.info('Multisig BIP32 derivations built', {
        inputIndex,
        derivationCount: bip32Derivations.length,
        fingerprints: bip32Derivations.map(d => d.masterFingerprint.toString('hex')),
      });
    }

    return bip32Derivations;
  } catch (e) {
    log.warn('Multisig BIP32 derivation failed', {
      inputIndex,
      error: (e as Error).message,
    });
    return [];
  }
}

/**
 * Build the witnessScript (multisig redeem script) for a P2WSH multisig input.
 *
 * Hardware wallets require the witnessScript to:
 * 1. Verify the scriptPubKey matches (witnessUtxo contains P2WSH hash of witnessScript)
 * 2. Know what they're signing (m-of-n with which public keys)
 *
 * @param derivationPath - Full derivation path for the address (e.g., "m/48'/0'/0'/2'/0/5")
 * @param multisigKeys - Array of cosigner key info from parsed descriptor
 * @param quorum - Number of required signatures (M in M-of-N)
 * @param network - Bitcoin network object
 * @param inputIndex - Optional input index for logging
 * @returns The witnessScript buffer, or undefined if derivation fails
 */
export function buildMultisigWitnessScript(
  derivationPath: string,
  multisigKeys: MultisigKeyInfo[],
  quorum: number,
  network: bitcoin.Network,
  inputIndex?: number
): Buffer | undefined {
  try {
    const { changeIdx, addressIdx } = extractChangeAndAddressIndex(derivationPath);

    // Derive public keys from each xpub at the change/index level
    const pubkeys: Buffer[] = [];
    for (const keyInfo of multisigKeys) {
      try {
        const standardXpub = convertToStandardXpub(keyInfo.xpub);
        const keyNode = bip32.fromBase58(standardXpub, network);
        const derivedNode = keyNode.derive(changeIdx).derive(addressIdx);

        if (derivedNode.publicKey) {
          pubkeys.push(derivedNode.publicKey);
        } else {
          log.warn('No publicKey on derived node for witnessScript', {
            inputIndex,
            fingerprint: keyInfo.fingerprint,
          });
        }
      } catch (keyError) {
        log.warn('Failed to derive key for witnessScript', {
          inputIndex,
          fingerprint: keyInfo.fingerprint,
          error: (keyError as Error).message,
        });
      }
    }

    if (pubkeys.length !== multisigKeys.length) {
      log.warn('Not all pubkeys derived for witnessScript', {
        inputIndex,
        expected: multisigKeys.length,
        actual: pubkeys.length,
      });
      return undefined;
    }

    // Sort public keys lexicographically (required for sortedmulti)
    pubkeys.sort((a, b) => a.compare(b));

    // Create the multisig redeem script (p2ms)
    const p2ms = bitcoin.payments.p2ms({
      m: quorum,
      pubkeys,
      network,
    });

    if (!p2ms.output) {
      log.warn('Failed to generate p2ms output for witnessScript', { inputIndex });
      return undefined;
    }

    log.info('Multisig witnessScript built', {
      inputIndex,
      quorum,
      keyCount: pubkeys.length,
      scriptSize: p2ms.output.length,
    });

    return p2ms.output;
  } catch (e) {
    log.warn('Failed to build multisig witnessScript', {
      inputIndex,
      error: (e as Error).message,
    });
    return undefined;
  }
}

/**
 * Check if a witnessScript is a multisig script (OP_CHECKMULTISIG or OP_CHECKMULTISIGVERIFY)
 * Returns { isMultisig: boolean, m: number, n: number } if it is multisig
 */
function parseMultisigScript(witnessScript: Buffer): { isMultisig: boolean; m: number; n: number; pubkeys: Buffer[] } {
  const OPS = bitcoin.script.OPS;
  const decompiled = bitcoin.script.decompile(witnessScript);

  if (!decompiled || decompiled.length < 4) {
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  // Last element should be OP_CHECKMULTISIG (174) or OP_CHECKMULTISIGVERIFY (175)
  const lastOp = decompiled[decompiled.length - 1];
  if (lastOp !== OPS.OP_CHECKMULTISIG && lastOp !== OPS.OP_CHECKMULTISIGVERIFY) {
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  // First element is M (required signatures) - can be OP_1-OP_16 (81-96) or small int
  const mValue = decompiled[0];
  let m: number;
  if (typeof mValue === 'number') {
    // OP_1 = 81, OP_16 = 96, so m = opcode - 80
    if (mValue >= 81 && mValue <= 96) {
      m = mValue - 80;
    } else if (mValue >= 1 && mValue <= 16) {
      // Could be a raw small integer
      m = mValue;
    } else {
      return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
    }
  } else {
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  // Second-to-last element is N (total pubkeys)
  const nValue = decompiled[decompiled.length - 2];
  let n: number;
  if (typeof nValue === 'number') {
    if (nValue >= 81 && nValue <= 96) {
      n = nValue - 80;
    } else if (nValue >= 1 && nValue <= 16) {
      n = nValue;
    } else {
      return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
    }
  } else {
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  // Extract pubkeys (between M and N)
  const pubkeys: Buffer[] = [];
  for (let i = 1; i < decompiled.length - 2; i++) {
    const item = decompiled[i];
    if (Buffer.isBuffer(item) && (item.length === 33 || item.length === 65)) {
      pubkeys.push(item);
    }
  }

  // Validate: number of pubkeys should match N
  if (pubkeys.length !== n) {
    log.warn('Multisig script pubkey count mismatch', { expected: n, actual: pubkeys.length });
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  return { isMultisig: true, m, n, pubkeys };
}

/**
 * Finalize a multisig P2WSH input.
 *
 * For multisig, we need to:
 * 1. Get all partial signatures from the PSBT input
 * 2. Sort them according to the pubkey order in the witnessScript
 * 3. Build the witness: [OP_0] [sig1] [sig2] ... [witnessScript]
 */
function finalizeMultisigInput(psbt: bitcoin.Psbt, inputIndex: number): void {
  const input = psbt.data.inputs[inputIndex];

  if (!input.witnessScript) {
    throw new Error(`Input #${inputIndex} missing witnessScript for multisig finalization`);
  }

  if (!input.partialSig || input.partialSig.length === 0) {
    throw new Error(`Input #${inputIndex} has no partial signatures`);
  }

  const witnessScript = input.witnessScript;

  // Parse and validate the multisig script
  const { isMultisig, m, n, pubkeys: scriptPubkeys } = parseMultisigScript(witnessScript);

  if (!isMultisig) {
    throw new Error(`Input #${inputIndex} witnessScript is not a valid multisig script`);
  }

  // Verify partialSig pubkeys are in witnessScript - only log mismatches
  const partialSigPubkeys = input.partialSig.map(ps => ps.pubkey.toString('hex'));
  const scriptPubkeyHexes = scriptPubkeys.map(pk => pk.toString('hex'));

  for (const sigPubkey of partialSigPubkeys) {
    if (!scriptPubkeyHexes.includes(sigPubkey)) {
      log.error('Signature pubkey not found in witnessScript', {
        inputIndex,
        sigPubkey,
        scriptPubkeys: scriptPubkeyHexes,
      });
    }
  }

  // Warn if missing witnessUtxo (needed for sighash)
  if (!input.witnessUtxo) {
    log.warn('Missing witnessUtxo for input', { inputIndex });
  }

  // Verify each signature before finalization
  for (const ps of input.partialSig) {
    const pubkeyHex = ps.pubkey.toString('hex');
    try {
      // Decode the DER signature to extract r, s values
      const sighashType = ps.signature[ps.signature.length - 1];
      const derSig = ps.signature.slice(0, -1);

      // Parse DER signature: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
      let offset = 2; // Skip 0x30 and length byte
      const rLen = derSig[offset + 1];
      const r = derSig.slice(offset + 2, offset + 2 + rLen);
      offset = offset + 2 + rLen;
      const sLen = derSig[offset + 1];
      const s = derSig.slice(offset + 2, offset + 2 + sLen);

      // Convert to 64-byte compact format (pad r and s to 32 bytes each)
      const rPadded = r.length > 32 ? r.slice(-32) : Buffer.concat([Buffer.alloc(32 - r.length), r]);
      const sPadded = s.length > 32 ? s.slice(-32) : Buffer.concat([Buffer.alloc(32 - s.length), s]);
      const compactSig = Buffer.concat([rPadded, sPadded]);

      // Compute the sighash that should have been signed
      // For P2WSH, we use the witnessScript as scriptCode
      // We need to use the transaction from the PSBT
      const tx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
      const txForSighash = bitcoin.Transaction.fromBuffer(tx.toBuffer());
      const sighash = txForSighash.hashForWitnessV0(
        inputIndex,
        witnessScript,
        input.witnessUtxo!.value,
        sighashType
      );

      // Verify the signature - only log if invalid
      const isValid = ecc.verify(sighash, ps.pubkey, compactSig);
      if (!isValid) {
        log.error('Invalid signature detected during multisig finalization', {
          inputIndex,
          pubkey: pubkeyHex,
          sighashHex: sighash.toString('hex'),
          sigHex: ps.signature.toString('hex'),
        });
      }
    } catch (verifyError) {
      log.warn('Signature verification error', {
        inputIndex,
        pubkey: pubkeyHex.substring(0, 16) + '...',
        error: (verifyError as Error).message,
      });
    }
  }

  // Create a map of pubkey hex to signature
  const sigMap = new Map<string, Buffer>();
  for (const ps of input.partialSig) {
    sigMap.set(ps.pubkey.toString('hex'), ps.signature);
  }

  // Sort signatures according to pubkey order in the witnessScript
  const orderedSigs: Buffer[] = [];
  for (const pubkey of scriptPubkeys) {
    const pubkeyHex = pubkey.toString('hex');
    const sig = sigMap.get(pubkeyHex);
    if (sig) {
      orderedSigs.push(sig);
      log.debug('Matched signature for script pubkey', {
        pubkey: pubkeyHex.substring(0, 16) + '...',
      });
    } else {
      log.debug('No signature for script pubkey', {
        pubkey: pubkeyHex.substring(0, 16) + '...',
      });
    }
  }

  if (orderedSigs.length === 0) {
    log.error('No matching signatures found', {
      partialSigPubkeys,
      scriptPubkeyHexes,
    });
    throw new Error(`Input #${inputIndex} no matching signatures found for witnessScript pubkeys`);
  }

  // Validate we have exactly M signatures
  if (orderedSigs.length !== m) {
    log.error('Signature count mismatch', {
      found: orderedSigs.length,
      required: m,
      partialSigPubkeys,
      scriptPubkeyHexes,
    });
    throw new Error(`Input #${inputIndex} has ${orderedSigs.length} signatures but needs exactly ${m} for ${m}-of-${n} multisig`);
  }

  log.debug('Multisig ordered signatures', {
    inputIndex,
    requiredSigs: m,
    orderedSigCount: orderedSigs.length,
  });

  // Build the witness stack: [OP_0 (empty buffer)] [sig1] [sig2] ... [witnessScript]
  // The empty buffer at the start is for the CHECKMULTISIG bug
  const witnessStack = [
    Buffer.alloc(0), // OP_0 (dummy element for CHECKMULTISIG bug)
    ...orderedSigs,
    witnessScript,
  ];

  // Set the final witness and clear partial data
  psbt.updateInput(inputIndex, {
    finalScriptWitness: witnessStackToScriptWitness(witnessStack),
    // Note: We don't clear partialSig/witnessScript here because updateInput
    // with finalScriptWitness should be sufficient for extractTransaction
  });

  log.info('Multisig input finalized', {
    inputIndex,
    signatureCount: orderedSigs.length,
    multisigType: `${m}-of-${n}`,
  });
}

/**
 * Convert a witness stack to the serialized format needed for finalScriptWitness.
 * This is the standard BIP-141 witness serialization.
 */
function witnessStackToScriptWitness(witness: Buffer[]): Buffer {
  let buffer = Buffer.allocUnsafe(0);

  function writeSlice(slice: Buffer) {
    buffer = Buffer.concat([buffer, slice]);
  }

  function writeVarInt(i: number) {
    if (i < 0xfd) {
      writeSlice(Buffer.from([i]));
    } else if (i <= 0xffff) {
      writeSlice(Buffer.from([0xfd]));
      const buf = Buffer.allocUnsafe(2);
      buf.writeUInt16LE(i, 0);
      writeSlice(buf);
    } else if (i <= 0xffffffff) {
      writeSlice(Buffer.from([0xfe]));
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt32LE(i, 0);
      writeSlice(buf);
    } else {
      writeSlice(Buffer.from([0xff]));
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigUInt64LE(BigInt(i), 0);
      writeSlice(buf);
    }
  }

  function writeVarSlice(slice: Buffer) {
    writeVarInt(slice.length);
    writeSlice(slice);
  }

  writeVarInt(witness.length);
  for (const w of witness) {
    writeVarSlice(w);
  }

  return buffer;
}

/**
 * Generate realistic-looking decoy amounts from a total change amount
 * Amounts avoid round numbers and vary in magnitude to look like real payments
 * Exported for testing
 */
export function generateDecoyAmounts(totalChange: number, count: number, dustThreshold: number): number[] {
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
  const confirmationThreshold = safeJsonParse(
    thresholdSetting?.value,
    SystemSettingSchemas.number,
    DEFAULT_CONFIRMATION_THRESHOLD,
    'confirmationThreshold'
  );

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

  // If user explicitly selected UTXOs, use ALL of them (no optimization)
  // This allows users to consolidate UTXOs or control exactly which are spent
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
    const estimatedSize = estimateTransactionSize(utxos.length, 2, 'native_segwit');
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalAmount < targetAmount + estimatedFee) {
      throw new Error(
        `Insufficient funds. Need ${targetAmount + estimatedFee} sats, have ${totalAmount} sats`
      );
    }

    const changeAmount = totalAmount - targetAmount - estimatedFee;
    return {
      utxos,
      totalAmount,
      estimatedFee,
      changeAmount,
    };
  }

  // Auto-selection: optimize to minimize inputs while covering the amount
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

  log.debug('createTransaction', { walletId, scriptType: wallet.scriptType });

  // Validate recipient address
  const network = wallet.network === 'testnet' ? 'testnet' : 'mainnet';
  const networkObj = getNetwork(network);

  // Get wallet fingerprint and xpub for BIP32 derivation info
  // For single-sig: use the device's fingerprint and xpub
  // For multi-sig: parse descriptor to get ALL keys' info (fingerprint, path, xpub)
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;
  let multisigKeys: MultisigKeyInfo[] | undefined;
  let multisigQuorum: number | undefined;
  let multisigScriptType: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti' | undefined;
  const isMultisig = wallet.type === 'multi_sig';

  log.info('BIP32 derivation: checking wallet data', {
    walletId,
    walletType: wallet.type,
    isMultisig,
    hasDevices: wallet.devices?.length > 0,
    deviceCount: wallet.devices?.length || 0,
    walletFingerprint: wallet.fingerprint,
    hasDescriptor: !!wallet.descriptor,
    descriptorPreview: wallet.descriptor?.substring(0, 60),
  });

  // For multisig, parse the descriptor to get ALL keys' info
  if (isMultisig && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.keys && parsed.keys.length > 0) {
        multisigKeys = parsed.keys;
        multisigQuorum = parsed.quorum;
        // Store descriptor type for script selection (P2WSH vs P2SH-P2WSH)
        if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
          multisigScriptType = parsed.type;
        }
        log.info('BIP32 derivation: parsed multisig descriptor', {
          keyCount: parsed.keys.length,
          quorum: parsed.quorum,
          scriptType: multisigScriptType,
          keys: parsed.keys.map(k => ({
            fingerprint: k.fingerprint,
            accountPath: k.accountPath,
            xpubPrefix: k.xpub.substring(0, 8),
          })),
        });
      }
    } catch (e) {
      log.warn('BIP32 derivation: failed to parse multisig descriptor', { error: (e as Error).message });
    }
  }

  // For single-sig, get from device or descriptor
  if (!isMultisig) {
    if (wallet.devices && wallet.devices.length > 0) {
      const primaryDevice = wallet.devices[0].device;
      log.info('BIP32 derivation: found primary device', {
        deviceId: primaryDevice.id,
        deviceFingerprint: primaryDevice.fingerprint,
        hasXpub: !!primaryDevice.xpub,
        xpubPrefix: primaryDevice.xpub?.substring(0, 4),
      });
      if (primaryDevice.fingerprint) {
        masterFingerprint = Buffer.from(primaryDevice.fingerprint, 'hex');
      }
      if (primaryDevice.xpub) {
        accountXpub = primaryDevice.xpub;
      }
    } else if (wallet.fingerprint) {
      log.info('BIP32 derivation: using wallet fingerprint fallback', { fingerprint: wallet.fingerprint });
      masterFingerprint = Buffer.from(wallet.fingerprint, 'hex');
    }

    // Try to get xpub from descriptor if not from device
    if (!accountXpub && wallet.descriptor) {
      try {
        const parsed = parseDescriptor(wallet.descriptor);
        log.info('BIP32 derivation: parsed descriptor', {
          hasXpub: !!parsed.xpub,
          xpubPrefix: parsed.xpub?.substring(0, 4),
          fingerprint: parsed.fingerprint,
          accountPath: parsed.accountPath,
        });
        if (parsed.xpub) {
          accountXpub = parsed.xpub;
        }
        if (!masterFingerprint && parsed.fingerprint) {
          masterFingerprint = Buffer.from(parsed.fingerprint, 'hex');
          log.info('BIP32 derivation: using fingerprint from descriptor', { fingerprint: parsed.fingerprint });
        }
      } catch (e) {
        log.warn('BIP32 derivation: failed to parse descriptor', { error: (e as Error).message });
      }
    }
  }

  log.info('BIP32 derivation: final values', {
    isMultisig,
    hasMultisigKeys: !!multisigKeys && multisigKeys.length > 0,
    multisigKeyCount: multisigKeys?.length || 0,
    hasMasterFingerprint: !!masterFingerprint,
    masterFingerprintHex: masterFingerprint?.toString('hex'),
    hasAccountXpub: !!accountXpub,
    accountXpubPrefix: accountXpub?.substring(0, 4),
  });

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
  //
  // CRITICAL FOR HARDWARE WALLET SIGNING:
  // Hardware wallets (Foundation Passport, Keystone, SeedSigner) require BIP32 derivation
  // info in PSBT inputs to verify the signing key belongs to them. This includes:
  //   - Master fingerprint (first 4 bytes of hash160 of master public key)
  //   - Derivation path (e.g., m/84'/0'/0'/0/5)
  //   - Public key at that path
  //
  // zpub/ypub/vpub use different version bytes than xpub, which causes bip32.fromBase58()
  // to calculate the wrong fingerprint. This makes hardware wallets reject the PSBT with
  // errors like "already signed" or "unknown key" because the fingerprint doesn't match.
  //
  // The convertToStandardXpub() function replaces version bytes to standard xpub format
  // while preserving the actual key data, ensuring correct fingerprint calculation.
  let accountNode: ReturnType<typeof bip32.fromBase58> | undefined;
  if (accountXpub) {
    try {
      const standardXpub = convertToStandardXpub(accountXpub);
      accountNode = bip32.fromBase58(standardXpub, networkObj);
      log.debug('Parsed account xpub for BIP32 derivation:', {
        originalPrefix: accountXpub.substring(0, 4),
        converted: standardXpub.substring(0, 4),
        hasAccountNode: !!accountNode,
      });
    } catch (e) {
      log.warn('Failed to parse account xpub:', { xpubPrefix: accountXpub?.substring(0, 4), error: (e as Error).message });
    }
  }

  // Check if this is a legacy wallet (requires nonWitnessUtxo)
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // For legacy wallets, we need to fetch raw transactions for nonWitnessUtxo
  const rawTxCache: Map<string, Buffer> = new Map();
  if (isLegacy) {
    // Fetch raw transactions with concurrency limit to avoid overwhelming the server
    const uniqueTxids = Array.from(new Set(selection.utxos.map(u => u.txid)));
    const rawTxResults = await mapWithConcurrency(
      uniqueTxids,
      async (txid: string) => {
        const rawHex = await getRawTransactionHex(txid);
        return { txid, rawTx: Buffer.from(rawHex, 'hex') };
      },
      5 // Max 5 concurrent requests
    );
    rawTxResults.forEach(({ txid, rawTx }) => rawTxCache.set(txid, rawTx));
  }

  for (const utxo of selection.utxos) {
    const derivationPath = addressPathMap.get(utxo.address) || '';
    inputPaths.push(derivationPath);

    // Validate scriptPubKey is present for SegWit transactions
    if (!isLegacy && (!utxo.scriptPubKey || utxo.scriptPubKey.length === 0)) {
      throw new Error(
        `UTXO ${utxo.txid}:${utxo.vout} is missing scriptPubKey data. ` +
        `Please resync your wallet to fetch missing UTXO data.`
      );
    }

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

    // Add BIP32 derivation info
    // For multisig: add entries for ALL cosigners from the descriptor
    // For single-sig: add single entry from the device
    const inputIndex = inputPaths.length - 1;

    if (isMultisig && multisigKeys && multisigKeys.length > 0 && derivationPath) {
      // MULTISIG: Add bip32Derivation for each cosigner using helper function
      const bip32Derivations = buildMultisigBip32Derivations(
        derivationPath,
        multisigKeys,
        networkObj,
        inputIndex
      );

      if (bip32Derivations.length > 0) {
        psbt.updateInput(inputIndex, { bip32Derivation: bip32Derivations });
      }

      // Add witnessScript for P2WSH multisig (required for hardware wallet signing)
      // For P2SH-P2WSH, we also need redeemScript (the P2WSH wrapper)
      if (multisigQuorum !== undefined && multisigScriptType === 'wsh-sortedmulti') {
        const witnessScript = buildMultisigWitnessScript(
          derivationPath,
          multisigKeys,
          multisigQuorum,
          networkObj,
          inputIndex
        );
        if (witnessScript) {
          psbt.updateInput(inputIndex, { witnessScript });
        }
      } else if (multisigQuorum !== undefined && multisigScriptType === 'sh-wsh-sortedmulti') {
        // P2SH-P2WSH requires both witnessScript and redeemScript
        const witnessScript = buildMultisigWitnessScript(
          derivationPath,
          multisigKeys,
          multisigQuorum,
          networkObj,
          inputIndex
        );
        if (witnessScript) {
          // Create the P2WSH output from witnessScript to use as redeemScript
          const p2wsh = bitcoin.payments.p2wsh({
            redeem: { output: witnessScript, network: networkObj },
            network: networkObj,
          });
          psbt.updateInput(inputIndex, {
            witnessScript,
            redeemScript: p2wsh.output,
          });
          log.info('P2SH-P2WSH scripts added to input', {
            inputIndex,
            witnessScriptSize: witnessScript.length,
            redeemScriptSize: p2wsh.output?.length,
          });
        }
      }
    } else if (masterFingerprint && derivationPath && accountNode) {
      // SINGLE-SIG: Add single bip32Derivation entry
      try {
        const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);
        let pubkeyNode = accountNode;

        // Find where the account path ends (after hardened levels)
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
          // Normalize path to apostrophe notation for PSBT compatibility
          const normalizedPath = normalizeHardenedPath(derivationPath);
          psbt.updateInput(inputIndex, {
            bip32Derivation: [{
              masterFingerprint,
              path: normalizedPath,
              pubkey: pubkeyNode.publicKey,
            }],
          });
          log.info('Single-sig BIP32 derivation added to input', {
            inputIndex,
            fingerprint: masterFingerprint.toString('hex'),
            path: normalizedPath,
            pubkeyHex: pubkeyNode.publicKey.toString('hex').substring(0, 20) + '...',
          });
        }
      } catch (e) {
        log.warn('Single-sig BIP32 derivation failed for input', {
          inputIndex,
          error: (e as Error).message,
        });
      }
    } else {
      log.warn('BIP32 derivation skipped - missing required data', {
        inputIndex,
        isMultisig,
        hasMultisigKeys: !!multisigKeys && multisigKeys.length > 0,
        hasMasterFingerprint: !!masterFingerprint,
        hasDerivationPath: !!derivationPath,
        hasAccountNode: !!accountNode,
      });
    }
  }

  // Build all outputs first, then add in randomized order for privacy
  // This prevents chain analysis from identifying change by output position
  interface PendingOutput {
    address: string;
    value: number;
    type: 'recipient' | 'change' | 'decoy';
  }
  const pendingOutputs: PendingOutput[] = [];

  // Add recipient output to pending list
  pendingOutputs.push({
    address: recipient,
    value: effectiveAmount,
    type: 'recipient',
  });

  // Calculate change output(s) if needed (skip for sendMax - no change)
  let changeAddress: string | undefined;
  let decoyOutputsResult: Array<{ address: string; amount: number }> | undefined;
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  if (!sendMax && selection.changeAmount >= dustThreshold) {
    // Determine number of change outputs needed
    const useDecoys = decoyOutputs?.enabled && decoyOutputs.count >= 2;
    const numChangeOutputs = useDecoys ? Math.min(Math.max(decoyOutputs.count, 2), 4) : 1;

    log.debug('Decoy calculation', {
      decoyOutputsParam: decoyOutputs,
      useDecoys,
      numChangeOutputs,
      changeAmount: selection.changeAmount,
      dustThreshold,
    });

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

      // Add all change outputs to pending list
      decoyOutputsResult = [];
      for (let i = 0; i < numChangeOutputs; i++) {
        const addr = shuffledAddresses[i].address;
        const amt = amounts[i];

        pendingOutputs.push({
          address: addr,
          value: amt,
          type: i === 0 ? 'change' : 'decoy',
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

      pendingOutputs.push({
        address: changeAddress,
        value: actualChangeAmount,
        type: 'change',
      });
    }
  }

  // Shuffle outputs for privacy (Fisher-Yates algorithm)
  // This prevents chain analysis from identifying outputs by position
  for (let i = pendingOutputs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pendingOutputs[i], pendingOutputs[j]] = [pendingOutputs[j], pendingOutputs[i]];
  }

  // Add all outputs to PSBT in randomized order
  for (const output of pendingOutputs) {
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
  }

  // When decoys are used, don't return changeAmount/changeAddress separately
  // as all change is distributed among decoy outputs
  const hasDecoys = decoyOutputsResult && decoyOutputsResult.length > 0;

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    fee: actualFee,
    totalInput: selection.totalAmount,
    totalOutput: effectiveAmount + (sendMax ? 0 : (actualChangeAmount >= dustThreshold ? actualChangeAmount : 0)),
    // When decoys are used, changeAmount is 0 (change is in decoys)
    changeAmount: hasDecoys ? 0 : (sendMax ? 0 : actualChangeAmount),
    changeAddress: hasDecoys ? undefined : changeAddress,
    utxos: selection.utxos.map((u) => ({ txid: u.txid, vout: u.vout, address: u.address, amount: Number(u.amount) })),
    inputPaths,
    effectiveAmount, // The actual amount being sent (may differ from requested if sendMax or subtractFees)
    decoyOutputs: decoyOutputsResult, // Decoy change outputs (if enabled)
  };
}

/**
 * Input metadata for transaction storage
 */
export interface TransactionInputMetadata {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  derivationPath?: string;
}

/**
 * Output metadata for transaction storage
 */
export interface TransactionOutputMetadata {
  address: string;
  amount: number;
  outputType: 'recipient' | 'change' | 'decoy' | 'consolidation' | 'unknown';
  isOurs: boolean;
  scriptPubKey?: string;
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
    // Enhanced metadata for full I/O storage
    inputs?: TransactionInputMetadata[];
    outputs?: TransactionOutputMetadata[];
  }
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  // Log which broadcast path we're taking
  log.info('broadcastAndSave called', {
    hasSignedPsbtBase64: !!signedPsbtBase64,
    signedPsbtBase64Length: signedPsbtBase64?.length || 0,
    hasRawTxHex: !!metadata.rawTxHex,
    rawTxHexLength: metadata.rawTxHex?.length || 0,
    recipient: metadata.recipient,
    draftId: metadata.draftId,
  });

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
      // Use custom finalizer for multisig inputs
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const input = psbt.data.inputs[i];

        // Skip already finalized inputs
        if (input.finalScriptSig || input.finalScriptWitness) {
          continue;
        }

        // Check if this is a multisig input
        if (input.witnessScript && input.partialSig && input.partialSig.length > 0) {
          // Parse script to check if it's actually multisig
          const { isMultisig } = parseMultisigScript(input.witnessScript);
          if (isMultisig) {
            // Custom multisig finalization
            finalizeMultisigInput(psbt, i);
          } else {
            // P2WSH but not multisig - try standard finalization
            psbt.finalizeInput(i);
          }
        } else {
          // Standard single-sig finalization
          psbt.finalizeInput(i);
        }
      }
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
    // Record broadcast failure metric
    transactionBroadcastsTotal.inc({ status: 'failure' });
    throw new Error('Failed to broadcast transaction');
  }

  // Record broadcast success metric
  transactionBroadcastsTotal.inc({ status: 'success' });

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
  // For consolidation: amount is negative fee (only fee is lost, funds stay in wallet)
  // For sent: amount is negative (funds leaving wallet = amount + fee)
  const txAmount = isConsolidation
    ? -metadata.fee  // Consolidation: only fee is lost
    : -(metadata.amount + metadata.fee);  // Sent: amount + fee leaves wallet
  const txRecord = await prisma.transaction.create({
    data: {
      txid,
      walletId,
      type: txType,
      amount: BigInt(txAmount),
      fee: BigInt(metadata.fee),
      confirmations: 0,
      label: labelToUse,
      memo: memoToUse,
      blockHeight: null,
      blockTime: null,
      replacementForTxid,
      rbfStatus: 'active',
      rawTx,
      counterpartyAddress: metadata.recipient,
    },
  });

  // Store transaction inputs if provided
  if (metadata.inputs && metadata.inputs.length > 0) {
    const inputData = metadata.inputs.map((input, index) => ({
      transactionId: txRecord.id,
      inputIndex: index,
      txid: input.txid,
      vout: input.vout,
      address: input.address,
      amount: BigInt(input.amount),
      derivationPath: input.derivationPath,
    }));

    await prisma.transactionInput.createMany({ data: inputData });
    log.debug(`Stored ${inputData.length} transaction inputs for ${txid}`);
  } else {
    // Fallback: try to get input data from UTXO table if not provided
    // OPTIMIZED: Batch fetch all UTXOs and addresses to avoid N+1 queries
    const utxoKeys = metadata.utxos.map(u => ({ txid: u.txid, vout: u.vout }));

    // Batch fetch all required UTXOs
    const utxoRecords = await prisma.uTXO.findMany({
      where: {
        OR: utxoKeys.map(k => ({ txid: k.txid, vout: k.vout })),
      },
    });
    const utxoLookup = new Map(utxoRecords.map(u => [`${u.txid}:${u.vout}`, u]));

    // Batch fetch all wallet addresses for derivation paths
    const utxoAddresses = utxoRecords.map(u => u.address);
    const addressRecords = await prisma.address.findMany({
      where: {
        walletId,
        address: { in: utxoAddresses },
      },
      select: { address: true, derivationPath: true },
    });
    const addressPathLookup = new Map(addressRecords.map(a => [a.address, a.derivationPath]));

    // Build input data using lookups (O(1) per input instead of O(n) queries)
    const utxoInputs = metadata.utxos.map((utxo, index) => {
      const utxoRecord = utxoLookup.get(`${utxo.txid}:${utxo.vout}`);
      if (!utxoRecord) return null;

      return {
        transactionId: txRecord.id,
        inputIndex: index,
        txid: utxo.txid,
        vout: utxo.vout,
        address: utxoRecord.address,
        amount: utxoRecord.amount,
        derivationPath: addressPathLookup.get(utxoRecord.address),
      };
    });

    const validInputs = utxoInputs.filter(Boolean) as Array<{
      transactionId: string;
      inputIndex: number;
      txid: string;
      vout: number;
      address: string;
      amount: bigint;
      derivationPath: string | null | undefined;
    }>;

    if (validInputs.length > 0) {
      await prisma.transactionInput.createMany({ data: validInputs });
      log.debug(`Stored ${validInputs.length} transaction inputs (from UTXO fallback) for ${txid}`);
    }
  }

  // Store transaction outputs if provided
  if (metadata.outputs && metadata.outputs.length > 0) {
    const outputData = metadata.outputs.map((output, index) => ({
      transactionId: txRecord.id,
      outputIndex: index,
      address: output.address,
      amount: BigInt(output.amount),
      outputType: output.outputType,
      isOurs: output.isOurs,
      scriptPubKey: output.scriptPubKey,
    }));

    await prisma.transactionOutput.createMany({ data: outputData });
    log.debug(`Stored ${outputData.length} transaction outputs for ${txid}`);
  } else {
    // Fallback: try to parse outputs from the raw transaction or PSBT
    try {
      const tx = bitcoin.Transaction.fromHex(rawTx);
      const network = await prisma.wallet.findUnique({
        where: { id: walletId },
        select: { network: true },
      });
      const networkObj = getNetwork(network?.network === 'testnet' ? 'testnet' : 'mainnet');

      // Get all wallet addresses to check ownership
      const walletAddresses = await prisma.address.findMany({
        where: { walletId },
        select: { address: true },
      });
      const walletAddressSet = new Set(walletAddresses.map(a => a.address));

      const outputData = tx.outs.map((output, index) => {
        let address = '';
        try {
          address = bitcoin.address.fromOutputScript(output.script, networkObj);
        } catch (e) {
          // OP_RETURN or non-standard output
        }

        const isOurs = walletAddressSet.has(address);
        let outputType: string = 'unknown';

        if (address === metadata.recipient) {
          outputType = 'recipient';
        } else if (isOurs) {
          outputType = isConsolidation ? 'consolidation' : 'change';
        } else if (address) {
          outputType = 'recipient'; // External address, must be a recipient
        } else {
          outputType = 'op_return';
        }

        return {
          transactionId: txRecord.id,
          outputIndex: index,
          address,
          amount: BigInt(output.value),
          outputType,
          isOurs,
          scriptPubKey: output.script.toString('hex'),
        };
      });

      if (outputData.length > 0) {
        await prisma.transactionOutput.createMany({ data: outputData });
        log.debug(`Stored ${outputData.length} transaction outputs (from raw tx) for ${txid}`);
      }
    } catch (e) {
      log.warn(`Failed to parse outputs from raw transaction: ${e}`);
    }
  }

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
      log.warn('Failed to send notifications', { error: String(err) });
    });
  });

  // Emit transaction sent event for real-time updates
  eventService.emitTransactionSent({
    walletId,
    txid,
    amount: BigInt(metadata.amount),
    fee: BigInt(metadata.fee),
    recipients: [{ address: metadata.recipient, amount: BigInt(metadata.amount) }],
    rawTx,
  });

  // Check if any output addresses belong to other wallets in the app
  // If so, create pending "received" transactions for those wallets immediately
  // This handles both single-recipient and multi-recipient (batch) transactions
  try {
    const tx = bitcoin.Transaction.fromHex(rawTx);
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });
    const networkObj = getNetwork(wallet?.network === 'testnet' ? 'testnet' : 'mainnet');

    // Extract all output addresses
    const outputAddresses: Array<{ address: string; amount: number }> = [];
    for (const output of tx.outs) {
      try {
        const addr = bitcoin.address.fromOutputScript(output.script, networkObj);
        outputAddresses.push({ address: addr, amount: output.value });
      } catch (e) {
        // Skip OP_RETURN or non-standard outputs
      }
    }

    // Find which output addresses belong to OTHER wallets in the app
    const recipientAddresses = await prisma.address.findMany({
      where: {
        address: { in: outputAddresses.map(o => o.address) },
        walletId: { not: walletId }, // Not the sending wallet
      },
      select: {
        walletId: true,
        address: true,
      },
    });

    // Group outputs by receiving wallet
    const walletOutputs = new Map<string, { address: string; amount: number }[]>();
    for (const addrRecord of recipientAddresses) {
      const outputs = outputAddresses.filter(o => o.address === addrRecord.address);
      const existing = walletOutputs.get(addrRecord.walletId) || [];
      walletOutputs.set(addrRecord.walletId, [...existing, ...outputs]);
    }

    // Create pending received transaction for each receiving wallet
    for (const [receivingWalletId, outputs] of walletOutputs) {
      const totalAmount = outputs.reduce((sum, o) => sum + o.amount, 0);

      log.info('Creating pending received transaction for internal wallet', {
        txid,
        sendingWalletId: walletId,
        receivingWalletId,
        outputCount: outputs.length,
        totalAmount,
      });

      // Check if transaction already exists for receiving wallet (avoid duplicates)
      const existingReceivedTx = await prisma.transaction.findFirst({
        where: {
          txid,
          walletId: receivingWalletId,
        },
      });

      if (!existingReceivedTx) {
        // Create pending received transaction for the receiving wallet
        await prisma.transaction.create({
          data: {
            txid,
            walletId: receivingWalletId,
            type: 'received',
            amount: BigInt(totalAmount),
            fee: BigInt(0), // Receiver doesn't pay fee
            confirmations: 0,
            label: metadata.label,
            blockHeight: null,
            blockTime: null,
            rawTx,
            counterpartyAddress: null,
          },
        });

        // Recalculate balances for receiving wallet
        await recalculateWalletBalances(receivingWalletId);

        // Emit transaction received event for real-time updates
        eventService.emitTransactionReceived({
          walletId: receivingWalletId,
          txid,
          amount: BigInt(totalAmount),
          address: outputs[0].address,
          confirmations: 0,
        });

        // Send notifications for the receiving wallet
        import('../notifications/notificationService').then(({ notifyNewTransactions }) => {
          notifyNewTransactions(receivingWalletId, [{
            txid,
            type: 'received',
            amount: BigInt(totalAmount),
          }]).catch(err => {
            log.warn('Failed to send notifications for receiving wallet', { error: String(err) });
          });
        });
      }
    }
  } catch (e) {
    log.warn('Failed to create pending transactions for receiving wallets', { error: String(e) });
  }

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
  } catch (error) {
    return {
      fee: 0,
      totalCost: amount,
      inputCount: 0,
      outputCount: 1,
      changeAmount: 0,
      sufficient: false,
      error: getErrorMessage(error),
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
  // For multi-sig: parse descriptor to get ALL keys' info
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;
  let multisigKeys: MultisigKeyInfo[] | undefined;
  let multisigQuorum: number | undefined;
  let multisigScriptType: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti' | undefined;
  const isMultisig = wallet.type === 'multi_sig';

  // For multisig, parse the descriptor to get ALL keys' info
  if (isMultisig && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.keys && parsed.keys.length > 0) {
        multisigKeys = parsed.keys;
        multisigQuorum = parsed.quorum;
        // Store descriptor type for script selection (P2WSH vs P2SH-P2WSH)
        if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
          multisigScriptType = parsed.type;
        }
        log.info('[BATCH] Parsed multisig descriptor', {
          keyCount: parsed.keys.length,
          quorum: parsed.quorum,
          scriptType: multisigScriptType,
        });
      }
    } catch (e) {
      log.warn('[BATCH] Failed to parse multisig descriptor', { error: (e as Error).message });
    }
  }

  // For single-sig, get from device or descriptor
  if (!isMultisig) {
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

  // Get confirmation threshold setting
  const thresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: 'confirmationThreshold' },
  });
  const confirmationThreshold = safeJsonParse(
    thresholdSetting?.value,
    SystemSettingSchemas.number,
    DEFAULT_CONFIRMATION_THRESHOLD,
    'confirmationThreshold'
  );

  // Get available UTXOs (respecting confirmation threshold and draft locks)
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
      confirmations: { gte: confirmationThreshold }, // Must have enough confirmations
      // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
      ...(selectedUtxoIds && selectedUtxoIds.length > 0
        ? {} // Don't filter locks if user selected specific UTXOs
        : { draftLock: null }), // Auto-selection: exclude locked UTXOs
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

  // Log UTXO details for debugging PSBT issues
  log.info(`[BATCH] Creating batch transaction with ${utxos.length} UTXOs`, {
    walletId,
    utxoCount: utxos.length,
    hasSelectedUtxos: !!selectedUtxoIds && selectedUtxoIds.length > 0,
    hasSendMax,
    outputs: outputs.map(o => ({ address: o.address.slice(0, 10) + '...', amount: o.amount, sendMax: o.sendMax })),
  });

  // Validate all UTXOs have required scriptPubKey
  const invalidUtxos = utxos.filter(u => !u.scriptPubKey || u.scriptPubKey.length === 0);
  if (invalidUtxos.length > 0) {
    log.error('[BATCH] UTXOs missing scriptPubKey', {
      invalidCount: invalidUtxos.length,
      invalidUtxos: invalidUtxos.map(u => ({ txid: u.txid, vout: u.vout, address: u.address })),
    });
    throw new Error(`${invalidUtxos.length} UTXO(s) are missing scriptPubKey data and cannot be spent. Please sync your wallet.`);
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
  //
  // CRITICAL FOR HARDWARE WALLET SIGNING:
  // Hardware wallets (Foundation Passport, Keystone, SeedSigner) require BIP32 derivation
  // info in PSBT inputs to verify the signing key belongs to them. This includes:
  //   - Master fingerprint (first 4 bytes of hash160 of master public key)
  //   - Derivation path (e.g., m/84'/0'/0'/0/5)
  //   - Public key at that path
  //
  // zpub/ypub/vpub use different version bytes than xpub, which causes bip32.fromBase58()
  // to calculate the wrong fingerprint. This makes hardware wallets reject the PSBT with
  // errors like "already signed" or "unknown key" because the fingerprint doesn't match.
  //
  // The convertToStandardXpub() function replaces version bytes to standard xpub format
  // while preserving the actual key data, ensuring correct fingerprint calculation.
  let accountNode: ReturnType<typeof bip32.fromBase58> | undefined;
  if (accountXpub) {
    try {
      const standardXpub = convertToStandardXpub(accountXpub);
      accountNode = bip32.fromBase58(standardXpub, networkObj);
      log.debug('Parsed account xpub for BIP32 derivation:', {
        originalPrefix: accountXpub.substring(0, 4),
        converted: standardXpub.substring(0, 4),
        hasAccountNode: !!accountNode,
      });
    } catch (e) {
      log.warn('Failed to parse account xpub:', { xpubPrefix: accountXpub?.substring(0, 4), error: (e as Error).message });
    }
  }

  // Check if this is a legacy wallet (requires nonWitnessUtxo)
  const isLegacy = isLegacyScriptType(wallet.scriptType);

  // For legacy wallets, we need to fetch raw transactions for nonWitnessUtxo
  const rawTxCache: Map<string, Buffer> = new Map();
  if (isLegacy) {
    // Fetch raw transactions with concurrency limit to avoid overwhelming the server
    const uniqueTxids = [...new Set(utxos.map(u => u.txid))];
    const rawTxResults = await mapWithConcurrency(
      uniqueTxids,
      async (txid) => {
        const rawHex = await getRawTransactionHex(txid);
        return { txid, rawTx: Buffer.from(rawHex, 'hex') };
      },
      5 // Max 5 concurrent requests
    );
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

    // Add BIP32 derivation info
    // For multisig: add entries for ALL cosigners from the descriptor
    // For single-sig: add single entry from the device
    const inputIndex = inputPaths.length - 1;

    if (isMultisig && multisigKeys && multisigKeys.length > 0 && derivationPath) {
      // MULTISIG: Add bip32Derivation for each cosigner using helper function
      const bip32Derivations = buildMultisigBip32Derivations(
        derivationPath,
        multisigKeys,
        networkObj,
        inputIndex
      );

      if (bip32Derivations.length > 0) {
        psbt.updateInput(inputIndex, { bip32Derivation: bip32Derivations });
      }

      // Add witnessScript for P2WSH multisig (required for hardware wallet signing)
      // For P2SH-P2WSH, we also need redeemScript (the P2WSH wrapper)
      if (multisigQuorum !== undefined && multisigScriptType === 'wsh-sortedmulti') {
        const witnessScript = buildMultisigWitnessScript(
          derivationPath,
          multisigKeys,
          multisigQuorum,
          networkObj,
          inputIndex
        );
        if (witnessScript) {
          psbt.updateInput(inputIndex, { witnessScript });
        }
      } else if (multisigQuorum !== undefined && multisigScriptType === 'sh-wsh-sortedmulti') {
        // P2SH-P2WSH requires both witnessScript and redeemScript
        const witnessScript = buildMultisigWitnessScript(
          derivationPath,
          multisigKeys,
          multisigQuorum,
          networkObj,
          inputIndex
        );
        if (witnessScript) {
          // Create the P2WSH output from witnessScript to use as redeemScript
          const p2wsh = bitcoin.payments.p2wsh({
            redeem: { output: witnessScript, network: networkObj },
            network: networkObj,
          });
          psbt.updateInput(inputIndex, {
            witnessScript,
            redeemScript: p2wsh.output,
          });
          log.info('[BATCH] P2SH-P2WSH scripts added to input', {
            inputIndex,
            witnessScriptSize: witnessScript.length,
            redeemScriptSize: p2wsh.output?.length,
          });
        }
      }
    } else if (masterFingerprint && derivationPath && accountNode) {
      // SINGLE-SIG: Add single bip32Derivation entry
      try {
        const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);
        let pubkeyNode = accountNode;

        let accountPathEnd = 0;
        for (let i = 0; i < pathParts.length && i < 3; i++) {
          if (pathParts[i].endsWith("'") || pathParts[i].endsWith('h')) {
            accountPathEnd = i + 1;
          }
        }

        for (let i = accountPathEnd; i < pathParts.length; i++) {
          const part = pathParts[i];
          const idx = parseInt(part.replace(/['h]/g, ''), 10);
          pubkeyNode = pubkeyNode.derive(idx);
        }

        if (pubkeyNode.publicKey) {
          // Normalize path to apostrophe notation for PSBT compatibility
          const normalizedPath = normalizeHardenedPath(derivationPath);
          psbt.updateInput(inputIndex, {
            bip32Derivation: [{
              masterFingerprint,
              path: normalizedPath,
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
    utxos: utxos.map(u => ({ txid: u.txid, vout: u.vout, address: u.address, amount: Number(u.amount) })),
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
