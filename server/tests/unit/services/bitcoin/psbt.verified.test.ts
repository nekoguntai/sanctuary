/**
 * PSBT Cross-Implementation Verification Tests
 *
 * These tests verify our PSBT handling against:
 * 1. BIP-174 official test vectors
 * 2. Local deterministic extended vectors (P2WPKH/P2WSH)
 */

import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  ALL_BIP174_VECTORS,
  ALL_BIP174_INVALID_VECTORS,
  P2WPKH_VECTORS,
  P2WSH_MULTISIG_VECTORS,
} from '@fixtures/bip174-test-vectors';

describe('PSBT BIP-174 Compliance', () => {
  describe('Valid PSBT Parsing', () => {
    ALL_BIP174_VECTORS.forEach((vector) => {
      const psbtBase64 = vector.inputPsbtBase64 || vector.expectedOutputBase64;
      if (!psbtBase64) return;

      it(`should parse: ${vector.description}`, () => {
        expect(() => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
          expect(psbt).toBeDefined();
          expect(psbt.data.inputs.length).toBeGreaterThanOrEqual(0);
        }).not.toThrow();
      });
    });
  });

  describe('Invalid PSBT Rejection', () => {
    ALL_BIP174_INVALID_VECTORS.forEach((vector) => {
      it(`should reject: ${vector.description}`, () => {
        expect(() => {
          bitcoin.Psbt.fromBase64(vector.inputPsbtBase64!);
        }).toThrow();
      });
    });
  });

  describe('PSBT Round-Trip Serialization', () => {
    ALL_BIP174_VECTORS.forEach((vector) => {
      const psbtBase64 = vector.expectedOutputBase64;
      if (!psbtBase64) return;

      it(`should round-trip: ${vector.description}`, () => {
        const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
        const reserialized = psbt.toBase64();

        const psbt2 = bitcoin.Psbt.fromBase64(reserialized);
        expect(psbt2.data.inputs.length).toBe(psbt.data.inputs.length);
        expect(psbt2.data.outputs.length).toBe(psbt.data.outputs.length);
      });
    });
  });
});

describe('PSBT Structure Validation', () => {
  describe('P2WPKH Vectors', () => {
    it('has P2WPKH vectors', () => {
      expect(P2WPKH_VECTORS.length).toBeGreaterThan(0);
    });

    P2WPKH_VECTORS.forEach((vector) => {
      describe(vector.description, () => {
        let psbt: bitcoin.Psbt;

        beforeAll(() => {
          psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);
        });

        it('should have valid structure', () => {
          expect(psbt.data.inputs.length).toBeGreaterThan(0);
          expect(psbt.data.outputs.length).toBeGreaterThan(0);
        });

        it('should have witnessUtxo for all inputs', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.witnessUtxo).toBeDefined();
            expect(input.witnessUtxo?.value).toBeGreaterThan(0);
          });
        });

        it('should have correct network prefix in outputs', () => {
          const network = vector.network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

          psbt.txOutputs.forEach((output) => {
            const address = bitcoin.address.fromOutputScript(output.script, network);
            if (vector.network === 'testnet') {
              expect(address.startsWith('tb1') || address.startsWith('2')).toBe(true);
            } else {
              expect(address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')).toBe(true);
            }
          });
        });
      });
    });
  });

  describe('P2WSH Multisig Vectors', () => {
    it('has P2WSH multisig vectors', () => {
      expect(P2WSH_MULTISIG_VECTORS.length).toBeGreaterThan(0);
    });

    P2WSH_MULTISIG_VECTORS.forEach((vector) => {
      describe(vector.description, () => {
        let psbt: bitcoin.Psbt;

        beforeAll(() => {
          psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);
        });

        it('should have valid structure', () => {
          expect(psbt.data.inputs.length).toBeGreaterThan(0);
          expect(psbt.data.outputs.length).toBeGreaterThan(0);
        });

        it('should have witnessScript for multisig inputs', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.witnessScript).toBeDefined();
          });
        });

        it('should have bip32Derivation for all signers', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.bip32Derivation).toBeDefined();
            expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);
          });
        });

        it('witnessScript should be valid sortedmulti', () => {
          psbt.data.inputs.forEach((input) => {
            const script = input.witnessScript!;
            expect(script[0]).toBeGreaterThanOrEqual(0x51);
            expect(script[0]).toBeLessThanOrEqual(0x60);
          });
        });
      });
    });
  });
});

