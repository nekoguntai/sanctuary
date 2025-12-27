/**
 * Advanced Transaction Tests (RBF/CPFP)
 *
 * Tests for Replace-By-Fee and Child-Pays-For-Parent functionality.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks, createMockTransaction } from '../../../mocks/electrum';
import { sampleUtxos, testnetAddresses, sampleTransactions } from '../../../fixtures/bitcoin';

// Mock Prisma
jest.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock Electrum client
jest.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: jest.fn().mockReturnValue(mockElectrumClient),
}));

// Mock nodeClient - canReplaceTransaction uses getNodeClient
jest.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: jest.fn().mockResolvedValue(mockElectrumClient),
}));

// Import after mocks
import {
  isRBFSignaled,
  canReplaceTransaction,
  createRBFTransaction,
  calculateCPFPFee,
  createCPFPTransaction,
  RBF_SEQUENCE,
  MIN_RBF_FEE_BUMP,
} from '../../../../src/services/bitcoin/advancedTx';

describe('Advanced Transaction Features', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();

    // Default system settings
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
      key: 'dustThreshold',
      value: '546',
    });
  });

  describe('RBF Detection', () => {
    describe('isRBFSignaled', () => {
      it('should return true for transaction with RBF sequence', () => {
        // Use the sample RBF-enabled transaction from fixtures
        expect(isRBFSignaled(sampleTransactions.rbfEnabled)).toBe(true);
      });

      it('should return false for transaction with final sequence', () => {
        // Use a non-RBF transaction from fixtures
        expect(isRBFSignaled(sampleTransactions.simpleP2pkh)).toBe(false);
      });

      it('should return false for invalid transaction hex', () => {
        expect(isRBFSignaled('invalid-hex')).toBe(false);
        expect(isRBFSignaled('')).toBe(false);
      });
    });

    describe('canReplaceTransaction', () => {
      const txid = 'a'.repeat(64);

      it('should return replaceable for unconfirmed RBF transaction', async () => {
        // Mock unconfirmed transaction with RBF
        const mockTx = createMockTransaction({
          txid,
          confirmations: 0,
          inputs: [{ txid: 'b'.repeat(64), vout: 0, value: 0.001, address: testnetAddresses.nativeSegwit[0] }],
          outputs: [{ value: 0.0005, address: testnetAddresses.nativeSegwit[1] }],
        });

        // Use the valid RBF transaction from fixtures
        mockTx.hex = sampleTransactions.rbfEnabled;

        mockElectrumClient.getTransaction.mockResolvedValueOnce(mockTx);
        mockElectrumClient.getTransaction.mockResolvedValueOnce({
          vout: [{ value: 0.001, scriptPubKey: { hex: '0014' + 'a'.repeat(40) } }],
        });

        const result = await canReplaceTransaction(txid);

        expect(result.replaceable).toBe(true);
        expect(result.currentFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeDefined();
        expect(result.minNewFeeRate).toBeGreaterThan(result.currentFeeRate!);
      });

      it('should return not replaceable for confirmed transaction', async () => {
        const mockTx = createMockTransaction({
          txid,
          confirmations: 1,
        });
        mockTx.hex = sampleTransactions.rbfEnabled;
        mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

        const result = await canReplaceTransaction(txid);

        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('confirmed');
      });

      it('should return not replaceable for non-RBF transaction', async () => {
        const mockTx = createMockTransaction({ txid, confirmations: 0 });
        // Use non-RBF transaction from fixtures
        mockTx.hex = sampleTransactions.simpleP2pkh;

        mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

        const result = await canReplaceTransaction(txid);

        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('RBF');
      });
    });
  });

  describe('RBF Transaction Creation', () => {
    const originalTxid = 'a'.repeat(64);
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        descriptor: 'wpkh([aabbccdd/84h/1h/0h]tpub.../0/*)',
        fingerprint: 'aabbccdd',
        devices: [],
      });

      // Mock wallet addresses
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: testnetAddresses.nativeSegwit[1], walletId },
      ]);
    });

    it('should reject RBF if original transaction not replaceable', async () => {
      // Mock a confirmed transaction (not replaceable)
      const mockTx = createMockTransaction({ txid: originalTxid, confirmations: 1 });
      mockTx.hex = sampleTransactions.rbfEnabled;
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('confirmed');
    });

    it('should reject RBF for non-RBF signaled transaction', async () => {
      // Mock an unconfirmed transaction without RBF signaling
      const mockTx = createMockTransaction({ txid: originalTxid, confirmations: 0 });
      mockTx.hex = sampleTransactions.simpleP2pkh; // This has sequence 0xffffffff (no RBF)
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('RBF');
    });

    it('should throw error if new fee rate is not higher', async () => {
      const mockTx = createMockTransaction({
        txid: originalTxid,
        confirmations: 0,
        inputs: [{ txid: 'b'.repeat(64), vout: 0, value: 0.001, address: testnetAddresses.nativeSegwit[0] }],
        outputs: [{ value: 0.0005, address: testnetAddresses.nativeSegwit[1] }],
      });
      mockTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(mockTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.001, scriptPubKey: { hex: '0014aabb' } }] });

      // Try to create with same or lower fee rate
      await expect(
        createRBFTransaction(originalTxid, 1, walletId, 'testnet')
      ).rejects.toThrow('must be higher');
    });
  });

  describe('CPFP Fee Calculation', () => {
    it('should calculate correct child fee for target package rate', () => {
      const parentTxSize = 200; // vBytes
      const parentFeeRate = 5; // sat/vB
      const childTxSize = 140; // vBytes (1 in, 1 out native segwit)
      const targetFeeRate = 20; // sat/vB

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Parent fee = 200 * 5 = 1000 sats
      // Total needed = (200 + 140) * 20 = 6800 sats
      // Child fee = 6800 - 1000 = 5800 sats
      expect(result.childFee).toBe(5800);
      expect(result.totalFee).toBe(6800);
      expect(result.totalSize).toBe(340);
      expect(result.effectiveFeeRate).toBe(20);
    });

    it('should calculate correct child fee rate', () => {
      const parentTxSize = 150;
      const parentFeeRate = 2;
      const childTxSize = 100;
      const targetFeeRate = 10;

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Child fee rate should be higher than target to bring package average up
      expect(result.childFeeRate).toBeGreaterThan(targetFeeRate);
    });
  });

  describe('CPFP Transaction Creation', () => {
    // Use valid hex txid (not 'p' which is invalid hex)
    const parentTxid = 'c'.repeat(64);
    const parentVout = 0;
    const walletId = 'test-wallet-id';
    const recipientAddress = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Mock parent UTXO
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        ...sampleUtxos[0],
        txid: parentTxid,
        vout: parentVout,
        walletId,
        spent: false,
      });
    });

    it('should throw error if UTXO not found', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('UTXO not found');
    });

    it('should throw error if UTXO already spent', async () => {
      // Mock UTXO that is already spent
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: true, // Already spent!
      });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('already spent');
    });

    it('should throw error if UTXO value insufficient for fee', async () => {
      // UTXO with very small value
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(100), // Only 100 sats
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.0001, scriptPubKey: { hex: '0014cc' } }] });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 100, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('insufficient');
    });
  });

  describe('RBF Constants', () => {
    it('should have correct RBF sequence value', () => {
      expect(RBF_SEQUENCE).toBe(0xfffffffd);
    });

    it('should have minimum fee bump defined', () => {
      expect(MIN_RBF_FEE_BUMP).toBeGreaterThanOrEqual(1);
    });
  });
});
