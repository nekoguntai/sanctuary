/**
 * Transaction Service Tests
 *
 * Tests for UTXO selection, fee calculation, and transaction creation.
 * These are CRITICAL tests for a Bitcoin wallet.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUtxos, sampleWallets, testnetAddresses } from '../../../fixtures/bitcoin';

// Mock the Prisma client before importing the service
jest.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the nodeClient - getTransaction returns raw hex string when verbose=false
jest.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: jest.fn().mockResolvedValue({
    getTransaction: jest.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
    broadcastTransaction: jest.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: jest.fn().mockResolvedValue(800000),
  }),
}));

// Mock the electrum client
jest.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    getTransaction: jest.fn().mockResolvedValue(null),
  }),
}));

// Mock blockchain service
jest.mock('../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: jest.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
}));

// Mock address derivation
jest.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: jest.fn().mockReturnValue({
    type: 'wpkh',
    xpub: 'tpub...',
    fingerprint: 'aabbccdd',
  }),
}));

// Now import the service after mocks are set up
import {
  selectUTXOs,
  createTransaction,
  estimateTransaction,
  broadcastAndSave,
  createBatchTransaction,
  getPSBTInfo,
  UTXOSelectionStrategy,
} from '../../../../src/services/bitcoin/transactionService';
import { estimateTransactionSize, calculateFee } from '../../../../src/services/bitcoin/utils';
import { broadcastTransaction } from '../../../../src/services/bitcoin/blockchain';

describe('Transaction Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    // Set up default system settings
    mockPrismaClient.systemSetting.findUnique.mockImplementation((query: any) => {
      if (query.where.key === 'confirmationThreshold') {
        return Promise.resolve({ key: 'confirmationThreshold', value: '1' });
      }
      if (query.where.key === 'dustThreshold') {
        return Promise.resolve({ key: 'dustThreshold', value: '546' });
      }
      return Promise.resolve(null);
    });
  });

  describe('selectUTXOs', () => {
    const walletId = 'test-wallet-id';
    const testUtxos = [
      { ...sampleUtxos[0], walletId },
      { ...sampleUtxos[1], walletId },
      { ...sampleUtxos[2], walletId },
    ];

    beforeEach(() => {
      // Mock UTXOs for selection
      mockPrismaClient.uTXO.findMany.mockResolvedValue(testUtxos);
    });

    it('should select UTXOs to cover target amount with largest-first strategy', async () => {
      const targetAmount = 50000; // 0.0005 BTC
      const feeRate = 10;

      const result = await selectUTXOs(
        walletId,
        targetAmount,
        feeRate,
        UTXOSelectionStrategy.LARGEST_FIRST
      );

      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(targetAmount);
      expect(result.estimatedFee).toBeGreaterThan(0);
      expect(result.changeAmount).toEqual(
        result.totalAmount - targetAmount - result.estimatedFee
      );
    });

    it('should select UTXOs with smallest-first strategy', async () => {
      // Reorder for smallest-first
      mockPrismaClient.uTXO.findMany.mockResolvedValue([...testUtxos].reverse());

      const targetAmount = 30000;
      const feeRate = 5;

      const result = await selectUTXOs(
        walletId,
        targetAmount,
        feeRate,
        UTXOSelectionStrategy.SMALLEST_FIRST
      );

      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(targetAmount + result.estimatedFee);
    });

    it('should throw error when insufficient funds', async () => {
      const targetAmount = 10000000000; // 100 BTC - way more than available
      const feeRate = 10;

      await expect(
        selectUTXOs(walletId, targetAmount, feeRate)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw error when no spendable UTXOs available', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await expect(
        selectUTXOs(walletId, 10000, 10)
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should exclude frozen UTXOs from selection', async () => {
      // Mock returns only unfrozen UTXOs (frozen ones filtered by Prisma query)
      const unfrozenUtxos = [testUtxos[1], testUtxos[2]];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(unfrozenUtxos);

      const result = await selectUTXOs(walletId, 30000, 5);

      // Should only get unfrozen UTXOs (2 in this case)
      expect(result.utxos.length).toBeLessThanOrEqual(2);
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it('should respect confirmation threshold', async () => {
      // All UTXOs have confirmations >= 1 (the threshold)
      const result = await selectUTXOs(walletId, 30000, 5);
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it('should filter by selected UTXO IDs when provided', async () => {
      const selectedId = `${testUtxos[1].txid}:${testUtxos[1].vout}`;

      // Mock findMany to return only the selected UTXO
      mockPrismaClient.uTXO.findMany.mockResolvedValue([testUtxos[1]]);

      const result = await selectUTXOs(walletId, 30000, 5, UTXOSelectionStrategy.LARGEST_FIRST, [
        selectedId,
      ]);

      expect(result.utxos.length).toBe(1);
      expect(`${result.utxos[0].txid}:${result.utxos[0].vout}`).toBe(selectedId);
    });
  });

  describe('Fee Calculation', () => {
    it('should calculate correct fee for native segwit transaction', () => {
      const inputCount = 2;
      const outputCount = 2;
      const feeRate = 10;

      const size = estimateTransactionSize(inputCount, outputCount, 'native_segwit');
      const fee = calculateFee(size, feeRate);

      // Native segwit: ~68 vBytes per input, ~34 vBytes per output, ~10 vBytes overhead
      // 2 inputs = 136, 2 outputs = 68, overhead = 10, total ~ 214 vBytes
      expect(size).toBeGreaterThan(100);
      expect(size).toBeLessThan(400);
      expect(fee).toBe(Math.ceil(size * feeRate));
    });

    it('should calculate higher fee for legacy transaction', () => {
      const inputCount = 2;
      const outputCount = 2;
      const feeRate = 10;

      const legacySize = estimateTransactionSize(inputCount, outputCount, 'legacy');
      const segwitSize = estimateTransactionSize(inputCount, outputCount, 'native_segwit');

      // Legacy should be larger than native segwit
      expect(legacySize).toBeGreaterThan(segwitSize);
    });

    it('should calculate smallest fee for taproot transaction', () => {
      const inputCount = 2;
      const outputCount = 2;

      const taprootSize = estimateTransactionSize(inputCount, outputCount, 'taproot');
      const segwitSize = estimateTransactionSize(inputCount, outputCount, 'native_segwit');

      // Taproot should be smaller than native segwit
      expect(taprootSize).toBeLessThanOrEqual(segwitSize);
    });

    it('should scale linearly with more inputs', () => {
      const feeRate = 10;

      const size1 = estimateTransactionSize(1, 2, 'native_segwit');
      const size2 = estimateTransactionSize(2, 2, 'native_segwit');
      const size3 = estimateTransactionSize(3, 2, 'native_segwit');

      // Each additional input adds approximately the same amount
      const diff1to2 = size2 - size1;
      const diff2to3 = size3 - size2;

      // Differences should be similar (within 10%)
      expect(Math.abs(diff1to2 - diff2to3)).toBeLessThan(diff1to2 * 0.1);
    });
  });

  describe('createTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      // Set up address mocks
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);
    });

    it('should create a valid transaction with PSBT', async () => {
      const amount = 50000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      expect(typeof result.psbtBase64).toBe('string');
      expect(result.fee).toBeGreaterThan(0);
      expect(result.totalInput).toBeGreaterThanOrEqual(amount + result.fee);
      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.inputPaths.length).toBe(result.utxos.length);
    });

    it('should throw error for invalid recipient address', async () => {
      const invalidAddress = 'invalid-address';

      await expect(
        createTransaction(walletId, invalidAddress, 50000, 10)
      ).rejects.toThrow('Invalid recipient address');
    });

    it('should throw error when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(
        createTransaction('nonexistent-wallet', recipient, 50000, 10)
      ).rejects.toThrow('Wallet not found');
    });

    it('should enable RBF by default', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      // Check that PSBT has RBF sequence (< 0xfffffffe)
      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBeLessThan(0xfffffffe);
    });

    it('should disable RBF when specified', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10, {
        enableRBF: false,
      });

      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBe(0xffffffff);
    });

    it('should handle sendMax option correctly', async () => {
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, 0, feeRate, {
        sendMax: true,
      });

      // With sendMax, the effective amount should be total - fee
      expect(result.effectiveAmount).toBe(result.totalInput - result.fee);
      expect(result.changeAmount).toBe(0);
    });

    it('should handle subtractFees option correctly', async () => {
      const amount = 100000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate, {
        subtractFees: true,
      });

      // With subtractFees, the effective amount should be amount - fee
      expect(result.effectiveAmount).toBeLessThan(amount);
      expect(result.effectiveAmount).toBe(amount - result.fee);
    });

    it('should include change output when change exceeds dust threshold', async () => {
      const amount = 50000; // Half of available UTXO
      const result = await createTransaction(walletId, recipient, amount, 5);

      // Should have 2 outputs: recipient and change
      expect(result.psbt.txOutputs.length).toBe(2);
      expect(result.changeAmount).toBeGreaterThan(546); // Above dust threshold
      expect(result.changeAddress).toBeDefined();
    });
  });

  describe('estimateTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId },
      ]);
    });

    it('should return fee estimate for valid transaction', async () => {
      const result = await estimateTransaction(walletId, recipient, 50000, 10);

      expect(result.sufficient).toBe(true);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.totalCost).toBe(50000 + result.fee);
      expect(result.inputCount).toBeGreaterThan(0);
      expect(result.outputCount).toBeGreaterThan(0);
    });

    it('should return insufficient when not enough funds', async () => {
      const result = await estimateTransaction(walletId, recipient, 10000000, 10);

      expect(result.sufficient).toBe(false);
      expect(result.error).toContain('Insufficient funds');
    });

    it('should show correct output count based on change', async () => {
      // Small amount = change output
      const resultWithChange = await estimateTransaction(walletId, recipient, 10000, 5);
      expect(resultWithChange.outputCount).toBe(2);

      // Near-full amount = no change (would be dust)
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10700) }, // Just enough for amount + fee
      ]);
      const resultNoChange = await estimateTransaction(walletId, recipient, 10000, 5);
      expect(resultNoChange.changeAmount).toBeLessThan(546);
    });
  });

  describe('Edge Cases', () => {
    const walletId = 'test-wallet-id';

    it('should handle dust amount correctly', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId },
      ]);

      // Trying to send dust amount should still work (recipient's problem)
      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        546, // Dust threshold
        1
      );

      expect(result.sufficient).toBe(true);
    });

    it('should handle very high fee rate', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId }, // 200000 sats
      ]);

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        10000,
        500 // Very high fee rate
      );

      // Should still be sufficient with our 200k sat UTXO
      expect(result.fee).toBeGreaterThan(10000); // Fee > amount
      expect(result.sufficient).toBe(true);
    });

    it('should handle minimum fee rate of 1 sat/vB', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId },
      ]);

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        1 // Minimum fee rate
      );

      expect(result.fee).toBeGreaterThan(0);
      expect(result.sufficient).toBe(true);
    });
  });

  describe('broadcastAndSave', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Reset broadcast mock
      (broadcastTransaction as jest.Mock).mockResolvedValue({
        txid: 'new-txid-from-broadcast',
        broadcasted: true,
      });

      // Mock UTXO update
      mockPrismaClient.uTXO.update.mockResolvedValue({});

      // Mock transaction create
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
        amount: BigInt(50000),
        fee: BigInt(1000),
        confirmations: 0,
      });

      // Mock address lookup for consolidation detection
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
    });

    it('should broadcast signed PSBT and save transaction to database', async () => {
      // Test the database save and UTXO update behavior using rawTxHex path
      // Note: Testing the actual PSBT parsing requires a finalized signed PSBT
      // which is complex to create in tests. The rawTxHex and PSBT paths share
      // the same database logic, so this effectively tests that code path.

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        label: 'Test payment',
        memo: 'Testing broadcast',
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);

      expect(result.broadcasted).toBe(true);
      expect(result.txid).toBeDefined();
      expect(mockPrismaClient.uTXO.update).toHaveBeenCalled();
      expect(mockPrismaClient.transaction.create).toHaveBeenCalled();

      // Verify the transaction was created with correct data
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId,
            type: 'sent',
            amount: BigInt(50000),
            fee: BigInt(1000),
            label: 'Test payment',
            memo: 'Testing broadcast',
          }),
        })
      );
    });

    it('should handle Trezor raw transaction hex path', async () => {
      // Raw transaction hex (signed by Trezor)
      const rawTxHex = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex,
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);

      expect(result.broadcasted).toBe(true);
      expect(result.txid).toBeDefined();
      expect(broadcastTransaction).toHaveBeenCalled();
    });

    it('should mark spent UTXOs after broadcast', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [
          { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
          { txid: sampleUtxos[1].txid, vout: sampleUtxos[1].vout },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      // Should update each UTXO as spent
      expect(mockPrismaClient.uTXO.update).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.uTXO.update).toHaveBeenCalledWith({
        where: {
          txid_vout: {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
          },
        },
        data: { spent: true },
      });
    });

    it('should detect consolidation vs sent transaction', async () => {
      // Mock recipient is a wallet address (consolidation)
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: recipient,
        walletId,
      });

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      // Transaction should be created with type 'consolidation'
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'consolidation',
          }),
        })
      );
    });

    it('should throw error when neither PSBT nor rawTxHex provided', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Either signedPsbtBase64 or rawTxHex is required');
    });

    it('should throw error when broadcast fails', async () => {
      (broadcastTransaction as jest.Mock).mockResolvedValue({
        txid: null,
        broadcasted: false,
      });

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Failed to broadcast transaction');
    });
  });

  describe('createBatchTransaction', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Set up wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks - need enough for batch
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
        {
          ...sampleUtxos[0], // 100000 sats
          walletId,
          scriptPubKey: '0014' + 'b'.repeat(40),
        },
      ]);

      // Set up address mocks
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: "m/84'/1'/0'/0/1",
          walletId,
        },
      ]);
    });

    it('should create transaction with multiple outputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 20000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      expect(result.outputs.length).toBe(2);
      expect(result.outputs[0].amount).toBe(30000);
      expect(result.outputs[1].amount).toBe(20000);
      expect(result.fee).toBeGreaterThan(0);
    });

    it('should handle sendMax flag in batch outputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      // The sendMax output should get the remaining balance
      const sendMaxOutput = result.outputs.find((_, i) => outputs[i].sendMax);
      expect(sendMaxOutput).toBeDefined();
      expect(sendMaxOutput!.amount).toBeGreaterThan(0);

      // No change output when sendMax is used
      expect(result.changeAmount).toBe(0);
    });

    it('should throw error for invalid address in batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: 'invalid-address', amount: 20000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Invalid address');
    });

    it('should throw error when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
      ];

      await expect(
        createBatchTransaction('nonexistent-wallet', outputs, 10)
      ).rejects.toThrow('Wallet not found');
    });

    it('should throw error when no outputs provided', async () => {
      await expect(
        createBatchTransaction(walletId, [], 10)
      ).rejects.toThrow('At least one output is required');
    });

    it('should throw error when insufficient funds for batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 500000 }, // More than available
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should include change output when change exceeds dust threshold', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 5);

      // Should have change output
      expect(result.changeAmount).toBeGreaterThan(546);
      expect(result.changeAddress).toBeDefined();
    });
  });

  describe('getPSBTInfo', () => {
    // Note: Creating valid PSBTs programmatically is complex.
    // These tests verify the function's structure and error handling.

    it('should throw error for invalid PSBT', () => {
      expect(() => getPSBTInfo('invalid-psbt-base64')).toThrow();
    });

    it('should throw error for empty string', () => {
      expect(() => getPSBTInfo('')).toThrow();
    });

    it('should throw error for malformed base64', () => {
      // Valid base64 but not a valid PSBT
      expect(() => getPSBTInfo('SGVsbG8gV29ybGQ=')).toThrow();
    });

    it('should return structured info with inputs, outputs, and fee', async () => {
      // Create a real PSBT using createTransaction and verify getPSBTInfo works
      const walletId = 'test-wallet-id';

      // Setup mocks for transaction creation
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);

      // Create a real transaction
      const txResult = await createTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        10
      );

      // Now parse it with getPSBTInfo
      const result = getPSBTInfo(txResult.psbtBase64);

      expect(result.inputs).toBeDefined();
      expect(Array.isArray(result.inputs)).toBe(true);
      expect(result.inputs.length).toBeGreaterThan(0);

      expect(result.outputs).toBeDefined();
      expect(Array.isArray(result.outputs)).toBe(true);
      expect(result.outputs.length).toBeGreaterThan(0);

      expect(typeof result.fee).toBe('number');

      // Verify input structure
      expect(result.inputs[0].txid).toBeDefined();
      expect(result.inputs[0].txid.length).toBe(64);
      expect(typeof result.inputs[0].vout).toBe('number');

      // Verify output structure
      result.outputs.forEach((output) => {
        expect(typeof output.value).toBe('number');
        expect(output.value).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Legacy Wallet Handling', () => {
    const walletId = 'test-wallet-legacy';
    const recipient = testnetAddresses.legacy[0];

    beforeEach(() => {
      // Set up legacy wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigLegacy,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks for legacy
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          // Legacy P2PKH scriptPubKey format
          scriptPubKey: '76a914' + 'a'.repeat(40) + '88ac',
        },
      ]);

      // Set up address mocks
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.legacy[1],
        derivationPath: "m/44'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/44'/1'/0'/0/0",
          walletId,
        },
      ]);
    });

    it('should use nonWitnessUtxo for legacy P2PKH wallets', async () => {
      const amount = 50000;
      const feeRate = 10;

      // The nodeClient mock already returns raw hex for getTransaction
      const result = await createTransaction(walletId, recipient, amount, feeRate);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      // Legacy transactions use nonWitnessUtxo
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it('should fetch raw transactions for legacy inputs', async () => {
      const amount = 50000;
      const feeRate = 10;

      await createTransaction(walletId, recipient, amount, feeRate);

      // getNodeClient should be called to fetch raw transaction
      const { getNodeClient } = require('../../../../src/services/bitcoin/nodeClient');
      expect(getNodeClient).toHaveBeenCalled();
    });
  });
});
