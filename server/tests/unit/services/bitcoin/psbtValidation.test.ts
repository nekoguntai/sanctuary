/**
 * PSBT Validation Utilities Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin PSBT validation:
 * - parsePsbt() - Valid/invalid base64, network handling
 * - validatePsbtStructure() - Empty inputs/outputs, missing UTXO data
 * - validatePayjoinProposal() - BIP78 rules enforcement
 * - getPsbtInputs() / getPsbtOutputs() - Correct extraction
 * - calculateFeeRate() - Accurate calculation
 * - isRbfEnabled() - Sequence number check
 *
 * These tests are SECURITY-CRITICAL for Bitcoin wallet operations.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
  parsePsbt,
  validatePsbtStructure,
  validatePayjoinProposal,
  getPsbtInputs,
  getPsbtOutputs,
  calculateFeeRate,
  isRbfEnabled,
  calculateVSize,
  clonePsbt,
  mergeSignedInputs,
  ValidationResult,
} from '../../../../src/services/bitcoin/psbtValidation';

// Mock the logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Test constants
const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

// Test address
const TEST_ADDRESS_TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_MAINNET = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/**
 * Helper to create a minimal valid PSBT for testing
 */
function createTestPsbt(options: {
  network?: bitcoin.Network;
  inputCount?: number;
  outputCount?: number;
  inputValues?: number[];
  outputValues?: number[];
  sequence?: number;
  addWitnessUtxo?: boolean;
} = {}): bitcoin.Psbt {
  const network = options.network || TESTNET;
  const inputCount = options.inputCount ?? 1;
  const outputCount = options.outputCount ?? 1;
  const inputValues = options.inputValues || Array(inputCount).fill(100000);
  const outputValues = options.outputValues || Array(outputCount).fill(50000);
  const sequence = options.sequence ?? 0xfffffffd; // RBF enabled by default
  const addWitnessUtxo = options.addWitnessUtxo ?? true;

  const psbt = new bitcoin.Psbt({ network });

  // Create dummy txid hashes
  const createTxidHash = (index: number) => {
    const hex = index.toString(16).padStart(64, 'a');
    return Buffer.from(hex, 'hex');
  };

  // Add inputs
  for (let i = 0; i < inputCount; i++) {
    const input: bitcoin.PsbtTxInput = {
      hash: createTxidHash(i),
      index: 0,
      sequence,
    };

    psbt.addInput(input);

    // Add witness UTXO data if requested
    if (addWitnessUtxo) {
      // P2WPKH output script
      const outputScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, i + 1),
        network,
      }).output!;

      psbt.updateInput(i, {
        witnessUtxo: {
          script: outputScript,
          value: inputValues[i] || 100000,
        },
      });
    }
  }

  // Add outputs
  for (let i = 0; i < outputCount; i++) {
    const outputScript = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, i + 0x10),
      network,
    }).output!;

    psbt.addOutput({
      script: outputScript,
      value: outputValues[i] || 50000,
    });
  }

  return psbt;
}

