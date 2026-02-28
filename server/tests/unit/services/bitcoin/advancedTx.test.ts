import { vi } from 'vitest';
/**
 * Advanced Transaction Tests (RBF/CPFP)
 *
 * Tests for Replace-By-Fee and Child-Pays-For-Parent functionality.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks, createMockTransaction } from '../../../mocks/electrum';
import { sampleUtxos, testnetAddresses, sampleTransactions } from '../../../fixtures/bitcoin';
import * as addressDerivation from '../../../../src/services/bitcoin/addressDerivation';

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock Electrum client
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue(mockElectrumClient),
}));

// Mock nodeClient - canReplaceTransaction uses getNodeClient
vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

// Import after mocks
import {
  isRBFSignaled,
  canReplaceTransaction,
  createRBFTransaction,
  calculateCPFPFee,
  createCPFPTransaction,
  createBatchTransaction,
  getAdvancedFeeEstimates,
  estimateOptimalFee,
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

      it('should return not replaceable when tx hex is unavailable', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue({
          txid,
          confirmations: 0,
          hex: '',
          vin: [],
          vout: [],
        });

        const result = await canReplaceTransaction(txid);

        expect(result).toEqual({
          replaceable: false,
          reason: 'Transaction data not available from server',
        });
      });

      it('should handle client errors gracefully', async () => {
        mockElectrumClient.getTransaction.mockRejectedValue(new Error('node unavailable'));

        const result = await canReplaceTransaction(txid);
        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('node unavailable');
      });

      it('should handle malformed transaction hex in non-RBF debug logging path', async () => {
        mockElectrumClient.getTransaction.mockResolvedValue({
          txid,
          confirmations: 0,
          hex: 'zzzz',
          vin: [],
          vout: [],
        });

        const result = await canReplaceTransaction(txid);
        expect(result.replaceable).toBe(false);
        expect(result.reason).toContain('RBF');
      });
    });
  });

  describe('RBF Transaction Creation', () => {
    const originalTxid = 'a'.repeat(64);
    const walletId = 'test-wallet-id';
    const testnetTpub = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';

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

    it('should throw error when wallet is missing', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('Wallet not found');
    });

    it('creates an RBF PSBT when wallet metadata has no devices, fingerprint, or descriptor', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet)
        .toString('hex');
      const inputHash = Buffer.from('10'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 45_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 54_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF No Metadata Wallet',
        descriptor: null,
        fingerprint: null,
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/0/0");
    });

    it('supports zero current fee rate and wallet devices without fingerprint/xpub', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet)
        .toString('hex');
      const inputHash = Buffer.from('11'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 60_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 40_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Device Missing Metadata',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: null, xpub: null } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 1, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.feeRate).toBe(1);
    });

    it('should create an RBF replacement PSBT when a wallet change output exists', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('01'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), 40_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 55_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'device-1',
              fingerprint: 'aabbccdd',
              xpub: testnetTpub,
            },
          },
        ],
      });

      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([
          { address: changeAddress },
        ]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [
              {
                value: 0.001,
                scriptPubKey: { hex: spendScriptHex, address: spendAddress },
              },
            ],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.fee).toBeGreaterThan(0);
      expect(result.feeDelta).toBeGreaterThan(0);
      expect(result.outputs.find(o => o.address === changeAddress)?.value).toBeLessThan(55_000);
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/0/0");
    });

    it('should fail when no wallet change output is available for fee bump', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('02'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), 95_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" }])
        .mockResolvedValueOnce([]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 90, walletId, 'testnet')
      ).rejects.toThrow('No change output found');
    });

    it('should fail when fee bump would drop change below dust threshold', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('03'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), 98_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 1_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 30, walletId, 'testnet')
      ).rejects.toThrow('change would be dust');
    });

    it('uses descriptor xpub fallback when device xpub is unavailable', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('04'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 45_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 50_000);
      const txHex = tx.toHex();

      const parseSpy = vi.spyOn(addressDerivation, 'parseDescriptor').mockReturnValue({
        type: 'wpkh',
        xpub: testnetTpub,
      } as any);

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Descriptor Wallet',
        descriptor: 'wpkh([aabbccdd/84h/1h/0h]tpub.../0/*)',
        fingerprint: 'aabbccdd',
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return { txid: inputTxid, vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }] } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 80, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(parseSpy).toHaveBeenCalled();
      parseSpy.mockRestore();
    });

    it('continues when xpub parsing or input address decoding fails', async () => {
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const inputHash = Buffer.from('05'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 40_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 55_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Invalid-Xpub Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: 'invalid-xpub' } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" }])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: '00' } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe('');
    });

    it('continues when bip32Derivation update fails for malformed derivation path', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('06'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 42_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 53_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Path Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/bad/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/bad/0");
    });

    it('handles unhardened derivation path segments when building RBF bip32 data', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet).toString('hex');
      const inputHash = Buffer.from('12'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 42_000);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 53_000);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Unhardened Path Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: 'm/84/1/0/0/0' },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe('m/84/1/0/0/0');
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

    it('should create CPFP PSBT for a spendable parent output', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.000001, scriptPubKey: { hex: '0014cc' } }] });

      const result = await createCPFPTransaction(
        parentTxid,
        parentVout,
        5,
        recipientAddress,
        walletId,
        'testnet'
      );

      expect(result.psbt).toBeDefined();
      expect(result.childFee).toBeGreaterThan(0);
      expect(result.effectiveFeeRate).toBeGreaterThanOrEqual(5);
    });

    it('should throw when resulting child output would be dust', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValueOnce({
        key: 'dustThreshold',
        value: '1000000000',
      });
      mockPrismaClient.uTXO.findUnique.mockResolvedValueOnce({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.001, scriptPubKey: { hex: '0014cc' } }] });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 5, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('Output would be dust');
    });
  });

  describe('Batch transactions', () => {
    const walletId = 'wallet-batch';

    it('requires at least one recipient', async () => {
      await expect(
        createBatchTransaction([], 5, walletId, undefined, 'testnet')
      ).rejects.toThrow('At least one recipient is required');
    });

    it('throws when no spendable UTXOs remain after filtering', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId },
      ]);

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 1000 }],
          5,
          walletId,
          ['other-tx:1'],
          'testnet'
        )
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('creates a batch PSBT with recipients and change', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
        { ...sampleUtxos[1], walletId, spent: false },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValueOnce({
        address: testnetAddresses.nativeSegwit[0],
      });

      const result = await createBatchTransaction(
        [
          { address: testnetAddresses.nativeSegwit[0], amount: 20000 },
          { address: testnetAddresses.nativeSegwit[1], amount: 15000 },
        ],
        5,
        walletId,
        undefined,
        'testnet'
      );

      expect(result.psbt).toBeDefined();
      expect(result.totalInput).toBeGreaterThan(result.totalOutput);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('throws if change output is needed but unavailable', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValueOnce(null);

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 50000 }],
          5,
          walletId,
          undefined,
          'testnet'
        )
      ).rejects.toThrow('No change address available');
    });

    it('throws when selected inputs cannot cover outputs plus fee', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false, amount: BigInt(1000) },
      ]);

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 50000 }],
          10,
          walletId,
          undefined,
          'testnet'
        )
      ).rejects.toThrow('Insufficient funds');
    });

    it('omits change output when remaining amount is below dust threshold', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        {
          ...sampleUtxos[0],
          walletId,
          spent: false,
          amount: BigInt(30_000),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 29_800 }],
        1,
        walletId,
        undefined,
        'testnet'
      );

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(mockPrismaClient.address.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('Advanced fee estimation', () => {
    it('returns rounded fee tiers from node estimates', async () => {
      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(2.1)
        .mockResolvedValueOnce(1.5)
        .mockResolvedValueOnce(0.9)
        .mockResolvedValueOnce(0.2)
        .mockResolvedValueOnce(0.01);

      const fees = await getAdvancedFeeEstimates();
      expect(fees.fastest.feeRate).toBe(3);
      expect(fees.fast.feeRate).toBe(2);
      expect(fees.medium.feeRate).toBe(1);
      expect(fees.slow.feeRate).toBe(1);
      expect(fees.minimum.feeRate).toBe(1);
    });

    it('falls back to defaults when estimation fails', async () => {
      mockElectrumClient.estimateFee.mockRejectedValue(new Error('estimate failed'));
      const fees = await getAdvancedFeeEstimates();
      expect(fees.fastest.feeRate).toBe(50);
      expect(fees.minimum.feeRate).toBe(1);
    });

    it('formats confirmation time for minutes/hours/days priorities', async () => {
      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const fast = await estimateOptimalFee(1, 2, 'fast', 'native_segwit');
      expect(fast.confirmationTime).toContain('minutes');

      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const slow = await estimateOptimalFee(1, 2, 'slow', 'native_segwit');
      expect(slow.confirmationTime).toContain('hours');

      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const minimum = await estimateOptimalFee(1, 2, 'minimum', 'native_segwit');
      expect(minimum.confirmationTime).toContain('days');
      expect(minimum.fee).toBeGreaterThan(0);
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
