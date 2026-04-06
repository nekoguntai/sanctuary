/**
 * Witness Script Builder
 *
 * Constructs and parses multisig witness scripts for P2WSH inputs.
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { convertToStandardXpub, MultisigKeyInfo } from '../addressDerivation';
import { createLogger } from '../../../utils/logger';
import { extractChangeAndAddressIndex } from '../../../../../shared/utils/bitcoin';

const log = createLogger('BITCOIN:SVC_PSBT_WITNESS');

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
): Uint8Array | undefined {
  try {
    const { changeIdx, addressIdx } = extractChangeAndAddressIndex(derivationPath);

    // Derive public keys from each xpub at the change/index level
    const pubkeys: Uint8Array[] = [];
    for (const keyInfo of multisigKeys) {
      try {
        const standardXpub = convertToStandardXpub(keyInfo.xpub);
        const keyNode = bip32.fromBase58(standardXpub, network);
        const derivedNode = keyNode.derive(changeIdx).derive(addressIdx);
        pubkeys.push(derivedNode.publicKey!);
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
    pubkeys.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));

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
export function parseMultisigScript(witnessScript: Buffer | Uint8Array): { isMultisig: boolean; m: number; n: number; pubkeys: Buffer[] } {
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
    if (typeof item !== 'number' && (item.length === 33 || item.length === 65)) {
      pubkeys.push(Buffer.from(item));
    }
  }

  // Validate: number of pubkeys should match N
  if (pubkeys.length !== n) {
    log.warn('Multisig script pubkey count mismatch', { expected: n, actual: pubkeys.length });
    return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
  }

  return { isMultisig: true, m, n, pubkeys };
}
