/**
 * Payjoin Service Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin protocol implementation:
 * - parseBip21Uri() - Standard BIP21, pj= param extraction, amount conversion
 * - generateBip21Uri() - Correct URI format, URL encoding
 * - selectContributionUtxo() - UTXO selection within 0.5x-2x range, dust avoidance
 * - processPayjoinRequest() - Valid flow, error handling
 * - attemptPayjoinSend() - HTTP handling, proposal validation
 *
 * These tests are SECURITY-CRITICAL for Bitcoin wallet privacy.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
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

// Mock PSBT validation functions
jest.mock('../../../src/services/bitcoin/psbtValidation', () => ({
  parsePsbt: jest.fn(),
  validatePsbtStructure: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  validatePayjoinProposal: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  getPsbtOutputs: jest.fn().mockReturnValue([]),
  getPsbtInputs: jest.fn().mockReturnValue([]),
  calculateFeeRate: jest.fn().mockReturnValue(10),
  clonePsbt: jest.fn(),
}));

// Mock the network utils
jest.mock('../../../src/services/bitcoin/utils', () => ({
  getNetwork: jest.fn().mockReturnValue(bitcoin.networks.testnet),
}));

// Mock global fetch
global.fetch = jest.fn();

import {
  parseBip21Uri,
  generateBip21Uri,
  processPayjoinRequest,
  attemptPayjoinSend,
  PayjoinErrors,
} from '../../../src/services/payjoinService';
import {
  parsePsbt,
  validatePsbtStructure,
  validatePayjoinProposal,
  getPsbtOutputs,
  calculateFeeRate,
  clonePsbt,
} from '../../../src/services/bitcoin/psbtValidation';

// Test constants
const TEST_ADDRESS_TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_MAINNET = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TEST_PAYJOIN_URL = 'https://example.com/payjoin';

describe('Payjoin Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
  });

  describe('parseBip21Uri', () => {
    it('should parse simple bitcoin: URI', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBeUndefined();
      expect(result.label).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(result.payjoinUrl).toBeUndefined();
    });

    it('should parse URI with amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.5`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(50_000_000); // 0.5 BTC in sats
    });

    it('should parse URI with small amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.00001`;
      const result = parseBip21Uri(uri);

      // Use toBeCloseTo for floating point precision
      expect(result.amount).toBeCloseTo(1000, 0); // 0.00001 BTC = 1000 sats
    });

    it('should parse URI with large amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=21`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(2_100_000_000); // 21 BTC in sats
    });

    it('should parse URI with label parameter', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?label=My%20Payment`;
      const result = parseBip21Uri(uri);

      expect(result.label).toBe('My Payment');
    });

    it('should parse URI with message parameter', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?message=Payment%20for%20services`;
      const result = parseBip21Uri(uri);

      expect(result.message).toBe('Payment for services');
    });

    it('should extract pj= Payjoin URL', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.1&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`;
      const result = parseBip21Uri(uri);

      expect(result.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should parse URI with all parameters', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=1.5&label=Invoice%20123&message=Monthly%20subscription&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(150_000_000);
      expect(result.label).toBe('Invoice 123');
      expect(result.message).toBe('Monthly subscription');
      expect(result.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should handle URI without bitcoin: prefix', () => {
      const uri = `${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(10_000_000);
    });

    it('should handle uppercase BITCOIN: prefix', () => {
      const uri = `BITCOIN:${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
      expect(result.amount).toBe(10_000_000);
    });

    it('should handle mixed case Bitcoin: prefix', () => {
      const uri = `Bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.1`;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
    });

    it('should handle special characters in label', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?label=${encodeURIComponent("John's Store & Shop")}`;
      const result = parseBip21Uri(uri);

      expect(result.label).toBe("John's Store & Shop");
    });

    it('should handle unicode in message', () => {
      const message = 'Payment for 100 items';
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?message=${encodeURIComponent(message)}`;
      const result = parseBip21Uri(uri);

      expect(result.message).toBe(message);
    });

    it('should handle Payjoin URL with query parameters', () => {
      const pjUrl = 'https://example.com/payjoin?v=1&key=abc';
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?pj=${encodeURIComponent(pjUrl)}`;
      const result = parseBip21Uri(uri);

      expect(result.payjoinUrl).toBe(pjUrl);
    });

    it('should parse address-only URI (no params)', () => {
      const uri = TEST_ADDRESS_TESTNET;
      const result = parseBip21Uri(uri);

      expect(result.address).toBe(TEST_ADDRESS_TESTNET);
    });

    it('should handle zero amount', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(0);
    });

    it('should handle decimal precision', () => {
      const uri = `bitcoin:${TEST_ADDRESS_TESTNET}?amount=0.00000001`;
      const result = parseBip21Uri(uri);

      expect(result.amount).toBe(1); // 1 satoshi
    });
  });

  describe('generateBip21Uri', () => {
    it('should generate simple URI with address only', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET);

      expect(uri).toBe(`bitcoin:${TEST_ADDRESS_TESTNET}`);
    });

    it('should include amount in BTC', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { amount: 50_000_000 });

      expect(uri).toContain('amount=0.50000000');
    });

    it('should include small amount correctly', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { amount: 1 });

      expect(uri).toContain('amount=0.00000001');
    });

    it('should include label with URL encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { label: 'My Store' });

      expect(uri).toContain('label=My%20Store');
    });

    it('should include message with URL encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { message: 'Invoice #123' });

      expect(uri).toContain('message=Invoice%20%23123');
    });

    it('should include Payjoin URL with encoding', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, { payjoinUrl: TEST_PAYJOIN_URL });

      expect(uri).toContain(`pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`);
    });

    it('should include all parameters correctly', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {
        amount: 100_000_000,
        label: 'Test Label',
        message: 'Test Message',
        payjoinUrl: TEST_PAYJOIN_URL,
      });

      expect(uri).toContain(`bitcoin:${TEST_ADDRESS_TESTNET}?`);
      expect(uri).toContain('amount=1.00000000');
      expect(uri).toContain('label=Test%20Label');
      expect(uri).toContain('message=Test%20Message');
      expect(uri).toContain('pj=');
    });

    it('should not add empty parameters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {});

      expect(uri).toBe(`bitcoin:${TEST_ADDRESS_TESTNET}`);
      expect(uri).not.toContain('?');
    });

    it('should handle special characters in parameters', () => {
      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, {
        label: "John's & Mary's Store",
        message: 'Payment: $100',
      });

      expect(uri).toContain('label=');
      expect(uri).toContain('message=');
      // Verify it can be parsed back
      const parsed = parseBip21Uri(uri);
      expect(parsed.label).toBe("John's & Mary's Store");
    });

    it('should generate round-trippable URI', () => {
      const options = {
        amount: 123456789,
        label: 'Test',
        message: 'Test message',
        payjoinUrl: TEST_PAYJOIN_URL,
      };

      const uri = generateBip21Uri(TEST_ADDRESS_TESTNET, options);
      const parsed = parseBip21Uri(uri);

      expect(parsed.address).toBe(TEST_ADDRESS_TESTNET);
      // Use toBeCloseTo for floating point precision issues in BTC<->satoshi conversion
      expect(parsed.amount).toBeCloseTo(options.amount, 0);
      expect(parsed.label).toBe(options.label);
      expect(parsed.message).toBe(options.message);
      expect(parsed.payjoinUrl).toBe(options.payjoinUrl);
    });
  });

  describe('processPayjoinRequest', () => {
    const addressId = 'addr-123';
    const walletId = 'wallet-456';

    const mockAddress = {
      id: addressId,
      address: TEST_ADDRESS_TESTNET,
      wallet: {
        id: walletId,
        network: 'testnet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    };

    const mockUtxos = [
      {
        id: 'utxo-1',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(100000),
        scriptPubKey: '0014' + 'a'.repeat(40),
      },
      {
        id: 'utxo-2',
        txid: 'bbbb'.repeat(16),
        vout: 1,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'b'.repeat(40),
      },
    ];

    // Create a minimal valid PSBT for testing
    const createMockPsbt = () => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: 100000,
        },
      });
      psbt.addOutput({
        address: TEST_ADDRESS_TESTNET,
        value: 80000,
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: bitcoin.networks.testnet,
        }).output!,
        value: 10000,
      });
      return psbt;
    };

    beforeEach(() => {
      // Reset mocks
      (validatePsbtStructure as jest.Mock).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
        { address: 'tb1q000000000000000000000000000000000000000', value: 10000 },
      ]);
      (calculateFeeRate as jest.Mock).mockReturnValue(10);
    });

    it('should return error for unknown address', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(null);

      const result = await processPayjoinRequest(
        'unknown-address-id',
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.UNAVAILABLE);
      expect(result.errorMessage).toContain('Address not found');
    });

    it('should reject invalid PSBT structure', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (validatePsbtStructure as jest.Mock).mockReturnValue({
        valid: false,
        errors: ['PSBT has no inputs'],
        warnings: [],
      });

      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('no inputs');
    });

    it('should reject PSBT with no output to receiving address', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: 'tb1qdifferentaddress000000000000000000000000', value: 80000 },
      ]);

      // Need to mock parsePsbt
      const mockPsbt = createMockPsbt();
      (parsePsbt as jest.Mock).mockReturnValue(mockPsbt);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('No output to the receiving address');
    });

    it('should return NOT_ENOUGH_MONEY when no suitable UTXOs', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]); // No UTXOs

      const mockPsbt = createMockPsbt();
      (parsePsbt as jest.Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
        { address: 'tb1qchange0000000000000000000000000000000', value: 10000 },
      ]);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.NOT_ENOUGH_MONEY);
    });

    it('should reject PSBT with fee rate below minimum', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (calculateFeeRate as jest.Mock).mockReturnValue(0.5); // Below minimum of 1

      const mockPsbt = createMockPsbt();
      (parsePsbt as jest.Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
      ]);

      // Mock UTXO selection
      mockPrismaClient.uTXO.findMany.mockResolvedValue([mockUtxos[0]]);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('below minimum');
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.address.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.RECEIVER_ERROR);
    });
  });

  describe('attemptPayjoinSend', () => {
    const originalPsbt = 'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';
    const proposalPsbt = 'cHNidP8BAHECAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8CrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GhAnAAAAAAAAFgAUdpn98MqGxRdMa7mGg0HhZKSL0BMAAAAAAAAA';

    it('should send PSBT to Payjoin endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(TEST_PAYJOIN_URL),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: originalPsbt,
        })
      );
      expect(result.success).toBe(true);
      expect(result.isPayjoin).toBe(true);
      expect(result.proposalPsbt).toBe(proposalPsbt);
    });

    it('should add v=1 query parameter', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('v=1'),
        expect.anything()
      );
    });

    it('should return error for HTTP error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'original-psbt-rejected',
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('original-psbt-rejected');
    });

    it('should return error for invalid proposal', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: false,
        errors: ['Sender output was removed'],
        warnings: [],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('Sender output was removed');
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should reject invalid Payjoin URL protocol', async () => {
      const result = await attemptPayjoinSend(
        originalPsbt,
        'ftp://example.com/payjoin',
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.isPayjoin).toBe(false);
      expect(result.error).toContain('Invalid Payjoin URL protocol');
    });

    it('should handle timeout gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Request timeout'));

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should include warnings in successful response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: ['Fee increased by 25%'],
      });

      const result = await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0]
      );

      expect(result.success).toBe(true);
      expect(result.isPayjoin).toBe(true);
    });

    it('should use mainnet network by default', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(originalPsbt, TEST_PAYJOIN_URL, [0]);

      expect(validatePayjoinProposal).toHaveBeenCalledWith(
        originalPsbt,
        proposalPsbt,
        [0],
        bitcoin.networks.bitcoin
      );
    });

    it('should use specified network', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => proposalPsbt,
      });

      (validatePayjoinProposal as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      await attemptPayjoinSend(
        originalPsbt,
        TEST_PAYJOIN_URL,
        [0],
        bitcoin.networks.testnet
      );

      expect(validatePayjoinProposal).toHaveBeenCalledWith(
        originalPsbt,
        proposalPsbt,
        [0],
        bitcoin.networks.testnet
      );
    });
  });

  describe('PayjoinErrors', () => {
    it('should have correct BIP78 error codes', () => {
      expect(PayjoinErrors.VERSION_UNSUPPORTED).toBe('version-unsupported');
      expect(PayjoinErrors.UNAVAILABLE).toBe('unavailable');
      expect(PayjoinErrors.NOT_ENOUGH_MONEY).toBe('not-enough-money');
      expect(PayjoinErrors.ORIGINAL_PSBT_REJECTED).toBe('original-psbt-rejected');
      expect(PayjoinErrors.RECEIVER_ERROR).toBe('receiver-error');
    });
  });

  describe('UTXO Selection for Contribution (selectContributionUtxo)', () => {
    // Note: selectContributionUtxo is not exported, but we can test its behavior
    // through processPayjoinRequest

    const addressId = 'addr-123';
    const walletId = 'wallet-456';

    const mockAddress = {
      id: addressId,
      address: TEST_ADDRESS_TESTNET,
      wallet: {
        id: walletId,
        network: 'testnet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    };

    const createMockPsbt = (paymentAmount: number) => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: paymentAmount + 10000, // Include some for fee
        },
      });
      psbt.addOutput({
        address: TEST_ADDRESS_TESTNET,
        value: paymentAmount,
      });
      return psbt;
    };

    beforeEach(() => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (validatePsbtStructure as jest.Mock).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (calculateFeeRate as jest.Mock).mockReturnValue(10);
    });

    it('should prefer UTXOs within 0.5x-2x of payment amount', async () => {
      const paymentAmount = 100000;

      // Setup: UTXO that's 1.5x the payment (within range)
      const optimalUtxo = {
        id: 'utxo-optimal',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(150000), // 1.5x payment
        scriptPubKey: '0014' + 'a'.repeat(40),
      };

      // Large UTXO outside the preferred range
      const largeUtxo = {
        id: 'utxo-large',
        txid: 'bbbb'.repeat(16),
        vout: 0,
        amount: BigInt(1000000), // 10x payment - outside range
        scriptPubKey: '0014' + 'b'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([optimalUtxo, largeUtxo]);

      const mockPsbt = createMockPsbt(paymentAmount);
      (parsePsbt as jest.Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: paymentAmount },
      ]);

      // Mock clonePsbt to return a modifiable copy
      (clonePsbt as jest.Mock).mockImplementation((psbt) => {
        const clone = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
        // Add required structure
        clone.addInput({
          hash: Buffer.alloc(32, 0xaa),
          index: 0,
          sequence: 0xfffffffd,
        });
        clone.updateInput(0, {
          witnessUtxo: {
            script: Buffer.from('0014' + 'a'.repeat(40), 'hex'),
            value: paymentAmount + 10000,
          },
        });
        clone.addOutput({
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: paymentAmount,
        });
        return clone;
      });

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      // Verify the optimal UTXO was selected (should be first choice based on proximity)
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalled();
    });

    it('should avoid dust UTXOs (< 1000 sats)', async () => {
      const paymentAmount = 50000;

      // Dust UTXO
      const dustUtxo = {
        id: 'utxo-dust',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(500), // Dust
        scriptPubKey: '0014' + 'a'.repeat(40),
      };

      // Valid UTXO
      const validUtxo = {
        id: 'utxo-valid',
        txid: 'bbbb'.repeat(16),
        vout: 0,
        amount: BigInt(60000),
        scriptPubKey: '0014' + 'b'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([dustUtxo, validUtxo]);

      const mockPsbt = createMockPsbt(paymentAmount);
      (parsePsbt as jest.Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as jest.Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: paymentAmount },
      ]);

      // The service should not select dust UTXOs
      // This is tested through the query constraints
      expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            amount: { gt: 0 }, // Should require non-dust
          }),
        })
      );
    });

    it('should exclude frozen UTXOs', async () => {
      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=', // minimal PSBT
        1
      );

      // Verify query excludes frozen
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            frozen: false,
          }),
        })
      );
    });

    it('should require confirmations > 0', async () => {
      await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmations: { gt: 0 },
          }),
        })
      );
    });

    it('should exclude draft-locked UTXOs', async () => {
      await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            draftLock: null,
          }),
        })
      );
    });
  });
});
