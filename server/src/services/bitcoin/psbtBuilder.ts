/**
 * PSBT Builder Module
 *
 * Utilities for building PSBT inputs and outputs, including:
 * - BIP32 derivation entries for hardware wallet signing
 * - Multisig witness script construction
 * - Multisig input finalization
 * - Decoy output amount generation
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import { convertToStandardXpub, MultisigKeyInfo } from './addressDerivation';
import { createLogger } from '../../utils/logger';
import {
  normalizeDerivationPath,
  extractChangeAndAddressIndex,
} from '../../../../shared/utils/bitcoin';

const log = createLogger('PSBT-BUILDER');

// Initialize BIP32 for key derivation
const bip32 = BIP32Factory(ecc);

/**
 * BIP32 derivation entry for PSBT inputs/outputs
 */
export interface Bip32DerivationEntry {
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
          const fullPath = normalizeDerivationPath(`m/${keyInfo.accountPath}/${changeIdx}/${addressIdx}`);

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
export function parseMultisigScript(witnessScript: Buffer): { isMultisig: boolean; m: number; n: number; pubkeys: Buffer[] } {
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
export function finalizeMultisigInput(psbt: bitcoin.Psbt, inputIndex: number): void {
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
export function witnessStackToScriptWitness(witness: Buffer[]): Buffer {
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
