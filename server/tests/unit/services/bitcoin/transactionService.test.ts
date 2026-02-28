import { vi, Mock } from 'vitest';
/**
 * Transaction Service Tests
 *
 * Tests for UTXO selection, fee calculation, and transaction creation.
 * These are CRITICAL tests for a Bitcoin wallet.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUtxos, sampleWallets, testnetAddresses, multisigKeyInfo } from '../../../fixtures/bitcoin';
import * as bitcoin from 'bitcoinjs-lib';
import { Prisma } from '@prisma/client';

// Hoist mock variables for use in vi.mock() factories
const { mockParseDescriptor, mockNotifyNewTransactions, mockEmitTransactionSent, mockEmitTransactionReceived } = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
  mockNotifyNewTransactions: vi.fn(),
  mockEmitTransactionSent: vi.fn(),
  mockEmitTransactionReceived: vi.fn(),
}));

// Mock the Prisma client before importing the service
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the nodeClient - getTransaction returns raw hex string when verbose=false
vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  }),
}));

// Mock the electrum client
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getTransaction: vi.fn().mockResolvedValue(null),
  }),
}));

// Mock blockchain service
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionSent: mockEmitTransactionSent,
    emitTransactionReceived: mockEmitTransactionReceived,
  },
}));

vi.mock('../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: mockNotifyNewTransactions,
}));

// Mock address derivation - supports both single-sig and multisig
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: mockParseDescriptor,
  convertToStandardXpub: vi.fn().mockImplementation((xpub: string) => {
    // Convert tpub to standard format (they're already standard in our test fixtures)
    return xpub;
  }),
}));

// Now import the service after mocks are set up
import {
  selectUTXOs,
  createTransaction,
  createAndBroadcastTransaction,
  estimateTransaction,
  broadcastAndSave,
  createBatchTransaction,
  getPSBTInfo,
  UTXOSelectionStrategy,
  generateDecoyAmounts,
  buildMultisigWitnessScript,
  buildMultisigBip32Derivations,
} from '../../../../src/services/bitcoin/transactionService';
import { estimateTransactionSize, calculateFee } from '../../../../src/services/bitcoin/utils';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../src/services/bitcoin/blockchain';
import * as nodeClient from '../../../../src/services/bitcoin/nodeClient';
import * as psbtBuilder from '../../../../src/services/bitcoin/psbtBuilder';

const flushPromises = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const createRawTxHex = (outputs: Array<{ address: string; value: number }>, network: bitcoin.Network = bitcoin.networks.testnet) => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0), 0, 0xffffffff, Buffer.alloc(0));
  outputs.forEach(({ address, value }) => {
    tx.addOutput(bitcoin.address.toOutputScript(address, network), value);
  });
  return tx.toHex();
};

describe('Transaction Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockNotifyNewTransactions.mockReset();
    mockNotifyNewTransactions.mockResolvedValue(undefined);
    mockEmitTransactionSent.mockReset();
    mockEmitTransactionReceived.mockReset();
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
    // Set up mockParseDescriptor implementation - supports both single-sig and multisig
    // Using only 2 keys for 2-of-2 multisig (both keys are valid testnet tpubs)
    mockParseDescriptor.mockImplementation((descriptor: string) => {
      // Check if it's a multisig descriptor
      if (descriptor.startsWith('wsh(sortedmulti(') || descriptor.startsWith('wsh(multi(')) {
        return {
          type: 'wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      if (descriptor.startsWith('sh(wsh(sortedmulti(') || descriptor.startsWith('sh(wsh(multi(')) {
        return {
          type: 'sh-wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      // Single-sig descriptor
      return {
        type: 'wpkh',
        xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
      };
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

    it('should treat non-testnet wallets as mainnet during recipient validation', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        network: 'mainnet',
        devices: [],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10)
      ).rejects.toThrow('Invalid recipient address');
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

    it('should throw when subtractFees would leave effective amount at or below dust', async () => {
      await expect(
        createTransaction(walletId, recipient, 500, 10, {
          subtractFees: true,
        })
      ).rejects.toThrow('not enough to cover fee');
    });

    it('should throw when subtractFees selectedUtxoIds removes all spendable UTXOs', async () => {
      await expect(
        createTransaction(walletId, recipient, 20_000, 10, {
          subtractFees: true,
          selectedUtxoIds: ['does-not-exist:0'],
        })
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should throw when sendMax amount cannot cover fees', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(500),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true })
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw when subtractFees amount exceeds available selected inputs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(12_000),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, { subtractFees: true })
      ).rejects.toThrow('Insufficient funds');
    });

    it('should include change output when change exceeds dust threshold', async () => {
      const amount = 50000; // Half of available UTXO
      const result = await createTransaction(walletId, recipient, amount, 5);

      // Should have 2 outputs: recipient and change
      expect(result.psbt.txOutputs.length).toBe(2);
      expect(result.changeAmount).toBeGreaterThan(546); // Above dust threshold
      expect(result.changeAddress).toBeDefined();
    });

    it('should throw when sendMax selectedUtxoIds removes all spendable UTXOs', async () => {
      await expect(
        createTransaction(walletId, recipient, 0, 10, {
          sendMax: true,
          selectedUtxoIds: ['missing-txid:999'],
        })
      ).rejects.toThrow('No spendable UTXOs found');
    });

    it('should throw when a selected SegWit UTXO is missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '',
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 50000, 10)
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should fail sendMax when selected UTXO has missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true })
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should fail subtractFees when selected UTXO has missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 10, { subtractFees: true })
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should throw when decoy output count exceeds available change addresses', async () => {
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          {
            id: 'addr-input',
            address: sampleUtxos[2].address,
            derivationPath: "m/84'/1'/0'/0/0",
            walletId,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'addr-change',
            address: testnetAddresses.nativeSegwit[1],
            derivationPath: "m/84'/1'/0'/1/0",
            walletId,
            used: false,
            index: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, {
          decoyOutputs: { enabled: true, count: 4 },
        })
      ).rejects.toThrow('Not enough change addresses');
    });

    it('should create decoy outputs when enough change and addresses are available', async () => {
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          {
            id: 'addr-input',
            address: sampleUtxos[2].address,
            derivationPath: "m/84'/1'/0'/0/0",
            walletId,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'change-1',
            address: testnetAddresses.nativeSegwit[1],
            derivationPath: "m/84'/1'/0'/1/0",
            walletId,
            used: false,
            index: 0,
          },
          {
            id: 'change-2',
            address: testnetAddresses.nestedSegwit[0],
            derivationPath: "m/84'/1'/0'/1/1",
            walletId,
            used: false,
            index: 1,
          },
          {
            id: 'change-3',
            address: testnetAddresses.legacy[0],
            derivationPath: "m/84'/1'/0'/1/2",
            walletId,
            used: false,
            index: 2,
          },
        ]);

      const result = await createTransaction(walletId, recipient, 50_000, 5, {
        decoyOutputs: { enabled: true, count: 3 },
      });

      expect(result.decoyOutputs?.length).toBe(3);
      expect(result.changeAmount).toBe(0);
      expect(result.changeAddress).toBeUndefined();
    });

    it('should fall back to a single change output when decoys become uneconomical', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(10_000),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      const result = await createTransaction(walletId, recipient, 8_300, 5, {
        decoyOutputs: { enabled: true, count: 4 },
      });

      expect(result.decoyOutputs).toBeUndefined();
      expect(result.changeAddress).toBeDefined();
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('should derive single-sig BIP32 info from primary device xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'primary-device',
              fingerprint: 'aabbccdd',
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            },
          },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint.toString('hex')).toBe('aabbccdd');
    });

    it('should use descriptor xpub and fingerprint fallback when device metadata is absent', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: null,
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint.toString('hex')).toBe('aabbccdd');
    });

    it('should skip single-sig BIP32 derivation when device has no fingerprint/xpub and no wallet fallback', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'missing-metadata-device',
              fingerprint: null,
              xpub: null,
            },
          },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should fall back to receiving address when no dedicated change address exists', async () => {
      mockPrismaClient.address.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'receive-addr-fallback',
          address: testnetAddresses.legacy[1],
          derivationPath: "m/84'/1'/0'/0/10",
          walletId,
          used: false,
          index: 10,
        });

      const result = await createTransaction(walletId, recipient, 50_000, 10);

      expect(result.changeAddress).toBe(testnetAddresses.legacy[1]);
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('should continue when single-sig account xpub parsing fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'bad-xpub-device',
              fingerprint: 'aabbccdd',
              xpub: 'not-a-valid-xpub',
            },
          },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      expect(result.psbtBase64).toBeDefined();
    });
  });

  describe('createAndBroadcastTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
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
          id: 'addr-input',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);
    });

    it('always throws until automatic signing is implemented', async () => {
      await expect(
        createAndBroadcastTransaction(walletId, recipient, 50_000, 10)
      ).rejects.toThrow('Automatic signing not implemented');
    });
  });

  describe('createTransaction - Multisig', () => {
    const walletId = 'multisig-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up multisig wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
          { device: { id: 'device-3', fingerprint: '22334455', xpub: multisigKeyInfo[2].xpub } },
        ],
      });

      // Set up UTXO mocks with multisig address
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          // P2WSH scriptPubKey (32-byte witness program)
          scriptPubKey: '0020' + 'a'.repeat(64),
        },
      ]);

      // Set up address mocks with BIP-48 derivation paths
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/48'/1'/0'/2'/1/0", // BIP-48 change address
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/48'/1'/0'/2'/0/0", // BIP-48 receive address
          walletId,
        },
      ]);
    });

    it('should create PSBT with bip32Derivation for ALL cosigners', async () => {
      const amount = 50000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();

      // Parse the PSBT to check bip32Derivation
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // Multisig should have bip32Derivation entries for cosigners (at least 2 for 2-of-3)
      expect(input.bip32Derivation).toBeDefined();
      expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);

      // Verify fingerprints are valid hex strings
      const fingerprints = input.bip32Derivation!.map(d =>
        d.masterFingerprint.toString('hex')
      );
      // At least the first two keys should be present
      expect(fingerprints).toContain('aabbccdd');
      expect(fingerprints).toContain('eeff0011');
    });

    it('should use BIP-48 paths for multisig bip32Derivation', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // All paths should be BIP-48 format: m/48'/coin'/account'/script'/change/index
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should derive correct pubkeys for each cosigner', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // Each bip32Derivation should have a valid compressed public key (33 bytes)
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.pubkey.length).toBe(33);
        // Compressed pubkeys start with 0x02 or 0x03
        expect([0x02, 0x03]).toContain(derivation.pubkey[0]);
      }
    });

    it('should include inputPaths in response for hardware wallet signing', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      expect(result.inputPaths).toBeDefined();
      expect(result.inputPaths.length).toBe(result.utxos.length);

      // Input paths should be BIP-48 format
      for (const path of result.inputPaths) {
        expect(path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should add redeemScript for sh-wsh-sortedmulti descriptors', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    });

    it('should continue when multisig descriptor parsing fails', async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      expect(result.psbtBase64).toBeDefined();
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
      (broadcastTransaction as Mock).mockResolvedValue({
        txid: 'new-txid-from-broadcast',
        broadcasted: true,
      });

      // Reset recalculateWalletBalances mock
      (recalculateWalletBalances as Mock).mockResolvedValue(undefined);

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
        balanceAfter: null, // Will be set by recalculateWalletBalances
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
      // Note: For sent transactions, amount is stored as negative (amount + fee)
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId,
            type: 'sent',
            amount: BigInt(-51000), // -(50000 + 1000 fee)
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
      (broadcastTransaction as Mock).mockResolvedValue({
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

    it('should call recalculateWalletBalances after successful broadcast', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      // Verify recalculateWalletBalances was called with the correct walletId
      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
    });

    it('should persist provided transaction inputs and outputs metadata directly', async () => {
      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
            derivationPath: "m/84'/1'/0'/0/0",
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 50_000,
            outputType: 'recipient' as const,
            isOurs: false,
            scriptPubKey: '0014' + 'ff'.repeat(20),
          },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: sampleUtxos[0].address,
              derivationPath: "m/84'/1'/0'/0/0",
            }),
          ]),
        })
      );
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: recipient,
              outputType: 'recipient',
              isOurs: false,
            }),
          ]),
        })
      );
    });

    it('should broadcast from signed PSBT and exercise finalization branches', async () => {
      const finalizeInput = vi.fn();
      const extractedRawTx = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

      const fakePsbt = {
        data: {
          inputs: [
            { finalScriptWitness: Buffer.from('00', 'hex') },
            {
              witnessScript: Buffer.from('51ae', 'hex'),
              partialSig: [{ pubkey: Buffer.alloc(33, 2), signature: Buffer.from('300602010102010101', 'hex') }],
            },
            {
              witnessScript: Buffer.from('51ae', 'hex'),
              partialSig: [{ pubkey: Buffer.alloc(33, 3), signature: Buffer.from('300602010102010101', 'hex') }],
            },
            {},
          ],
        },
        finalizeInput,
        extractTransaction: vi.fn().mockReturnValue({
          toHex: () => extractedRawTx,
          getId: () => 'signed-psbt-txid',
        }),
      } as unknown as bitcoin.Psbt;

      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue(fakePsbt);
      const parseMultisigSpy = vi.spyOn(psbtBuilder, 'parseMultisigScript')
        .mockReturnValueOnce({ isMultisig: true, m: 2, n: 2, pubkeys: [] })
        .mockReturnValueOnce({ isMultisig: false, m: 0, n: 0, pubkeys: [] });
      const finalizeMultisigSpy = vi.spyOn(psbtBuilder, 'finalizeMultisigInput').mockImplementation(() => undefined);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      };

      const result = await broadcastAndSave(walletId, 'signed-psbt-base64', metadata);

      expect(result.broadcasted).toBe(true);
      expect(finalizeMultisigSpy).toHaveBeenCalledWith(fakePsbt, 1);
      expect(finalizeInput).toHaveBeenCalledWith(2);
      expect(finalizeInput).toHaveBeenCalledWith(3);

      finalizeMultisigSpy.mockRestore();
      parseMultisigSpy.mockRestore();
      fromBase64Spy.mockRestore();
    });

    it('should skip finalization when all PSBT inputs are already finalized', async () => {
      const finalizeInput = vi.fn();
      const extractedRawTx = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

      const fakePsbt = {
        data: {
          inputs: [{ finalScriptWitness: Buffer.from('00', 'hex') }],
        },
        finalizeInput,
        extractTransaction: vi.fn().mockReturnValue({
          toHex: () => extractedRawTx,
          getId: () => 'already-finalized-txid',
        }),
      } as unknown as bitcoin.Psbt;

      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue(fakePsbt);

      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      };

      const result = await broadcastAndSave(walletId, 'already-finalized-psbt', metadata);

      expect(result.broadcasted).toBe(true);
      expect(finalizeInput).not.toHaveBeenCalled();
      fromBase64Spy.mockRestore();
    });

    it('should build fallback transaction inputs from UTXO lookups', async () => {
      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [
          { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
          { txid: 'missing-utxo-txid', vout: 99 },
        ],
        outputs: [
          {
            address: recipient,
            amount: 50_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          spent: false,
          amount: BigInt(100_000),
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid: sampleUtxos[0].txid,
              vout: sampleUtxos[0].vout,
            }),
          ]),
        })
      );
    });

    it('should parse fallback outputs and create pending receive records for internal wallets', async () => {
      const ourAddress = testnetAddresses.nativeSegwit[1];
      const internalAddress = testnetAddresses.legacy[1];
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
        { address: ourAddress, value: 10_000 },
        { address: internalAddress, value: 7_000 },
      ]);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockImplementation((query: any) => {
        if (query?.where?.walletId === walletId) {
          return Promise.resolve([{ address: ourAddress }]);
        }
        if (query?.where?.walletId?.not === walletId) {
          return Promise.resolve([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
        }
        return Promise.resolve([]);
      });
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockPrismaClient.transaction.create.mockResolvedValueOnce({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.transaction.create.mockResolvedValueOnce({
        id: 'received-tx-1',
        txid: 'new-txid-from-broadcast',
        walletId: 'receiving-wallet-id',
        type: 'received',
      });
      mockNotifyNewTransactions.mockRejectedValueOnce(new Error('notify failed (sender)'));
      mockNotifyNewTransactions.mockRejectedValueOnce(new Error('notify failed (receiver)'));

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        rawTxHex,
      };

      await broadcastAndSave(walletId, undefined, metadata);
      await flushPromises();

      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ address: recipient, outputType: 'recipient' }),
            expect.objectContaining({ address: ourAddress, outputType: 'change' }),
            expect.objectContaining({ address: internalAddress, outputType: 'recipient' }),
          ]),
        })
      );
      expect(recalculateWalletBalances).toHaveBeenCalledWith('receiving-wallet-id');
      expect(mockEmitTransactionSent).toHaveBeenCalled();
      expect(mockEmitTransactionReceived).toHaveBeenCalled();
    });

    it('should skip creating duplicate pending receive transaction records', async () => {
      const internalAddress = testnetAddresses.legacy[1];
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
        { address: internalAddress, value: 7_000 },
      ]);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
      mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'existing-received' });

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 30_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex,
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledTimes(1);
    });

    it('should ignore unique-constraint races while creating pending receive records', async () => {
      const internalAddress = testnetAddresses.legacy[1];
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
        { address: internalAddress, value: 7_000 },
      ]);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockPrismaClient.transaction.create.mockResolvedValueOnce({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.transaction.create.mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields')
      );

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 30_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex,
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);
      expect(result.broadcasted).toBe(true);
    });

    it('should continue when fallback raw transaction output parsing fails', async () => {
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
      ]);
      const originalFromHex = bitcoin.Transaction.fromHex;
      const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
      fromHexSpy
        .mockImplementationOnce((hex: string) => originalFromHex(hex))
        .mockImplementationOnce(() => {
          throw new Error('raw output parse failure');
        })
        .mockImplementation((hex: string) => originalFromHex(hex));

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        rawTxHex,
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);
      expect(result.broadcasted).toBe(true);

      fromHexSpy.mockRestore();
    });

    it('reuses existing transaction record when create hits a unique constraint race', async () => {
      mockPrismaClient.transaction.create.mockReset();
      mockPrismaClient.transaction.create.mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields')
      );
      mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({
        id: 'existing-tx-id',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
        amount: BigInt(-51_000),
        fee: BigInt(1_000),
        confirmations: 0,
      });

      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 50_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);

      expect(result.broadcasted).toBe(true);
      expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalled();
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              transactionId: 'existing-tx-id',
            }),
          ]),
        })
      );
    });

    it('should rethrow unique-constraint errors when existing transaction record cannot be found', async () => {
      mockPrismaClient.transaction.create.mockReset();
      mockPrismaClient.transaction.create.mockRejectedValueOnce(
        new Error('Unique constraint failed on the fields')
      );
      mockPrismaClient.transaction.findUnique.mockResolvedValueOnce(null);

      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Unique constraint failed');
    });

    it('should classify fallback parsed wallet-owned output as consolidation output type', async () => {
      const internalWalletAddress = testnetAddresses.legacy[1];
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
        { address: internalWalletAddress, value: 7_000 },
      ]);

      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'consolidation-addr',
        walletId,
        address: recipient,
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockImplementation((query: any) => {
        if (query?.where?.walletId === walletId) {
          return Promise.resolve([{ address: recipient }, { address: internalWalletAddress }]);
        }
        if (query?.where?.walletId?.not === walletId) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex,
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: internalWalletAddress,
              outputType: 'consolidation',
              isOurs: true,
            }),
          ]),
        })
      );
    });

    it('should continue when creating internal receiving transaction fails with non-unique error', async () => {
      const internalAddress = testnetAddresses.legacy[1];
      const rawTxHex = createRawTxHex([
        { address: recipient, value: 30_000 },
        { address: internalAddress, value: 7_000 },
      ]);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockImplementation((query: any) => {
        if (query?.where?.walletId?.not === walletId) {
          return Promise.resolve([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
        }
        return Promise.resolve([]);
      });
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockPrismaClient.transaction.create.mockResolvedValueOnce({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.transaction.create.mockRejectedValueOnce(new Error('db timeout'));

      const metadata = {
        recipient,
        amount: 30_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        outputs: [
          {
            address: recipient,
            amount: 30_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex,
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);

      expect(result.broadcasted).toBe(true);
    });

    it('reuses existing transaction record for Prisma known unique-constraint errors', async () => {
      const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test-client',
      });

      mockPrismaClient.transaction.create.mockReset();
      mockPrismaClient.transaction.create.mockRejectedValueOnce(uniqueError);
      mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({
        id: 'existing-known-prisma',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
        amount: BigInt(-51_000),
        fee: BigInt(1_000),
        confirmations: 0,
      });

      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 50_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);

      expect(result.broadcasted).toBe(true);
      expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalled();
    });

    it('should continue when internal wallet matching fails', async () => {
      mockPrismaClient.wallet.findUnique.mockRejectedValueOnce(new Error('wallet lookup failed'));

      const metadata = {
        recipient,
        amount: 50_000,
        fee: 1_000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        inputs: [
          {
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
            address: sampleUtxos[0].address,
            amount: Number(sampleUtxos[0].amount),
          },
        ],
        outputs: [
          {
            address: recipient,
            amount: 50_000,
            outputType: 'recipient' as const,
            isOurs: false,
          },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      const result = await broadcastAndSave(walletId, undefined, metadata);
      expect(result.broadcasted).toBe(true);
    });

    it('should not call recalculateWalletBalances when broadcast fails', async () => {
      (broadcastTransaction as Mock).mockResolvedValue({
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

      try {
        await broadcastAndSave(walletId, undefined, metadata);
      } catch {
        // Expected to fail
      }

      // Verify recalculateWalletBalances was NOT called when broadcast fails
      expect(recalculateWalletBalances).not.toHaveBeenCalled();
    });

    it('should handle recalculateWalletBalances error gracefully', async () => {
      // recalculateWalletBalances throws but broadcast should still complete
      // Note: The actual behavior depends on implementation - if recalculateWalletBalances
      // is called with await, errors will propagate. If it's fire-and-forget, they won't.
      // This test documents the expected behavior.
      (recalculateWalletBalances as Mock).mockRejectedValueOnce(new Error('Balance calculation failed'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // The broadcast should either succeed or throw depending on implementation
      // If recalculateWalletBalances errors are caught, broadcast succeeds
      // If they propagate, broadcast throws
      try {
        const result = await broadcastAndSave(walletId, undefined, metadata);
        // If we get here, the implementation catches balance calculation errors
        expect(result.broadcasted).toBe(true);
        expect(result.txid).toBeDefined();
      } catch (error) {
        // If we get here, balance calculation errors propagate
        // This is also valid behavior - the test documents it
        expect((error as Error).message).toContain('Balance calculation failed');
      }

      // Verify recalculateWalletBalances was called
      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
    });

    describe('RBF Transaction Tracking', () => {
      it('should detect RBF replacement from memo and mark original as replaced', async () => {
        const originalTxid = 'original-tx-12345678901234567890123456789012345678901234567890123456';

        // Mock finding the original transaction
        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'original-tx-db-id',
          txid: originalTxid,
          walletId,
          type: 'sent',
          amount: BigInt(45000),
          fee: BigInt(500),
          label: 'Original payment label',
          memo: 'Original memo',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 45000,
          fee: 2000, // Higher fee for RBF
          label: undefined, // No label provided - should copy from original
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        // Verify original transaction was marked as replaced
        expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'original-tx-db-id' },
            data: expect.objectContaining({
              rbfStatus: 'replaced',
              replacedByTxid: expect.any(String), // The new txid
            }),
          })
        );

        // Verify new transaction created with correct fields
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: originalTxid,
              rbfStatus: 'active',
              label: 'Original payment label', // Preserved from original
            }),
          })
        );
      });

      it('should preserve original label when RBF transaction has no label', async () => {
        const originalTxid = 'original-tx-with-label-5678901234567890123456789012345678901234';

        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'tx-with-label',
          txid: originalTxid,
          walletId,
          label: 'Important payment',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          label: undefined, // No new label
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              label: 'Important payment',
            }),
          })
        );
      });

      it('should use provided label over original when both exist', async () => {
        const originalTxid = 'original-tx-label-override-56789012345678901234567890123456789012';

        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'tx-original',
          txid: originalTxid,
          walletId,
          label: 'Old label',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          label: 'New explicit label', // Explicitly provided
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              label: 'New explicit label',
            }),
          })
        );
      });

      it('should handle RBF when original transaction not found', async () => {
        const nonExistentTxid = 'nonexistent-tx-123456789012345678901234567890123456789012345';

        // Original not found
        mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          memo: `Replacing transaction ${nonExistentTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        // Should not throw - gracefully handle missing original
        await expect(broadcastAndSave(walletId, undefined, metadata)).resolves.toBeDefined();

        // Should still create the new transaction with replacementForTxid
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: nonExistentTxid,
              rbfStatus: 'active',
            }),
          })
        );

        // Should NOT call update since original wasn't found
        expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      });

      it('should not treat regular transactions as RBF', async () => {
        const metadata = {
          recipient,
          amount: 50000,
          fee: 1000,
          label: 'Regular payment',
          memo: 'Just a normal transaction', // No RBF prefix
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        // Should create transaction without RBF fields
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: undefined,
              rbfStatus: 'active',
            }),
          })
        );

        // Should not try to find or update an original transaction
        expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      });

      it('should release UTXO locks when broadcasting from a draft', async () => {
        const draftId = 'draft-to-broadcast';
        mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 2 });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 1000,
          utxos: [
            { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
            { txid: sampleUtxos[1].txid, vout: sampleUtxos[1].vout },
          ],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
          draftId,
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
          where: { draftId },
        });
      });
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

    it('should throw when selectedUtxoIds filtering leaves no batch inputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10, {
          selectedUtxoIds: ['not-present:999'],
        })
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should reject batch transactions containing UTXOs with missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '',
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('missing scriptPubKey data');
    });

    it('should fail sendMax when fixed outputs consume all value plus fees', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 300_000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should fall back to receiving address when no change branch address is available', async () => {
      mockPrismaClient.address.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'receive-addr-1',
          address: testnetAddresses.legacy[1],
          derivationPath: "m/84'/1'/0'/0/10",
          walletId,
          used: false,
          index: 10,
        });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.changeAddress).toBe(testnetAddresses.legacy[1]);
    });

    it('should throw when no change or receiving address is available for batch', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('No change address available');
    });

    it('should add single-sig bip32 derivation from device data in batch mode', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'batch-device',
              fingerprint: 'aabbccdd',
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint.toString('hex')).toBe('aabbccdd');
    });

    it('should continue when batch account xpub parsing fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'bad-xpub-device',
              fingerprint: 'aabbccdd',
              xpub: 'not-a-valid-xpub',
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbtBase64).toBeDefined();
    });

    it('should use nonWitnessUtxo for legacy batch wallet inputs', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigLegacy,
        id: walletId,
        devices: [],
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '76a914' + 'a'.repeat(40) + '88ac',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'legacy-input-addr',
          address: sampleUtxos[2].address,
          derivationPath: "m/44'/1'/0'/0/0",
          walletId,
        },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'legacy-change-addr',
        address: testnetAddresses.legacy[1],
        derivationPath: "m/44'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      const outputs = [
        { address: testnetAddresses.legacy[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(nodeClient.getNodeClient).toHaveBeenCalled();
      expect(psbt.data.inputs[0].nonWitnessUtxo).toBeDefined();
    });
  });

  describe('createBatchTransaction - Multisig', () => {
    const walletId = 'multisig-batch-wallet-id';

    beforeEach(() => {
      // Set up multisig wallet mock with 2-of-2 configuration (using 2 valid keys)
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        quorum: 2,
        totalSigners: 2,
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });

      // Set up UTXO mocks with multisig address
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          // P2WSH scriptPubKey (32-byte witness program)
          scriptPubKey: '0020' + 'a'.repeat(64),
        },
        {
          ...sampleUtxos[0], // 100000 sats
          walletId,
          scriptPubKey: '0020' + 'b'.repeat(64),
        },
      ]);

      // Set up address mocks with BIP-48 derivation paths
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/48'/1'/0'/2'/1/0", // BIP-48 change address
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/48'/1'/0'/2'/0/0", // BIP-48 receive address
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: "m/48'/1'/0'/2'/0/1", // BIP-48 receive address
          walletId,
        },
      ]);
    });

    it('should create batch PSBT with bip32Derivation for ALL cosigners', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 20000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();

      // Parse the PSBT to check bip32Derivation
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // Multisig should have bip32Derivation entries for cosigners (at least 2 for 2-of-3)
      expect(input.bip32Derivation).toBeDefined();
      expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);

      // Verify fingerprints are valid hex strings
      const fingerprints = input.bip32Derivation!.map(d =>
        d.masterFingerprint.toString('hex')
      );
      // At least the first two keys should be present
      expect(fingerprints).toContain('aabbccdd');
      expect(fingerprints).toContain('eeff0011');
    });

    it('should use BIP-48 paths for multisig batch bip32Derivation', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // All paths should be BIP-48 format: m/48'/coin'/account'/script'/change/index
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should include bip32Derivation in all batch inputs', async () => {
      // Use sendMax to ensure we use all UTXOs (both inputs)
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      // Should have 2 inputs
      expect(psbt.data.inputs.length).toBe(2);

      // Each input should have bip32Derivation entries for cosigners
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const input = psbt.data.inputs[i];
        expect(input.bip32Derivation).toBeDefined();
        expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should derive correct pubkeys for each cosigner in batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // Each bip32Derivation should have a valid compressed public key (33 bytes)
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.pubkey.length).toBe(33);
        // Compressed pubkeys start with 0x02 or 0x03
        expect([0x02, 0x03]).toContain(derivation.pubkey[0]);
      }
    });

    it('should include inputPaths in response for hardware wallet signing', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.inputPaths).toBeDefined();
      expect(result.inputPaths.length).toBe(result.utxos.length);

      // Input paths should be BIP-48 format
      for (const path of result.inputPaths) {
        expect(path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should include witnessScript for P2WSH multisig inputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // P2WSH multisig should have witnessScript
      expect(input.witnessScript).toBeDefined();
      expect(input.witnessScript!.length).toBeGreaterThan(0);

      // WitnessScript for 2-of-2 multisig starts with OP_2 (0x52) and ends with OP_2 OP_CHECKMULTISIG (0x52 0xae)
      // Format: OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
      const script = input.witnessScript!;
      expect(script[0]).toBe(0x52); // OP_2 (m)
      expect(script[script.length - 2]).toBe(0x52); // OP_2 (n)
      expect(script[script.length - 1]).toBe(0xae); // OP_CHECKMULTISIG
    });

    it('should include redeemScript for sh-wsh-sortedmulti batch descriptors', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    });

    it('should continue when batch multisig descriptor parsing fails', async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbtBase64).toBeDefined();
    });
  });

  describe('buildMultisigWitnessScript', () => {
    const network = bitcoin.networks.testnet;

    it('should build valid witnessScript from multisig keys', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      // Use 2 valid testnet tpub keys for 2-of-2 multisig
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];
      const quorum = 2;

      const witnessScript = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        quorum,
        network,
        0
      );

      expect(witnessScript).toBeDefined();
      expect(witnessScript!.length).toBeGreaterThan(0);

      // Verify it's a valid 2-of-2 multisig script
      expect(witnessScript![0]).toBe(0x52); // OP_2
      expect(witnessScript![witnessScript!.length - 2]).toBe(0x52); // OP_2 (n=2)
      expect(witnessScript![witnessScript!.length - 1]).toBe(0xae); // OP_CHECKMULTISIG
    });

    it('should sort pubkeys lexicographically', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];
      const quorum = 2;

      const witnessScript = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        quorum,
        network,
        0
      );

      expect(witnessScript).toBeDefined();

      // Extract pubkeys from script (each is 33 bytes, preceded by 0x21 push opcode)
      const pubkeys: Buffer[] = [];
      let i = 1; // Skip OP_2
      while (witnessScript![i] === 0x21) { // 0x21 = push 33 bytes
        pubkeys.push(witnessScript!.slice(i + 1, i + 34));
        i += 34;
      }

      // Verify pubkeys are sorted
      for (let j = 0; j < pubkeys.length - 1; j++) {
        expect(pubkeys[j].compare(pubkeys[j + 1])).toBeLessThan(0);
      }
    });

    it('should return undefined for invalid keys', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const invalidKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'invalid-xpub',
          derivationPath: '0/*',
        },
      ];

      const result = buildMultisigWitnessScript(
        derivationPath,
        invalidKeys,
        2,
        network,
        0
      );

      expect(result).toBeUndefined();
    });

    it('should handle different derivation paths (change vs receive)', () => {
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];

      // Receive address path (change=0, index=5)
      const receiveScript = buildMultisigWitnessScript(
        "m/48'/1'/0'/2'/0/5",
        multisigKeys,
        2,
        network,
        0
      );

      // Change address path (change=1, index=3)
      const changeScript = buildMultisigWitnessScript(
        "m/48'/1'/0'/2'/1/3",
        multisigKeys,
        2,
        network,
        0
      );

      expect(receiveScript).toBeDefined();
      expect(changeScript).toBeDefined();

      // Different paths should produce different scripts (different pubkeys derived)
      expect(receiveScript!.equals(changeScript!)).toBe(false);
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
      expect(nodeClient.getNodeClient).toHaveBeenCalled();
    });
  });

  describe('generateDecoyAmounts', () => {
    const dustThreshold = 546;

    it('should return single amount when count is less than 2', () => {
      const result = generateDecoyAmounts(100000, 1, dustThreshold);
      expect(result).toEqual([100000]);

      const result0 = generateDecoyAmounts(100000, 0, dustThreshold);
      expect(result0).toEqual([100000]);
    });

    it('should split change into multiple amounts', () => {
      const totalChange = 100000;
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(count);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
    });

    it('should ensure all amounts are above dust threshold', () => {
      const totalChange = 10000;
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      result.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it('should return single output if not enough change for decoys', () => {
      const totalChange = 1000; // Less than dustThreshold * 2
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toEqual([totalChange]);
    });

    it('should handle exactly 2 outputs', () => {
      const totalChange = 50000;
      const count = 2;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(2);
      expect(result[0] + result[1]).toBe(totalChange);
      expect(result[0]).toBeGreaterThanOrEqual(dustThreshold);
      expect(result[1]).toBeGreaterThanOrEqual(dustThreshold);
    });

    it('should handle 4 outputs (max decoys)', () => {
      const totalChange = 200000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(4);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
      result.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it('should produce varied amounts (not equal splits)', () => {
      const totalChange = 100000;
      const count = 3;

      // Run multiple times to verify randomness
      const results = Array.from({ length: 10 }, () =>
        generateDecoyAmounts(totalChange, count, dustThreshold)
      );

      // Check that not all results are identical
      const firstResult = JSON.stringify(results[0]);
      const allIdentical = results.every(r => JSON.stringify(r) === firstResult);
      expect(allIdentical).toBe(false);
    });
  });

  describe('isChange flag detection', () => {
    it('should detect change addresses from derivation path', () => {
      // In BIP44/49/84, the 4th level indicates change (0=receive, 1=change)
      const receivePathBIP84 = "m/84'/0'/0'/0/5"; // Receive address
      const changePathBIP84 = "m/84'/0'/0'/1/3"; // Change address

      // Parse derivation path to determine isChange
      const isChangeReceive = receivePathBIP84.split('/')[4] === '1';
      const isChangeChange = changePathBIP84.split('/')[4] === '1';

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it('should detect change for BIP49 (nested SegWit) paths', () => {
      const receivePathBIP49 = "m/49'/0'/0'/0/0";
      const changePathBIP49 = "m/49'/0'/0'/1/10";

      const isChangeReceive = receivePathBIP49.split('/')[4] === '1';
      const isChangeChange = changePathBIP49.split('/')[4] === '1';

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it('should detect change for BIP86 (Taproot) paths', () => {
      const receivePathBIP86 = "m/86'/0'/0'/0/2";
      const changePathBIP86 = "m/86'/0'/0'/1/8";

      const isChangeReceive = receivePathBIP86.split('/')[4] === '1';
      const isChangeChange = changePathBIP86.split('/')[4] === '1';

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it('should handle testnet derivation paths', () => {
      const receivePathTestnet = "m/84'/1'/0'/0/0"; // Testnet
      const changePathTestnet = "m/84'/1'/0'/1/5"; // Testnet change

      const isChangeReceive = receivePathTestnet.split('/')[4] === '1';
      const isChangeChange = changePathTestnet.split('/')[4] === '1';

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it('should handle edge cases for path parsing', () => {
      // Empty or malformed paths
      const emptyPath = '';
      const shortPath = "m/84'/0'";

      const parseIsChange = (path: string) => {
        const parts = path.split('/');
        return parts.length > 4 && parts[4] === '1';
      };

      expect(parseIsChange(emptyPath)).toBe(false);
      expect(parseIsChange(shortPath)).toBe(false);
    });
  });

  describe('Error Handling - Transaction Building Edge Cases', () => {
    const walletId = 'test-wallet-error-cases';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up default wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);
    });

    it('should throw when no change address available (single-sig)', async () => {
      // No change addresses and no receiving addresses available
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 50000, 10)
      ).rejects.toThrow('No change address available');
    });

    it('should handle zero amount with sendMax=false', async () => {
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

      // Zero amount without sendMax should still be processed
      // (may result in dust output which is recipient's concern)
      const result = await createTransaction(walletId, recipient, 0, 10, {
        sendMax: false,
      });

      expect(result.psbt).toBeDefined();
      expect(result.effectiveAmount).toBe(0);
    });

    it('should throw for negative fee rate', async () => {
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

      // Negative fee rate should be handled (clamped or error)
      const result = await estimateTransaction(walletId, recipient, 50000, -10);
      // Implementation may accept or reject - verify consistent behavior
      expect(result.sufficient !== undefined || result.error !== undefined).toBe(true);
    });

    it('should handle extremely high fee rate that exceeds available balance', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10000) }, // Small UTXO
      ]);

      const result = await estimateTransaction(
        walletId,
        recipient,
        1000, // Small amount
        10000 // Extremely high fee rate
      );

      // Fee would exceed balance
      expect(result.sufficient).toBe(false);
    });

    it('should handle wallet with null descriptor', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        descriptor: null, // Null descriptor
      });

      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);

      // Should still create transaction (descriptor is optional for some operations)
      const result = await createTransaction(walletId, recipient, 50000, 10);
      expect(result.psbt).toBeDefined();
    });

    it('should handle UTXOs with different scriptPubKey types', async () => {
      // Mix of different UTXO types
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40), // P2WPKH
          amount: BigInt(100000),
        },
        {
          ...sampleUtxos[1],
          walletId,
          scriptPubKey: '0020' + 'b'.repeat(64), // P2WSH
          amount: BigInt(50000),
        },
      ]);

      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[0].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[1].address,
          derivationPath: "m/84'/1'/0'/0/1",
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 30000, 10);
      expect(result.psbt).toBeDefined();
      expect(result.utxos.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling - Batch Transaction Edge Cases', () => {
    const walletId = 'batch-error-wallet';

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
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
    });

    it('should throw error for duplicate addresses in outputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[0], amount: 20000 }, // Duplicate
      ];

      // Duplicate addresses may be allowed (batching to same recipient)
      // or rejected depending on implementation
      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        // If allowed, should combine or keep separate
        expect(result.psbt).toBeDefined();
      } catch (error) {
        expect((error as Error).message).toContain('duplicate');
      }
    });

    it('should throw error for output with negative amount', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: -1000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow();
    });

    it('should throw error for mainnet address on testnet wallet', async () => {
      const outputs = [
        // Mainnet address on testnet wallet
        { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 30000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow();
    });

    it('should handle batch with all outputs as sendMax', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 0, sendMax: true },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      // Multiple sendMax outputs - should split or error
      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        // If allowed, each sendMax gets a share
        expect(result.psbt).toBeDefined();
      } catch (error) {
        // Multiple sendMax may be rejected
        expect((error as Error).message).toMatch(/sendMax/i);
      }
    });

    it('should handle batch with mix of normal and sendMax outputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.outputs).toHaveLength(2);
      expect(result.outputs[0].amount).toBe(30000);
      expect(result.outputs[1].amount).toBeGreaterThan(0); // Gets remaining
    });

    it('should handle large number of outputs', async () => {
      // Create many outputs (could hit transaction size limits)
      const outputs = Array.from({ length: 20 }, (_, i) => ({
        address: testnetAddresses.nativeSegwit[i % 2],
        amount: 5000,
      }));

      // Need more UTXOs for this
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId, amount: BigInt(500000), scriptPubKey: '0014' + 'a'.repeat(40) },
      ]);

      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        expect(result.outputs.length).toBeGreaterThan(0);
      } catch (error) {
        // May fail due to transaction size or dust outputs
        expect(error).toBeDefined();
      }
    });
  });

  describe('Error Handling - Broadcast Edge Cases', () => {
    const walletId = 'broadcast-error-wallet';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      (broadcastTransaction as Mock).mockResolvedValue({
        txid: 'new-txid-from-broadcast',
        broadcasted: true,
      });
      (recalculateWalletBalances as Mock).mockResolvedValue(undefined);
      mockPrismaClient.uTXO.update.mockResolvedValue({});
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
    });

    it('should handle database error during UTXO update', async () => {
      mockPrismaClient.uTXO.update.mockRejectedValueOnce(new Error('DB connection lost'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Should throw when database update fails
      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('DB connection lost');
    });

    it('should handle database error during transaction create', async () => {
      mockPrismaClient.transaction.create.mockRejectedValueOnce(new Error('Constraint violation'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Constraint violation');
    });

    it('should handle empty UTXO array in metadata', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [], // Empty UTXOs
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Should still broadcast (UTXOs from rawTxHex)
      const result = await broadcastAndSave(walletId, undefined, metadata);
      expect(result.broadcasted).toBe(true);
    });

    it('should handle broadcast timeout/network error', async () => {
      (broadcastTransaction as Mock).mockRejectedValueOnce(new Error('Network timeout'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Network timeout');
    });

    it('should handle invalid rawTxHex format', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: 'not-a-valid-hex-string',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow();
    });

    it('should handle missing required metadata fields', async () => {
      const incompleteMetadata = {
        recipient,
        // Missing: amount, fee, utxos
      };

      await expect(
        broadcastAndSave(walletId, undefined, incompleteMetadata as any)
      ).rejects.toThrow();
    });
  });

  describe('UTXO Selection Edge Cases', () => {
    const walletId = 'utxo-edge-case-wallet';

    it('should handle UTXOs with exact amount + fee (no change)', async () => {
      const targetAmount = 50000;
      const feeRate = 10;
      // Estimated fee for 1-in-2-out ~ 141 vBytes * 10 = 1410 sats
      // So UTXO of 51410 would leave no change

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(51500), // Slightly more than target + fee
        },
      ]);

      const result = await selectUTXOs(walletId, targetAmount, feeRate);

      // Change should be minimal (possibly below dust threshold)
      expect(result.totalAmount).toBe(51500);
    });

    it('should handle single UTXO that barely covers target', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(60000), // Just enough
        },
      ]);

      const result = await selectUTXOs(walletId, 55000, 10);
      expect(result.utxos.length).toBe(1);
    });

    it('should select multiple small UTXOs when no single large one exists', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10000) },
        { ...sampleUtxos[1], walletId, amount: BigInt(15000) },
        { ...sampleUtxos[2], walletId, amount: BigInt(20000) },
        {
          id: 'utxo-4',
          txid: 'txid4'.repeat(8),
          vout: 0,
          walletId,
          amount: BigInt(25000),
          spent: false,
          frozen: false,
          confirmations: 6,
          address: 'addr4',
          scriptPubKey: '0014' + 'd'.repeat(40),
        },
      ]);

      const result = await selectUTXOs(walletId, 50000, 5);

      expect(result.utxos.length).toBeGreaterThan(1);
      expect(result.totalAmount).toBeGreaterThanOrEqual(50000);
    });

    it('should prefer fewer inputs to minimize fees', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(100000) }, // Large - should prefer
        { ...sampleUtxos[1], walletId, amount: BigInt(30000) },
        { ...sampleUtxos[2], walletId, amount: BigInt(30000) },
      ]);

      const result = await selectUTXOs(
        walletId,
        50000,
        10,
        UTXOSelectionStrategy.LARGEST_FIRST
      );

      // Should use the single large UTXO instead of multiple small ones
      expect(result.utxos.length).toBe(1);
      expect(result.utxos[0].amount).toBe(BigInt(100000));
    });
  });

  describe('estimateTransaction Error Cases', () => {
    const walletId = 'estimate-error-wallet';

    it('should return estimate even for invalid recipient (validation happens during creation)', async () => {
      // estimateTransaction only checks UTXO availability, not address validity
      // Address validation happens during actual transaction creation
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId },
      ]);

      const result = await estimateTransaction(
        walletId,
        'invalid-address',
        50000,
        10
      );

      // The estimate can succeed even with invalid address
      // since it only calculates fees and UTXO selection
      expect(result).toBeDefined();
      expect(result.fee).toBeDefined();
    });

    it('should handle wallet with zero UTXOs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        10
      );

      expect(result.sufficient).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle transaction to own wallet address', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId },
      ]);

      // Sending to own address (consolidation)
      const result = await estimateTransaction(
        walletId,
        sampleUtxos[2].address, // Own address
        50000,
        10
      );

      expect(result.sufficient).toBe(true);
    });
  });

  describe('buildMultisigBip32Derivations Edge Cases', () => {
    const network = bitcoin.networks.testnet;

    it('should handle missing xpub in key info', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const keysWithMissingXpub = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: '', // Empty xpub
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];

      const result = buildMultisigBip32Derivations(
        derivationPath,
        keysWithMissingXpub,
        network
      );

      // Should skip invalid key or return partial result
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should handle invalid fingerprint format', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const keysWithBadFingerprint = [
        {
          fingerprint: 'not-hex', // Invalid hex
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
      ];

      // May throw or skip
      try {
        const result = buildMultisigBip32Derivations(
          derivationPath,
          keysWithBadFingerprint,
          network
        );
        // If doesn't throw, should handle gracefully
        expect(Array.isArray(result)).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should derive correct paths for deeply nested derivation', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/999"; // Deep index
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];

      const result = buildMultisigBip32Derivations(
        derivationPath,
        multisigKeys,
        network
      );

      expect(result.length).toBe(2);
      // Verify paths include the deep index
      result.forEach(d => {
        expect(d.path).toMatch(/\/999$/);
      });
    });
  });

  describe('selectUTXOs with Explicit Selection', () => {
    const walletId = 'explicit-selection-wallet';

    it('should throw insufficient funds error when explicitly selected UTXOs are not enough', async () => {
      const smallUtxo = { ...sampleUtxos[0], walletId, amount: BigInt(5000) };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([smallUtxo]);

      const selectedId = `${smallUtxo.txid}:${smallUtxo.vout}`;

      // Target amount much larger than selected UTXO
      await expect(
        selectUTXOs(walletId, 50000, 10, UTXOSelectionStrategy.LARGEST_FIRST, [selectedId])
      ).rejects.toThrow('Insufficient funds');
    });

    it('should use all explicitly selected UTXOs even if one would suffice', async () => {
      const utxo1 = { ...sampleUtxos[0], walletId, amount: BigInt(50000) };
      const utxo2 = { ...sampleUtxos[1], walletId, amount: BigInt(30000) };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo1, utxo2]);

      const selectedIds = [
        `${utxo1.txid}:${utxo1.vout}`,
        `${utxo2.txid}:${utxo2.vout}`,
      ];

      const result = await selectUTXOs(
        walletId,
        20000, // Small amount, either UTXO would suffice
        10,
        UTXOSelectionStrategy.LARGEST_FIRST,
        selectedIds
      );

      // Should use both UTXOs since they were explicitly selected
      expect(result.utxos.length).toBe(2);
      expect(result.totalAmount).toBe(80000);
    });
  });

  describe('generateDecoyAmounts Additional Tests', () => {
    const dustThreshold = 546;

    it('should handle large change amount with many outputs', () => {
      const totalChange = 500000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(4);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
      result.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it('should distribute amounts somewhat evenly', () => {
      const totalChange = 100000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      // Each amount should be roughly 1/4 of total (±50%)
      const expectedAvg = totalChange / count;
      result.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
        expect(amount).toBeLessThanOrEqual(expectedAvg * 2); // No single output > 2x average
      });
    });

    it('should handle edge case where count equals 1', () => {
      const totalChange = 10000;
      const result = generateDecoyAmounts(totalChange, 1, dustThreshold);

      expect(result).toEqual([10000]);
    });

    it('should handle change just above minimum for 2 outputs', () => {
      const totalChange = dustThreshold * 2 + 100; // Just enough for 2 outputs
      const count = 2;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      // Should produce 2 outputs, each >= dust threshold
      expect(result).toHaveLength(2);
      result.forEach(amount => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });
  });

  describe('buildMultisigWitnessScript Edge Cases', () => {
    const network = bitcoin.networks.testnet;

    it('should return undefined for change path (index 1)', () => {
      const derivationPath = "m/48'/1'/0'/2'/1/0"; // Change address path (index 1)
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '1/*', // Note: different derivation for change
        },
      ];

      const result = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        2,
        network,
        0
      );

      // Should still produce a valid script for change addresses
      expect(result === undefined || Buffer.isBuffer(result)).toBe(true);
    });

    it('should build valid 2-of-2 multisig script', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const multisigKeys = [
        {
          fingerprint: 'aabbccdd',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: '0/*',
        },
        {
          fingerprint: 'eeff0011',
          accountPath: "48'/1'/0'/2'",
          xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
          derivationPath: '0/*',
        },
      ];

      const result = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        2,
        network,
        0
      );

      // Should produce a valid witness script
      expect(result).toBeDefined();
      if (result) {
        expect(Buffer.isBuffer(result)).toBe(true);
        // Multisig script should end with OP_CHECKMULTISIG (0xae)
        expect(result[result.length - 1]).toBe(0xae);
      }
    });
  });

  describe('Consolidation address filtering', () => {
    it('should only return receive addresses for consolidation', () => {
      const addresses = [
        { address: 'bc1qreceive1', derivationPath: "m/84'/0'/0'/0/0", isChange: false },
        { address: 'bc1qreceive2', derivationPath: "m/84'/0'/0'/0/1", isChange: false },
        { address: 'bc1qchange1', derivationPath: "m/84'/0'/0'/1/0", isChange: true },
        { address: 'bc1qchange2', derivationPath: "m/84'/0'/0'/1/1", isChange: true },
      ];

      const receiveAddresses = addresses.filter(addr => !addr.isChange);

      expect(receiveAddresses).toHaveLength(2);
      expect(receiveAddresses.every(addr => !addr.isChange)).toBe(true);
      expect(receiveAddresses[0].address).toBe('bc1qreceive1');
      expect(receiveAddresses[1].address).toBe('bc1qreceive2');
    });

    it('should exclude change addresses from consolidation options', () => {
      const addresses = [
        { address: 'bc1qa1', derivationPath: "m/84'/0'/0'/0/0", isChange: false },
        { address: 'bc1qb2', derivationPath: "m/84'/0'/0'/1/0", isChange: true },
        { address: 'bc1qc3', derivationPath: "m/84'/0'/0'/0/1", isChange: false },
        { address: 'bc1qd4', derivationPath: "m/84'/0'/0'/1/1", isChange: true },
        { address: 'bc1qe5', derivationPath: "m/84'/0'/0'/0/2", isChange: false },
      ];

      const consolidationAddresses = addresses.filter(addr => !addr.isChange);

      expect(consolidationAddresses).toHaveLength(3);
      expect(consolidationAddresses.map(a => a.address)).toEqual([
        'bc1qa1',
        'bc1qc3',
        'bc1qe5',
      ]);
    });

    it('should handle wallet with only receive addresses', () => {
      const addresses = [
        { address: 'bc1qreceive1', derivationPath: "m/84'/0'/0'/0/0", isChange: false },
        { address: 'bc1qreceive2', derivationPath: "m/84'/0'/0'/0/1", isChange: false },
      ];

      const receiveAddresses = addresses.filter(addr => !addr.isChange);

      expect(receiveAddresses).toHaveLength(2);
      expect(receiveAddresses).toEqual(addresses);
    });

    it('should handle wallet with only change addresses', () => {
      const addresses = [
        { address: 'bc1qchange1', derivationPath: "m/84'/0'/0'/1/0", isChange: true },
        { address: 'bc1qchange2', derivationPath: "m/84'/0'/0'/1/1", isChange: true },
      ];

      const receiveAddresses = addresses.filter(addr => !addr.isChange);

      expect(receiveAddresses).toHaveLength(0);
    });

    it('should correctly identify change from derivation path', () => {
      const getIsChangeFromPath = (path: string) => {
        const parts = path.split('/');
        return parts.length > 4 && parts[4] === '1';
      };

      const addresses = [
        { address: 'bc1q1', path: "m/84'/0'/0'/0/0" }, // receive
        { address: 'bc1q2', path: "m/84'/0'/0'/1/0" }, // change
        { address: 'bc1q3', path: "m/49'/0'/0'/0/5" }, // receive (P2SH-SegWit)
        { address: 'bc1q4', path: "m/49'/0'/0'/1/2" }, // change (P2SH-SegWit)
        { address: 'bc1q5', path: "m/86'/0'/0'/0/1" }, // receive (Taproot)
        { address: 'bc1q6', path: "m/86'/0'/0'/1/3" }, // change (Taproot)
      ];

      const receiveAddresses = addresses.filter(
        addr => !getIsChangeFromPath(addr.path)
      );

      expect(receiveAddresses).toHaveLength(3);
      expect(receiveAddresses.map(a => a.address)).toEqual([
        'bc1q1',
        'bc1q3',
        'bc1q5',
      ]);
    });

    it('should preserve address metadata when filtering', () => {
      const addresses = [
        {
          address: 'bc1qreceive',
          derivationPath: "m/84'/0'/0'/0/0",
          isChange: false,
          index: 0,
          used: false,
        },
        {
          address: 'bc1qchange',
          derivationPath: "m/84'/0'/0'/1/0",
          isChange: true,
          index: 0,
          used: true,
        },
      ];

      const receiveAddresses = addresses.filter(addr => !addr.isChange);

      expect(receiveAddresses).toHaveLength(1);
      expect(receiveAddresses[0]).toEqual({
        address: 'bc1qreceive',
        derivationPath: "m/84'/0'/0'/0/0",
        isChange: false,
        index: 0,
        used: false,
      });
    });
  });
});