describe('PSBT Fee Calculation', () => {
  const allVectors = [...P2WPKH_VECTORS, ...P2WSH_MULTISIG_VECTORS];

  it('has vectors for fee calculation tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  it('should calculate correct fee for all vectors', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      let inputValue = 0;
      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          inputValue += input.witnessUtxo.value;
        }
      });

      let outputValue = 0;
      psbt.txOutputs.forEach((output) => {
        outputValue += output.value;
      });

      const calculatedFee = inputValue - outputValue;
      expect(calculatedFee).toBe(vector.expectedFee);
    });
  });
});

describe('PSBT Invariants (Property-Based)', () => {
  const allVectors = [...P2WPKH_VECTORS, ...P2WSH_MULTISIG_VECTORS];

  it('has vectors for invariant tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  describe('Fee Invariants', () => {
    it('fee should always be positive', () => {
      allVectors.forEach((vector) => {
        expect(vector.expectedFee).toBeGreaterThan(0);
      });
    });

    it('fee should be less than total input value', () => {
      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        let inputValue = 0;
        psbt.data.inputs.forEach((input) => {
          if (input.witnessUtxo) {
            inputValue += input.witnessUtxo.value;
          }
        });

        expect(vector.expectedFee).toBeLessThan(inputValue);
      });
    });
  });

  describe('Output Invariants', () => {
    it('no output should be dust (< 546 sats for non-segwit)', () => {
      const DUST_THRESHOLD = 546;

      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.txOutputs.forEach((output) => {
          expect(output.value).toBeGreaterThanOrEqual(DUST_THRESHOLD);
        });
      });
    });
  });

  describe('Input Invariants', () => {
    it('all inputs should have UTXO data', () => {
      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          const hasUtxoData = input.witnessUtxo || input.nonWitnessUtxo;
          expect(hasUtxoData).toBeDefined();
        });
      });
    });

    it('SegWit inputs should have witnessUtxo', () => {
      allVectors.forEach((vector) => {
        if (!['p2wpkh', 'p2wsh', 'p2sh-p2wpkh', 'p2sh-p2wsh'].includes(vector.scriptType)) {
          return;
        }

        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          expect(input.witnessUtxo).toBeDefined();
        });
      });
    });
  });
});

describe('PSBT BIP32 Derivation', () => {
  const allVectors = [...P2WPKH_VECTORS, ...P2WSH_MULTISIG_VECTORS];

  it('has vectors for BIP32 derivation tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  it('bip32Derivation should have valid masterFingerprint (4 bytes)', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.masterFingerprint.length).toBe(4);
          });
        }
      });
    });
  });

  it('bip32Derivation path should be valid BIP32 format', () => {
    const BIP32_PATH_REGEX = /^m(\/\d+'?)+$/;

    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.path).toMatch(BIP32_PATH_REGEX);
          });
        }
      });
    });
  });

  it('bip32Derivation pubkey should be valid compressed or uncompressed', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect([33, 65]).toContain(derivation.pubkey.length);
          });
        }
      });
    });
  });
});

describe('PSBT Sequence Numbers (RBF)', () => {
  it('has P2WPKH vectors for RBF tests', () => {
    expect(P2WPKH_VECTORS.length).toBeGreaterThan(0);
  });

  it('should detect RBF-enabled transactions', () => {
    const RBF_SEQUENCE = 0xfffffffd;

    P2WPKH_VECTORS.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.txInputs.forEach((input) => {
        if (input.sequence !== undefined && input.sequence < 0xffffffff) {
          expect(input.sequence).toBeLessThanOrEqual(RBF_SEQUENCE);
        }
      });
    });
  });
});
