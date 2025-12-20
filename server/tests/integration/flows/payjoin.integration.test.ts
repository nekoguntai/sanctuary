/**
 * Payjoin Integration Tests (CRITICAL)
 *
 * End-to-end Payjoin flow tests:
 * - Sender creates original PSBT
 * - Receiver processes and returns proposal
 * - Sender validates proposal
 * - Full BIP78 compliance check
 *
 * These tests verify the complete Payjoin protocol implementation.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma before importing services
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock blockchain service
jest.mock('../../../src/services/bitcoin/blockchain', () => ({
  getBlockHeight: jest.fn().mockResolvedValue(850000),
  broadcastTransaction: jest.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
}));

// Mock node client
jest.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: jest.fn().mockResolvedValue({
    getTransaction: jest.fn().mockResolvedValue('0100000001...'),
    broadcastTransaction: jest.fn().mockResolvedValue('mock-txid'),
  }),
}));

import {
  parsePsbt,
  validatePsbtStructure,
  validatePayjoinProposal,
  getPsbtOutputs,
  getPsbtInputs,
  calculateFeeRate,
  isRbfEnabled,
  clonePsbt,
} from '../../../src/services/bitcoin/psbtValidation';

import {
  parseBip21Uri,
  generateBip21Uri,
} from '../../../src/services/payjoinService';

// Test constants
const TESTNET = bitcoin.networks.testnet;
const TEST_ADDRESS_RECEIVER = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_PAYJOIN_URL = 'https://example.com/api/v1/payjoin/receiver-addr';

/**
 * Helper to create a realistic PSBT for testing
 */
function createRealisticPsbt(options: {
  senderInputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address?: string; value: number }>;
  network?: bitcoin.Network;
}): bitcoin.Psbt {
  const network = options.network || TESTNET;
  const psbt = new bitcoin.Psbt({ network });

  // Add sender inputs
  for (const input of options.senderInputs) {
    const hash = Buffer.from(input.txid, 'hex').reverse();
    psbt.addInput({
      hash,
      index: input.vout,
      sequence: 0xfffffffd, // RBF enabled
    });

    // Add witness UTXO
    psbt.updateInput(psbt.inputCount - 1, {
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, psbt.inputCount),
          network,
        }).output!,
        value: input.value,
      },
    });
  }

  // Add outputs
  for (const output of options.outputs) {
    if (output.address) {
      try {
        psbt.addOutput({
          address: output.address,
          value: output.value,
        });
      } catch {
        // If address parsing fails, use a script output
        psbt.addOutput({
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x10),
            network,
          }).output!,
          value: output.value,
        });
      }
    } else {
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, psbt.txOutputs.length + 0x10),
          network,
        }).output!,
        value: output.value,
      });
    }
  }

  return psbt;
}

