/**
 * Multisig Input Finalization
 *
 * Handles finalization of multisig P2WSH inputs in PSBTs,
 * including signature ordering and witness stack construction.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { createLogger } from '../../../utils/logger';
import { parseMultisigScript } from './witnessScript';

const log = createLogger('BITCOIN:SVC_PSBT_MULTISIG');

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
  const partialSigPubkeys = input.partialSig.map(ps => Buffer.from(ps.pubkey).toString('hex'));
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
    const pubkeyHex = Buffer.from(ps.pubkey).toString('hex');
    try {
      // Decode the DER signature to extract r, s values
      const sigBuf = Buffer.from(ps.signature);
      const sighashType = sigBuf[sigBuf.length - 1];
      const derSig = sigBuf.slice(0, -1);

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
          sighashHex: Buffer.from(sighash).toString('hex'),
          sigHex: Buffer.from(ps.signature).toString('hex'),
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
    sigMap.set(Buffer.from(ps.pubkey).toString('hex'), Buffer.from(ps.signature));
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
  const witnessStack: Buffer[] = [
    Buffer.alloc(0), // OP_0 (dummy element for CHECKMULTISIG bug)
    ...orderedSigs,
    Buffer.from(witnessScript),
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
