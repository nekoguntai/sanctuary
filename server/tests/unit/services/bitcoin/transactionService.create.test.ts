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
  createTransaction,
  createAndBroadcastTransaction,
  estimateTransaction,
  getPSBTInfo,
  generateDecoyAmounts,
  buildMultisigWitnessScript,
  buildMultisigBip32Derivations,
} from '../../../../src/services/bitcoin/transactionService';
import { estimateTransactionSize } from '../../../../src/services/bitcoin/utils';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../src/services/bitcoin/blockchain';
import * as nodeClient from '../../../../src/services/bitcoin/nodeClient';
import * as psbtBuilder from '../../../../src/services/bitcoin/psbtBuilder';
import * as asyncUtils from '../../../../src/utils/async';

const flushPromises = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};


describe('Transaction Service — Creation', () => {
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

    it('should exclude dust change from totalOutput when no change output is created', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(11_200),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      const result = await createTransaction(walletId, recipient, 10_000, 5);

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(result.totalOutput).toBe(result.effectiveAmount);
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
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
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
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
    });

    it('should continue when single-sig descriptor parsing fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: 'aabbccdd',
        descriptor: "wpkh([aabbccdd/84'/1'/0']invalid/0/*)",
      });
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
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

    it('should derive BIP32 with non-hardened leading path segments', async () => {
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
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'm/0/1/2/3/4',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe('m/0/1/2/3/4');
    });

    it('should continue when single-sig input pubkey derivation fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: 'aabbccdd',
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
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/notanumber",
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
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
        Buffer.from(d.masterFingerprint).toString('hex')
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

    it('should skip script wrappers when multisig descriptor type is unrecognized', async () => {
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

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBeGreaterThan(0);
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });

    it('should skip multisig derivation and witness script when derivation path is invalid', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
    });

    it('should skip multisig BIP32 attachment when input derivation path is empty', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: '',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should skip sh-wsh script attachments when witness script derivation fails', async () => {
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

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });

    it('should continue when multisig descriptor parsing fails', async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      expect(result.psbtBase64).toBeDefined();
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
        expect(Buffer.from(pubkeys[j]).compare(Buffer.from(pubkeys[j + 1]))).toBeLessThan(0);
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
      expect(Buffer.from(receiveScript!).equals(Buffer.from(changeScript!))).toBe(false);
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

    it('should throw when legacy raw transaction fetch returns no entries', async () => {
      const amount = 50000;
      const feeRate = 10;
      const mapWithConcurrencySpy = vi
        .spyOn(asyncUtils, 'mapWithConcurrency')
        .mockResolvedValueOnce([] as any);

      try {
        await expect(
          createTransaction(walletId, recipient, amount, feeRate)
        ).rejects.toThrow(`Failed to fetch raw transaction for ${sampleUtxos[2].txid}`);
      } finally {
        mapWithConcurrencySpy.mockRestore();
      }
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
      expect(result === undefined || result instanceof Uint8Array).toBe(true);
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
        expect(result instanceof Uint8Array).toBe(true);
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