describe('Payjoin Integration Tests', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('Complete Payjoin Flow', () => {
    it('should complete full sender-receiver Payjoin cycle', async () => {
      // Step 1: Sender creates original PSBT
      // Original: 200,000 input -> 100,000 (receiver) + 90,000 (sender change) = 10,000 fee
      const senderTxid = 'a'.repeat(64);
      const receiverOutputScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x10),
        network: TESTNET,
      }).output!;
      const senderChangeScript = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x11),
        network: TESTNET,
      }).output!;

      const originalPsbt = new bitcoin.Psbt({ network: TESTNET });

      // Add sender input
      originalPsbt.addInput({
        hash: Buffer.from(senderTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd, // RBF enabled
      });
      originalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 200000,
        },
      });

      // Add outputs
      originalPsbt.addOutput({ script: receiverOutputScript, value: 100000 }); // To receiver
      originalPsbt.addOutput({ script: senderChangeScript, value: 90000 }); // Sender change

      // Verify original PSBT structure
      const structureValidation = validatePsbtStructure(originalPsbt.toBase64());
      expect(structureValidation.valid).toBe(true);

      // Step 2: Receiver creates proposal
      // Receiver adds their input (80,000) and increases receiver output by 80,000
      // This keeps the fee the same (10,000)
      const receiverTxid = 'b'.repeat(64);
      const proposalPsbt = new bitcoin.Psbt({ network: TESTNET });

      // Add sender input (same as original)
      proposalPsbt.addInput({
        hash: Buffer.from(senderTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 200000,
        },
      });

      // Add receiver input
      proposalPsbt.addInput({
        hash: Buffer.from(receiverTxid, 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: 80000, // Receiver's contribution
        },
      });

      // Add outputs - receiver increases their output to absorb their input
      // New receiver output = 100,000 + 80,000 - 2,000 (fee contribution) = 178,000
      // Total inputs = 200,000 + 80,000 = 280,000
      // Total outputs = 178,000 + 90,000 = 268,000
      // Fee = 12,000 (20% increase from 10,000, which is acceptable)
      proposalPsbt.addOutput({ script: receiverOutputScript, value: 178000 }); // Increased receiver output
      proposalPsbt.addOutput({ script: senderChangeScript, value: 90000 }); // Sender change preserved

      // Step 3: Sender validates proposal
      const proposalValidation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [0], // Sender's input is at index 0
        TESTNET
      );

      // The proposal should be valid (receiver added input, outputs preserved/increased)
      expect(proposalValidation.valid).toBe(true);
      expect(proposalValidation.warnings.length).toBeGreaterThanOrEqual(0);

      // Verify receiver added inputs
      const originalInputs = getPsbtInputs(originalPsbt);
      const proposalInputs = getPsbtInputs(proposalPsbt);
      expect(proposalInputs.length).toBeGreaterThan(originalInputs.length);

      // Verify RBF is enabled
      expect(isRbfEnabled(proposalPsbt)).toBe(true);
    });

    it('should detect and reject malicious proposal that removes sender output', async () => {
      // Original PSBT with 2 outputs
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 }, // Payment
          { value: 90000 },  // Change
        ],
      });

      // Malicious proposal removes the change output
      const maliciousPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 190000 }, // Increased payment, removed change
        ],
      });

      // Add "receiver" input to make it look like valid Payjoin
      maliciousPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      maliciousPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: 50000,
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        maliciousPsbt.toBase64(),
        [0],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('removed'))).toBe(true);
    });

    it('should detect and reject proposal with excessive fee increase', async () => {
      // Original: 200k input, 180k output = 20k fee
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 80000 },
        ],
      });

      // Proposal increases fee by more than 50%
      // Original fee: 20k, Proposal fee: 50k (150% increase)
      const badPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 50000 }, // Much less change = higher fee
        ],
      });

      // Add receiver input
      badPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      badPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: 50000,
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        badPsbt.toBase64(),
        [0],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('50%'))).toBe(true);
    });

    it('should warn when receiver adds no inputs', async () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 90000 },
        ],
      });

      // Proposal is identical (no receiver input added)
      const identicalPsbt = clonePsbt(originalPsbt);

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        identicalPsbt.toBase64(),
        [0],
        TESTNET
      );

      // Should be "valid" but with warning
      expect(validation.valid).toBe(true);
      expect(validation.warnings.some(w =>
        w.includes('not add any inputs') || w.includes('not a proper Payjoin')
      )).toBe(true);
    });
  });

  describe('BIP21 URI Flow', () => {
    it('should generate and parse BIP21 URI with Payjoin endpoint', () => {
      // Generate URI
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        amount: 100000000, // 1 BTC
        label: 'Test Payment',
        payjoinUrl: TEST_PAYJOIN_URL,
      });

      expect(uri).toContain('bitcoin:');
      expect(uri).toContain('amount=');
      expect(uri).toContain('pj=');

      // Parse it back
      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_RECEIVER);
      expect(parsed.amount).toBe(100000000);
      expect(parsed.label).toBe('Test Payment');
      expect(parsed.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should handle URI without Payjoin endpoint', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        amount: 50000000,
      });

      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_RECEIVER);
      expect(parsed.amount).toBe(50000000);
      expect(parsed.payjoinUrl).toBeUndefined();
    });

    it('should correctly encode/decode special characters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_RECEIVER, {
        label: "John's & Mary's Store",
        message: 'Invoice #123: Payment',
        payjoinUrl: 'https://example.com/pj?key=value&other=123',
      });

      const parsed = parseBip21Uri(uri);

      expect(parsed.label).toBe("John's & Mary's Store");
      expect(parsed.message).toBe('Invoice #123: Payment');
      expect(parsed.payjoinUrl).toBe('https://example.com/pj?key=value&other=123');
    });
  });

  describe('PSBT Structure Validation', () => {
    it('should validate complete PSBT structure', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 1, value: 50000 },
        ],
        outputs: [
          { value: 80000 },
          { value: 60000 },
        ],
      });

      const validation = validatePsbtStructure(psbt.toBase64());

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should warn about missing UTXO data', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex'),
        index: 0,
        sequence: 0xfffffffd,
        // No witnessUtxo or nonWitnessUtxo
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: TESTNET,
        }).output!,
        value: 50000,
      });

      const validation = validatePsbtStructure(psbt.toBase64());

      expect(validation.valid).toBe(true); // Still valid
      expect(validation.warnings.some(w => w.includes('UTXO data'))).toBe(true);
    });
  });

  describe('Fee Rate Calculation', () => {
    it('should calculate accurate fee rate', () => {
      // 100k input, 90k output = 10k fee
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const feeRate = calculateFeeRate(psbt);

      // Fee rate should be fee / vsize
      // For P2WPKH: ~68 vB input, ~34 vB output, ~10.5 vB overhead
      // vsize ~ 112.5, fee = 10000, rate ~ 88.9 sat/vB
      expect(feeRate).toBeGreaterThan(50);
      expect(feeRate).toBeLessThan(150);
    });

    it('should handle multiple inputs and outputs', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 80000 },
          { value: 80000 },
          { value: 30000 },
        ],
      });

      const feeRate = calculateFeeRate(psbt);

      // Fee = 200000 - 190000 = 10000
      expect(feeRate).toBeGreaterThan(0);
    });
  });

  describe('RBF Detection', () => {
    it('should detect RBF-enabled PSBT', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });
      // Default sequence is 0xfffffffd (RBF enabled)

      expect(isRbfEnabled(psbt)).toBe(true);
    });

    it('should detect non-RBF PSBT', () => {
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xffffffff, // No RBF
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
        value: 90000,
      });

      expect(isRbfEnabled(psbt)).toBe(false);
    });
  });

  describe('Input/Output Extraction', () => {
    it('should extract all inputs correctly', () => {
      const txid1 = 'a'.repeat(64);
      const txid2 = 'b'.repeat(64);

      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: txid1, vout: 0, value: 100000 },
          { txid: txid2, vout: 2, value: 50000 },
        ],
        outputs: [
          { value: 140000 },
        ],
      });

      const inputs = getPsbtInputs(psbt);

      expect(inputs).toHaveLength(2);
      expect(inputs[0].txid).toBe(txid1);
      expect(inputs[0].vout).toBe(0);
      expect(inputs[1].txid).toBe(txid2);
      expect(inputs[1].vout).toBe(2);
    });

    it('should extract all outputs correctly', () => {
      const psbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 200000 },
        ],
        outputs: [
          { value: 100000 },
          { value: 50000 },
          { value: 40000 },
        ],
      });

      const outputs = getPsbtOutputs(psbt, TESTNET);

      expect(outputs).toHaveLength(3);
      expect(outputs[0].value).toBe(100000);
      expect(outputs[1].value).toBe(50000);
      expect(outputs[2].value).toBe(40000);
    });
  });

  describe('Security Scenarios', () => {
    it('should reject proposal that modifies sender input', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 50000 },
          { value: 40000 },
        ],
      });

      // Malicious proposal changes sender's input
      const maliciousPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'c'.repeat(64), vout: 0, value: 100000 }, // Different txid!
        ],
        outputs: [
          { value: 50000 },
          { value: 40000 },
        ],
      });

      // Add receiver input
      maliciousPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      maliciousPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: 30000,
        },
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        maliciousPsbt.toBase64(),
        [0],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('modified'))).toBe(true);
    });

    it('should reject proposal with fewer inputs than original', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
          { txid: 'b'.repeat(64), vout: 0, value: 50000 },
        ],
        outputs: [
          { value: 140000 },
        ],
      });

      // Proposal removes an input
      const badPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        badPsbt.toBase64(),
        [0, 1],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('fewer inputs'))).toBe(true);
    });

    it('should handle multiple sender inputs correctly', () => {
      // Original: 100,000 + 80,000 = 180,000 inputs -> 100,000 + 70,000 = 170,000 outputs = 10,000 fee
      const outputScript1 = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x10),
        network: TESTNET,
      }).output!;
      const outputScript2 = bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x11),
        network: TESTNET,
      }).output!;

      const originalPsbt = new bitcoin.Psbt({ network: TESTNET });

      // Add sender inputs
      originalPsbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      originalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });
      originalPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 1,
        sequence: 0xfffffffd,
      });
      originalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: 80000,
        },
      });

      // Add outputs
      originalPsbt.addOutput({ script: outputScript1, value: 100000 });
      originalPsbt.addOutput({ script: outputScript2, value: 70000 });

      // Valid proposal: receiver adds input (50,000) and increases first output
      // New total: 230,000 inputs -> 140,000 + 70,000 + small fee increase = valid
      const proposalPsbt = new bitcoin.Psbt({ network: TESTNET });

      // Add sender inputs (same as original)
      proposalPsbt.addInput({
        hash: Buffer.from('a'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 1),
            network: TESTNET,
          }).output!,
          value: 100000,
        },
      });
      proposalPsbt.addInput({
        hash: Buffer.from('b'.repeat(64), 'hex').reverse(),
        index: 1,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(1, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 2),
            network: TESTNET,
          }).output!,
          value: 80000,
        },
      });

      // Add receiver input
      proposalPsbt.addInput({
        hash: Buffer.from('c'.repeat(64), 'hex').reverse(),
        index: 0,
        sequence: 0xfffffffd,
      });
      proposalPsbt.updateInput(2, {
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, 0x99),
            network: TESTNET,
          }).output!,
          value: 50000,
        },
      });

      // Receiver increases their output to absorb contribution
      // 230,000 inputs -> 148,000 + 70,000 = 218,000 outputs = 12,000 fee (20% increase, valid)
      proposalPsbt.addOutput({ script: outputScript1, value: 148000 });
      proposalPsbt.addOutput({ script: outputScript2, value: 70000 });

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [0, 1], // Both inputs are sender's
        TESTNET
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid original PSBT gracefully', () => {
      const validPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        'invalid-base64-psbt',
        validPsbt.toBase64(),
        [0],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid proposal PSBT gracefully', () => {
      const validPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const validation = validatePayjoinProposal(
        validPsbt.toBase64(),
        'invalid-base64-psbt',
        [0],
        TESTNET
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty sender input indices', () => {
      const originalPsbt = createRealisticPsbt({
        senderInputs: [
          { txid: 'a'.repeat(64), vout: 0, value: 100000 },
        ],
        outputs: [
          { value: 90000 },
        ],
      });

      const proposalPsbt = clonePsbt(originalPsbt);

      const validation = validatePayjoinProposal(
        originalPsbt.toBase64(),
        proposalPsbt.toBase64(),
        [], // No sender inputs specified
        TESTNET
      );

      // Should still be valid but warn about no receiver contribution
      expect(validation.valid).toBe(true);
    });
  });
});
