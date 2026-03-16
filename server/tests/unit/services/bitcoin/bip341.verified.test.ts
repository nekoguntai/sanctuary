/**
 * BIP-341 Official Test Vector Verification (Taproot: SegWit version 1 spending rules)
 *
 * Tests taproot key tweaking and scriptPubKey derivation against the official BIP-341
 * test vectors:
 * https://github.com/bitcoin/bips/blob/master/bip-0341/wallet-test-vectors.json
 *
 * These vectors verify that:
 * - Tagged hash ("TapTweak") computation is correct
 * - Internal pubkey tweaking produces the expected tweaked pubkey
 * - scriptPubKey (0x5120 + tweaked pubkey) is correctly formed
 * - Bech32m address encoding matches expected taproot addresses
 * - Key path spending witness signatures have correct length
 */

import { describe, it, expect } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import crypto from 'crypto';
import { bech32m } from 'bech32';
import {
  BIP341_SCRIPTPUBKEY_VECTORS,
  BIP341_KEYPATH_VECTORS,
} from '@fixtures/bip341-test-vectors';

/**
 * Compute a BIP-340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || data)
 *
 * Tagged hashes are used throughout taproot (BIP-341) to domain-separate
 * different uses of SHA-256, preventing cross-protocol attacks.
 */
function taggedHash(tag: string, data: Buffer): Buffer {
  const tagHash = crypto.createHash('sha256').update(tag).digest();
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([tagHash, tagHash, data]))
    .digest();
}

/**
 * Compute the TapTweak hash per BIP-341.
 *
 * When merkleRoot is null (key path only, no scripts), the tweak is:
 *   SHA256(tagged_hash("TapTweak", internalPubkey))
 *
 * When merkleRoot is provided (script tree exists), the tweak is:
 *   SHA256(tagged_hash("TapTweak", internalPubkey || merkleRoot))
 */
function computeTapTweak(internalPubkey: Buffer, merkleRoot: Buffer | null): Buffer {
  if (merkleRoot === null) {
    return taggedHash('TapTweak', internalPubkey);
  }
  return taggedHash('TapTweak', Buffer.concat([internalPubkey, merkleRoot]));
}

describe('BIP-341 Taproot Verification', () => {
  describe('ScriptPubKey derivation (taproot output key tweaking)', () => {
    BIP341_SCRIPTPUBKEY_VECTORS.forEach((vector, index) => {
      const hasMerkleRoot = vector.merkleRoot !== null;
      const label = hasMerkleRoot
        ? `Vector ${index}: with merkle root`
        : `Vector ${index}: key path only (no scripts)`;

      describe(label, () => {
        const internalPubkey = Buffer.from(vector.internalPubkey, 'hex');
        const merkleRoot = vector.merkleRoot
          ? Buffer.from(vector.merkleRoot, 'hex')
          : null;

        it('should compute the correct TapTweak', () => {
          const tweak = computeTapTweak(internalPubkey, merkleRoot);
          expect(tweak.toString('hex')).toBe(vector.expectedTweak);
        });

        it('should derive the correct tweaked public key', () => {
          const tweak = computeTapTweak(internalPubkey, merkleRoot);
          const result = ecc.xOnlyPointAddTweak(internalPubkey, tweak);

          expect(result).not.toBeNull();
          expect(Buffer.from(result!.xOnlyPubkey).toString('hex')).toBe(
            vector.expectedTweakedPubkey
          );
        });

        it('should produce the correct scriptPubKey (0x5120 || tweakedPubkey)', () => {
          const tweak = computeTapTweak(internalPubkey, merkleRoot);
          const result = ecc.xOnlyPointAddTweak(internalPubkey, tweak);

          expect(result).not.toBeNull();

          // Taproot scriptPubKey: OP_1 (0x51) PUSH32 (0x20) <tweaked_pubkey>
          const scriptPubKey = Buffer.concat([
            Buffer.from([0x51, 0x20]),
            Buffer.from(result!.xOnlyPubkey),
          ]);

          expect(scriptPubKey.toString('hex')).toBe(vector.expectedScriptPubKey);
        });

        it('should encode the correct bech32m taproot address', () => {
          const tweak = computeTapTweak(internalPubkey, merkleRoot);
          const result = ecc.xOnlyPointAddTweak(internalPubkey, tweak);

          expect(result).not.toBeNull();

          // BIP-350: SegWit v1+ uses bech32m encoding
          // witness version 1 + 32-byte program (tweaked pubkey)
          const words = bech32m.toWords(Buffer.from(result!.xOnlyPubkey));
          const address = bech32m.encode('bc', [1, ...words]);

          expect(address).toBe(vector.expectedAddress);
        });
      });
    });
  });

  describe('Key path spending witness signature lengths', () => {
    BIP341_KEYPATH_VECTORS.forEach((vector) => {
      it(`txin ${vector.txinIndex} (hashType 0x${vector.hashType.toString(16).padStart(2, '0')}): witness has correct byte length`, () => {
        const witnessBytes = Buffer.from(vector.expectedWitness, 'hex');

        // BIP-341 key path spending witness:
        // - Default sighash (hashType 0x00): 64-byte Schnorr signature only
        // - Explicit sighash (hashType != 0x00): 64-byte signature + 1-byte hashType = 65 bytes
        const expectedLength = vector.hashType === 0 ? 64 : 65;

        expect(witnessBytes.length).toBe(expectedLength);
      });

      if (vector.hashType !== 0) {
        it(`txin ${vector.txinIndex}: appended hashType byte matches 0x${vector.hashType.toString(16).padStart(2, '0')}`, () => {
          const witnessBytes = Buffer.from(vector.expectedWitness, 'hex');

          // The last byte of a non-default witness is the sighash type
          const appendedHashType = witnessBytes[witnessBytes.length - 1];
          expect(appendedHashType).toBe(vector.hashType);
        });
      }
    });
  });

  describe('Cross-validation: scriptPubKey vectors are self-consistent', () => {
    it('all 7 official BIP-341 scriptPubKey vectors are present', () => {
      expect(BIP341_SCRIPTPUBKEY_VECTORS).toHaveLength(7);
    });

    it('first vector has null merkleRoot (key path only)', () => {
      expect(BIP341_SCRIPTPUBKEY_VECTORS[0].merkleRoot).toBeNull();
    });

    it('remaining vectors have non-null merkleRoots (script trees)', () => {
      for (let i = 1; i < BIP341_SCRIPTPUBKEY_VECTORS.length; i++) {
        expect(BIP341_SCRIPTPUBKEY_VECTORS[i].merkleRoot).not.toBeNull();
      }
    });

    BIP341_SCRIPTPUBKEY_VECTORS.forEach((vector, index) => {
      it(`vector ${index}: scriptPubKey embeds the tweaked pubkey`, () => {
        // scriptPubKey must be 0x5120 + 32-byte tweaked pubkey
        expect(vector.expectedScriptPubKey).toBe(
          '5120' + vector.expectedTweakedPubkey
        );
      });

      it(`vector ${index}: address starts with bc1p (taproot mainnet)`, () => {
        expect(vector.expectedAddress.startsWith('bc1p')).toBe(true);
      });
    });
  });
});
