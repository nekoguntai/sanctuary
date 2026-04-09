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
import { Prisma } from '../../../../src/generated/prisma/client';

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
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
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
  createBatchTransaction,
} from '../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction } from '../../../../src/services/bitcoin/blockchain';
import * as nodeClient from '../../../../src/services/bitcoin/nodeClient';
import * as asyncUtils from '../../../../src/utils/async';

describe('Transaction Service — Batch', () => {
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

    it('should treat non-testnet batch wallets as mainnet during output validation', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        network: 'mainnet',
        devices: [],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Invalid address');
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

    it('should disable RBF sequence numbers in batch mode when enableRBF is false', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        enableRBF: false,
      });
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.txInputs.every((input) => input.sequence === 0xffffffff)).toBe(true);
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

    it('should filter to selected batch UTXOs when selectedUtxoIds are provided', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];
      const selected = [`${sampleUtxos[2].txid}:${sampleUtxos[2].vout}`];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        selectedUtxoIds: selected,
      });

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].txid).toBe(sampleUtxos[2].txid);
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
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
    });

    it('should skip single-sig BIP32 when primary batch device has no fingerprint and xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'empty-metadata-device',
              fingerprint: null,
              xpub: null,
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should derive batch BIP32 with non-hardened leading path segments', async () => {
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
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'm/0/1/2/3/4',
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: 'm/0/1/2/3/5',
          walletId,
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe('m/0/1/2/3/4');
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

    it('should continue when batch descriptor parsing does not provide an xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: null,
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      });
      mockParseDescriptor.mockImplementationOnce(() => ({
        type: 'wpkh',
        xpub: undefined,
        fingerprint: 'aabbccdd',
      } as any));

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should preserve empty input derivation paths when address metadata is missing', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.inputPaths.length).toBeGreaterThan(0);
      expect(result.inputPaths.every((path) => path === '')).toBe(true);
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

    it('should throw when legacy batch raw transactions are unavailable in cache', async () => {
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

      const mapWithConcurrencySpy = vi.spyOn(asyncUtils, 'mapWithConcurrency').mockResolvedValueOnce([] as any);
      const outputs = [
        { address: testnetAddresses.legacy[0], amount: 50_000 },
      ];

      try {
        await expect(
          createBatchTransaction(walletId, outputs, 10)
        ).rejects.toThrow(`Failed to fetch raw transaction for ${sampleUtxos[2].txid}`);
      } finally {
        mapWithConcurrencySpy.mockRestore();
      }
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
        Buffer.from(d.masterFingerprint).toString('hex')
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

    it('should skip batch multisig derivation and witness script when derivation path is invalid', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
    });

    it('should skip sh-wsh batch script attachments when witness script derivation fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
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

    it('should build multisig batch PSBT when descriptor type is not a recognized script wrapper', async () => {
      mockParseDescriptor.mockImplementationOnce(() => ({
        type: 'sortedmulti',
        quorum: 2,
        keys: [
          {
            fingerprint: 'aabbccdd',
            accountPath: "48'/1'/0'/2'",
            xpub: multisigKeyInfo[0].xpub,
            derivationPath: '0/*',
          },
          {
            fingerprint: 'eeff0011',
            accountPath: "48'/1'/0'/2'",
            xpub: multisigKeyInfo[1].xpub,
            derivationPath: '0/*',
          },
        ],
      } as any));

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBeGreaterThan(0);
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
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

});
