/**
 * BIP-143 Official Test Vector Verification (SegWit v0 Sighash)
 *
 * Tests SegWit v0 transaction sighash computation against the official BIP-143 test vectors:
 * https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
 *
 * These vectors verify that:
 * - Native P2WPKH sighash is computed correctly
 * - P2SH-P2WPKH sighash is computed correctly
 * - The hashForWitnessV0 implementation matches the BIP-143 specification
 */

import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP143_TEST_VECTORS } from '@fixtures/bip143-test-vectors';

describe('BIP-143 SegWit v0 Sighash Verification', () => {
  BIP143_TEST_VECTORS.forEach((vector) => {
    it(`should produce correct sighash for: ${vector.description}`, () => {
      const transaction = bitcoin.Transaction.fromHex(vector.unsignedTxHex);
      const scriptCode = Buffer.from(vector.scriptCodeHex, 'hex');

      const sigHash = transaction.hashForWitnessV0(
        vector.inputIndex,
        scriptCode,
        vector.value,
        vector.hashType,
      );

      expect(sigHash.toString('hex')).toBe(vector.expectedSigHash);
    });
  });
});