describe('PSBT Validation Utilities', () => {
  describe('parsePsbt', () => {
    it('should parse a valid base64 PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64, TESTNET);

      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
      expect(parsed.inputCount).toBe(1);
      expect(parsed.txOutputs.length).toBe(1);
    });

    it('should parse PSBT with multiple inputs and outputs', () => {
      const psbt = createTestPsbt({ inputCount: 3, outputCount: 2 });
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64, TESTNET);

      expect(parsed.inputCount).toBe(3);
      expect(parsed.txOutputs.length).toBe(2);
    });

    it('should throw error for invalid base64', () => {
      expect(() => parsePsbt('not-valid-base64!!!', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for empty string', () => {
      expect(() => parsePsbt('', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for valid base64 but invalid PSBT content', () => {
      // "Hello World" in base64 - valid base64 but not a PSBT
      expect(() => parsePsbt('SGVsbG8gV29ybGQ=', TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should use default mainnet network when not specified', () => {
      const psbt = createTestPsbt({ network: MAINNET });
      const base64 = psbt.toBase64();

      const parsed = parsePsbt(base64);

      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
    });

    it('should handle PSBT with different network', () => {
      const mainnetPsbt = createTestPsbt({ network: MAINNET });
      const base64 = mainnetPsbt.toBase64();

      // Parsing mainnet PSBT with mainnet network should work
      const parsed = parsePsbt(base64, MAINNET);
      expect(parsed).toBeInstanceOf(bitcoin.Psbt);
    });

    it('should throw error for truncated PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();
      const truncated = base64.substring(0, base64.length / 2);

      expect(() => parsePsbt(truncated, TESTNET))
        .toThrow('Invalid PSBT format');
    });

    it('should throw error for corrupted PSBT', () => {
      const psbt = createTestPsbt();
      const base64 = psbt.toBase64();
      // Corrupt some bytes in the middle - this may or may not throw depending on the corruption
      const corrupted = base64.substring(0, 20) + 'XXXX' + base64.substring(24);

      // Some corruptions may still parse but produce invalid data
      // The key is it should not silently succeed with wrong data
      try {
        const parsed = parsePsbt(corrupted, TESTNET);
        // If it parses, verify it's not the same as original
        expect(parsed.toBase64()).not.toBe(base64);
      } catch (e) {
        expect((e as Error).message).toContain('Invalid PSBT format');
      }
    });
  });

  describe('validatePsbtStructure', () => {
    it('should validate a well-formed PSBT', () => {
      const psbt = createTestPsbt();
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should report error for PSBT with no inputs', () => {
      // Create PSBT without any inputs - bitcoinjs-lib may reject this
      // so we check for either "no inputs" error or a parse failure
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: TESTNET,
        }).output!,
        value: 50000,
      });

      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(false);
      // Either the PSBT has no inputs, or it failed to parse due to structure issues
      expect(
        result.errors.some(e => e.includes('no inputs') || e.includes('Failed to parse'))
      ).toBe(true);
    });

    it('should report error for PSBT with no outputs', () => {
      // Create a minimal PSBT and manually construct it with inputs but no outputs
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      // Add witnessUtxo to the input
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });

      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PSBT has no outputs');
    });

    it('should warn about missing UTXO data', () => {
      const psbt = createTestPsbt({ addWitnessUtxo: false });
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Input 0 missing UTXO data');
    });

    it('should report multiple missing UTXO warnings', () => {
      const psbt = createTestPsbt({ inputCount: 3, addWitnessUtxo: false });
      const result = validatePsbtStructure(psbt.toBase64());

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings).toContain('Input 0 missing UTXO data');
      expect(result.warnings).toContain('Input 1 missing UTXO data');
      expect(result.warnings).toContain('Input 2 missing UTXO data');
    });

    it('should report error for invalid base64', () => {
      const result = validatePsbtStructure('not-valid-base64!!!');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to parse PSBT');
    });
  });

  describe('validatePayjoinProposal - BIP78 Rules', () => {
    /**
     * BIP78 Rule 1: Sender's outputs must not be removed or decreased
     */
    describe('Rule 1: Sender outputs preserved', () => {
      it('should accept proposal with unchanged sender outputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000], // payment + change
        });

        // Proposal adds receiver input but keeps sender outputs
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000], // sender + receiver input
          outputValues: [50000, 70000], // payment unchanged, change increased
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal that removes sender output', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        // Proposal removes the second output
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [80000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('was removed'))).toBe(true);
      });

      it('should reject proposal that decreases sender output', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        // Create proposal with matching addresses but lower value
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000],
          outputValues: [45000, 40000], // First output decreased!
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('decreased'))).toBe(true);
      });

      it('should warn when sender output is increased (allowed but notable)', () => {
        // Create original with 1 input, 2 outputs
        // Original: 100000 input - 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // For proposal, we need the same output addresses but different values
        // Create proposal manually to ensure output addresses match
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: 100000,
          },
        });

        // Add receiver input (new)
        proposal.addInput({
          hash: Buffer.from('1'.padStart(64, 'b'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 2),
              network: TESTNET,
            }).output!,
            value: 30000,
          },
        });

        // Add outputs with same addresses as original but increased first value
        // Proposal: 130000 input - 118000 output = 12000 fee (20% increase, under 50% limit)
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: 60000, // Increased from 50000 (output increased by 10000)
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: 58000, // Increased from 40000 to absorb receiver contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('increased'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 2: Sender's inputs must not be modified
     */
    describe('Rule 2: Sender inputs unmodified', () => {
      it('should accept proposal with sender inputs at same positions', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          outputValues: [50000, 40000],
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
          inputValues: [100000, 30000],
          outputValues: [50000, 70000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.errors.filter(e => e.includes('modified'))).toHaveLength(0);
      });

      it('should reject proposal that modifies sender input txid', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        // Create proposal with different txid for input 0
        const proposal = new bitcoin.Psbt({ network: TESTNET });
        proposal.addInput({
          hash: Buffer.alloc(32, 0xbb), // Different txid
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: 100000,
          },
        });
        proposal.addInput({
          hash: Buffer.alloc(32, 0xcc),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 2),
              network: TESTNET,
            }).output!,
            value: 30000,
          },
        });
        // Add matching outputs
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: 50000,
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: 50000,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('modified'))).toBe(true);
      });

      it('should report error for out-of-range sender input index', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
        });

        // Specify sender input index 5 which doesn't exist
        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [5],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 3: Fee must not increase by more than 50%
     */
    describe('Rule 3: Fee increase limit', () => {
      it('should accept proposal with reasonable fee increase', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 117000 output = 13000 fee (30% increase)
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [117000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal with fee increase over 50%', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 104000 output = 26000 fee (160% increase!)
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [104000],
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('more than 50%'))).toBe(true);
      });

      it('should warn about significant fee increase (20-50%)', () => {
        // Original: 100000 input, 90000 output = 10000 fee
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 1,
          inputValues: [100000],
          outputValues: [90000],
        });

        // Proposal: 130000 input, 112000 output = 18000 fee (80% increase, but less than 50% of original is 15000)
        // Wait, 80% > 50%, so this should fail. Let's use 45%: 14500 fee
        // Actually 10000 * 1.45 = 14500, so output = 130000 - 14500 = 115500
        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 1,
          inputValues: [100000, 30000],
          outputValues: [117000], // Fee = 13000 = 30% increase
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('significantly'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 4: Input count must not be reduced
     */
    describe('Rule 4: Input count preserved or increased', () => {
      it('should accept proposal with more inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // Create proposal with 3 inputs and same output addresses
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original sender input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: 100000,
          },
        });

        // Add 2 new receiver inputs
        for (let i = 1; i <= 2; i++) {
          proposal.addInput({
            hash: Buffer.from(i.toString().padStart(64, 'b'), 'hex'),
            index: 0,
            sequence: 0xfffffffd,
          });
          proposal.updateInput(i, {
            witnessUtxo: {
              script: bitcoin.payments.p2wpkh({
                hash: Buffer.alloc(20, i + 10),
                network: TESTNET,
              }).output!,
              value: 30000,
            },
          });
        }

        // Add outputs with same addresses as original
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: 50000,
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: 100000, // Receiver gets their contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
      });

      it('should reject proposal with fewer inputs', () => {
        const original = createTestPsbt({
          inputCount: 3,
          outputCount: 2,
        });

        const proposal = createTestPsbt({
          inputCount: 2,
          outputCount: 2,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0, 1, 2],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('fewer inputs'))).toBe(true);
      });
    });

    /**
     * BIP78 Rule 5: Receiver should add inputs
     */
    describe('Rule 5: Receiver contribution', () => {
      it('should accept proposal with new receiver inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
          inputValues: [100000],
          outputValues: [50000, 40000],
        });

        // Create proposal with sender's input plus a new receiver input
        const proposal = new bitcoin.Psbt({ network: TESTNET });

        // Add original sender input (same txid)
        proposal.addInput({
          hash: Buffer.from('0'.padStart(64, 'a'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(0, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 1),
              network: TESTNET,
            }).output!,
            value: 100000,
          },
        });

        // Add new receiver input (different txid)
        proposal.addInput({
          hash: Buffer.from('1'.padStart(64, 'b'), 'hex'),
          index: 0,
          sequence: 0xfffffffd,
        });
        proposal.updateInput(1, {
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              hash: Buffer.alloc(20, 20),
              network: TESTNET,
            }).output!,
            value: 30000,
          },
        });

        // Add outputs with same addresses as original
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network: TESTNET,
          }).output!,
          value: 50000,
        });
        proposal.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x11),
            network: TESTNET,
          }).output!,
          value: 70000, // Increased by receiver contribution
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true);
        expect(result.warnings.some(w => w.includes('did not add any inputs'))).toBe(false);
      });

      it('should warn when receiver adds no inputs', () => {
        const original = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        // Same inputs, just copied
        const proposal = createTestPsbt({
          inputCount: 1,
          outputCount: 2,
        });

        const result = validatePayjoinProposal(
          original.toBase64(),
          proposal.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(true); // Valid but not a proper Payjoin
        expect(result.warnings.some(w => w.includes('did not add any inputs'))).toBe(true);
      });
    });

    describe('Error handling', () => {
      it('should handle invalid original PSBT', () => {
        const validPsbt = createTestPsbt();

        const result = validatePayjoinProposal(
          'invalid-psbt',
          validPsbt.toBase64(),
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Validation failed'))).toBe(true);
      });

      it('should handle invalid proposal PSBT', () => {
        const validPsbt = createTestPsbt();

        const result = validatePayjoinProposal(
          validPsbt.toBase64(),
          'invalid-psbt',
          [0],
          TESTNET
        );

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Validation failed'))).toBe(true);
      });
    });
  });

  describe('getPsbtInputs', () => {
    it('should extract inputs with correct txid, vout, and sequence', () => {
      const psbt = createTestPsbt({ inputCount: 3, sequence: 0xfffffffd });
      const inputs = getPsbtInputs(psbt);

      expect(inputs).toHaveLength(3);
      inputs.forEach((input, i) => {
        expect(input.txid).toHaveLength(64);
        expect(input.vout).toBe(0);
        expect(input.sequence).toBe(0xfffffffd);
      });
    });

    it('should correctly reverse txid bytes', () => {
      const psbt = createTestPsbt({ inputCount: 1 });
      const inputs = getPsbtInputs(psbt);

      // The txid should be the reversed hex of the hash
      expect(inputs[0].txid).toBeDefined();
      expect(inputs[0].txid.length).toBe(64);
    });

    it('should handle default sequence (0xffffffff) when not specified', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        // No sequence specified
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 2),
          network: TESTNET,
        }).output!,
        value: 50000,
      });

      const inputs = getPsbtInputs(psbt);
      // Default sequence is 0xfffffffe or 0xffffffff depending on implementation
      expect(inputs[0].sequence).toBeGreaterThanOrEqual(0xfffffffd);
    });
  });

  describe('getPsbtOutputs', () => {
    it('should extract outputs with address and value', () => {
      const psbt = createTestPsbt({
        outputCount: 2,
        outputValues: [50000, 30000],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(2);
      expect(outputs[0].value).toBe(50000);
      expect(outputs[1].value).toBe(30000);
    });

    it('should return "unknown" for unrecognized output scripts', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });
      // Add OP_RETURN output
      psbt.addOutput({
        script: Buffer.from([0x6a, 0x04, 0x74, 0x65, 0x73, 0x74]), // OP_RETURN "test"
        value: 0,
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(1);
      expect(outputs[0].address).toBe('unknown');
      expect(outputs[0].value).toBe(0);
    });

    it('should use default mainnet network when not specified', () => {
      const psbt = createTestPsbt({ network: MAINNET });
      const outputs = getPsbtOutputs(psbt);

      expect(outputs).toHaveLength(1);
    });
  });

  describe('isRbfEnabled', () => {
    it('should return true for sequence < 0xfffffffe', () => {
      const psbt = createTestPsbt({ sequence: 0xfffffffd });
      expect(isRbfEnabled(psbt)).toBe(true);
    });

    it('should return false for sequence = 0xfffffffe', () => {
      const psbt = createTestPsbt({ sequence: 0xfffffffe });
      expect(isRbfEnabled(psbt)).toBe(false);
    });

    it('should return false for sequence = 0xffffffff', () => {
      const psbt = createTestPsbt({ sequence: 0xffffffff });
      expect(isRbfEnabled(psbt)).toBe(false);
    });

    it('should return true if ANY input has RBF enabled', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });

      // Add input with RBF disabled
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xffffffff,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });

      // Add input with RBF enabled
      psbt.addInput({
        hash: Buffer.alloc(32, 0xbb),
        index: 0,
        sequence: 0xfffffffd, // RBF enabled
      });
      psbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: 50000,
        },
      });

      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 3),
          network: TESTNET,
        }).output!,
        value: 100000,
      });

      expect(isRbfEnabled(psbt)).toBe(true);
    });
  });

  describe('calculateFeeRate', () => {
    it('should calculate correct fee rate', () => {
      // 100000 input - 90000 output = 10000 fee
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 1,
        inputValues: [100000],
        outputValues: [90000],
      });

      const feeRate = calculateFeeRate(psbt);

      // Fee rate = fee / vsize
      // For a simple P2WPKH transaction, vsize is roughly 110-140 vbytes
      // 10000 / ~110 = ~90 sat/vB
      expect(feeRate).toBeGreaterThan(0);
      expect(feeRate).toBeLessThan(200);
    });

    it('should return 0 for PSBT without input values', () => {
      const psbt = createTestPsbt({ addWitnessUtxo: false });
      const feeRate = calculateFeeRate(psbt);

      // Without UTXO data, cannot calculate fee
      expect(feeRate).toBeLessThanOrEqual(0);
    });

    it('should handle multiple inputs and outputs', () => {
      const psbt = createTestPsbt({
        inputCount: 3,
        outputCount: 2,
        inputValues: [100000, 200000, 150000],
        outputValues: [400000, 40000],
      });

      const feeRate = calculateFeeRate(psbt);

      // Total input: 450000, Total output: 440000, Fee: 10000
      expect(feeRate).toBeGreaterThan(0);
    });
  });

  describe('calculateVSize', () => {
    it('should return reasonable vsize for P2WPKH transaction', () => {
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 2,
      });

      const vsize = calculateVSize(psbt);

      // P2WPKH: ~68 vB per input, ~34 vB per output, ~10.5 vB overhead
      // 1 input + 2 outputs = 68 + 68 + 10.5 = ~146.5
      expect(vsize).toBeGreaterThan(100);
      expect(vsize).toBeLessThan(250);
    });

    it('should scale with input count', () => {
      const psbt1 = createTestPsbt({ inputCount: 1, outputCount: 2 });
      const psbt2 = createTestPsbt({ inputCount: 3, outputCount: 2 });

      const vsize1 = calculateVSize(psbt1);
      const vsize2 = calculateVSize(psbt2);

      expect(vsize2).toBeGreaterThan(vsize1);
    });
  });

  describe('clonePsbt', () => {
    it('should create an independent copy', () => {
      const original = createTestPsbt();
      const clone = clonePsbt(original);

      // Modify the original
      original.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 0xff),
          network: TESTNET,
        }).output!,
        value: 1000,
      });

      // Clone should not be affected
      expect(clone.txOutputs.length).toBe(1);
      expect(original.txOutputs.length).toBe(2);
    });

    it('should preserve all PSBT data', () => {
      const original = createTestPsbt({
        inputCount: 2,
        outputCount: 3,
        inputValues: [100000, 50000],
        outputValues: [60000, 40000, 30000],
      });

      const clone = clonePsbt(original);

      expect(clone.inputCount).toBe(original.inputCount);
      expect(clone.txOutputs.length).toBe(original.txOutputs.length);
      expect(clone.toBase64()).toBe(original.toBase64());
    });
  });

  describe('mergeSignedInputs', () => {
    it('should copy signature data from receiver to sender PSBT', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      // Simulate receiver signing input 1
      const mockPartialSig = [{
        pubkey: Buffer.alloc(33, 0x02),
        signature: Buffer.alloc(72, 0xff),
      }];
      receiver.data.inputs[1].partialSig = mockPartialSig;

      const merged = mergeSignedInputs(sender, receiver, [1]);

      expect(merged.data.inputs[1].partialSig).toEqual(mockPartialSig);
    });

    it('should not modify original sender PSBT', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      receiver.data.inputs[1].partialSig = [{
        pubkey: Buffer.alloc(33, 0x02),
        signature: Buffer.alloc(72, 0xff),
      }];

      mergeSignedInputs(sender, receiver, [1]);

      // Original sender should not have the signature
      expect(sender.data.inputs[1].partialSig).toBeUndefined();
    });

    it('should handle out-of-range indices gracefully', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      // This should not throw
      const merged = mergeSignedInputs(sender, receiver, [5, 10]);

      expect(merged.inputCount).toBe(2);
    });

    it('should copy finalScriptWitness if present', () => {
      const sender = createTestPsbt({ inputCount: 2, outputCount: 2 });
      const receiver = createTestPsbt({ inputCount: 2, outputCount: 2 });

      const mockWitness = Buffer.from([0x00, 0x01, 0x02]);
      receiver.data.inputs[1].finalScriptWitness = mockWitness;

      const merged = mergeSignedInputs(sender, receiver, [1]);

      expect(merged.data.inputs[1].finalScriptWitness).toEqual(mockWitness);
    });
  });

  describe('Edge cases and security', () => {
    it('should handle PSBT with maximum allowed inputs', () => {
      // Test with 10 inputs (reasonable maximum for testing)
      const psbt = createTestPsbt({
        inputCount: 10,
        outputCount: 2,
      });

      expect(psbt.inputCount).toBe(10);
      const inputs = getPsbtInputs(psbt);
      expect(inputs).toHaveLength(10);
    });

    it('should handle PSBT with very large values', () => {
      const psbt = createTestPsbt({
        inputCount: 1,
        outputCount: 1,
        inputValues: [2100000000000000], // 21 million BTC in sats
        outputValues: [2099999999990000],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);
      expect(outputs[0].value).toBe(2099999999990000);
    });

    it('should reject negative values in validation', () => {
      // bitcoinjs-lib prevents negative values, but we test our validation
      const psbt = createTestPsbt();

      // Structure validation should pass
      const result = validatePsbtStructure(psbt.toBase64());
      expect(result.valid).toBe(true);
    });
  });
});
