/**
 * Sync Phase Tests
 *
 * Unit tests for individual sync pipeline phases.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
  createMockTransaction,
  createMockUTXO,
} from '../../../../mocks/electrum';

// Mock Prisma
jest.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock node client
jest.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: jest.fn().mockResolvedValue(mockElectrumClient),
}));

// Mock notifications
jest.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: jest.fn(),
  getNotificationService: jest.fn().mockReturnValue({
    broadcastTransactionNotification: jest.fn(),
  }),
}));

// Mock notification service
jest.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: jest.fn().mockResolvedValue(undefined),
}));

// Mock balance calculation
jest.mock('../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: jest.fn().mockResolvedValue(undefined),
  correctConsolidationTransactions: jest.fn().mockResolvedValue({ correctedCount: 0 }),
}));

// Mock address derivation
jest.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: jest.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

import {
  createTestContext,
  rbfCleanupPhase,
  fetchHistoriesPhase,
  checkExistingPhase,
  fetchUtxosPhase,
  reconcileUtxosPhase,
  updateAddressesPhase,
  gapLimitPhase,
  type SyncContext,
} from '../../../../../src/services/bitcoin/sync';

describe('Sync Phases', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
  });

  describe('rbfCleanupPhase', () => {
    it('should mark pending transactions as replaced when confirmed tx shares input', async () => {
      const pendingTxid = 'pending_' + 'a'.repeat(56);
      const confirmedTxid = 'confirmed_' + 'b'.repeat(53);

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        // Pending txs with active RBF status
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-tx-id',
            txid: pendingTxid,
            inputs: [{ txid: 'input_txid', vout: 0 }],
          }];
        }
        // Unlinked replaced txs
        if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
          return [];
        }
        return [];
      });

      // Confirmed replacement found
      mockPrismaClient.transaction.findFirst.mockResolvedValue({ txid: confirmedTxid });

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      // Verify the pending tx was marked as replaced
      const rbfUpdate = updateCalls.find(
        (call) => call.data?.rbfStatus === 'replaced' && call.data?.replacedByTxid === confirmedTxid
      );
      expect(rbfUpdate).toBeDefined();
    });

    it('should not mark pending transaction if no confirmed replacement found', async () => {
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-tx-id',
            txid: 'pending_txid',
            inputs: [{ txid: 'input_txid', vout: 0 }],
          }];
        }
        return [];
      });

      // No confirmed replacement
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      const rbfUpdate = updateCalls.find((call) => call.data?.rbfStatus === 'replaced');
      expect(rbfUpdate).toBeUndefined();
    });

    it('should link unlinked replaced transactions retroactively', async () => {
      const replacedTxid = 'replaced_' + 'a'.repeat(55);
      const replacementTxid = 'replacement_' + 'b'.repeat(52);

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0) return [];
        if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
          return [{
            id: 'unlinked-tx-id',
            txid: replacedTxid,
            inputs: [{ txid: 'shared_input', vout: 0 }],
          }];
        }
        return [];
      });

      mockPrismaClient.transaction.findFirst.mockResolvedValue({ txid: replacementTxid });

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      const linkUpdate = updateCalls.find(
        (call) => call.where?.id === 'unlinked-tx-id' && call.data?.replacedByTxid === replacementTxid
      );
      expect(linkUpdate).toBeDefined();
    });
  });

  describe('fetchHistoriesPhase', () => {
    it('should fetch histories for all addresses', async () => {
      const addr1 = 'tb1qaddr1';
      const addr2 = 'tb1qaddr2';

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([
          [addr1, [{ tx_hash: 'a'.repeat(64), height: 800000 }]],
          [addr2, [{ tx_hash: 'b'.repeat(64), height: 800001 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: addr1, derivationPath: "m/84'/0'/0'/0/0" } as any,
          { id: '2', address: addr2, derivationPath: "m/84'/0'/0'/0/1" } as any,
        ],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(2);
      expect(result.allTxids.size).toBe(2);
      expect(result.stats.historiesFetched).toBe(2);
    });

    it('should handle empty address list', async () => {
      const ctx = createTestContext({
        addresses: [],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(0);
      expect(result.allTxids.size).toBe(0);
    });

    it('should deduplicate txids from multiple addresses', async () => {
      const sharedTxid = 'shared'.padEnd(64, 'a');

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([
          ['addr1', [{ tx_hash: sharedTxid, height: 800000 }]],
          ['addr2', [{ tx_hash: sharedTxid, height: 800000 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any,
          { id: '2', address: 'addr2', derivationPath: "m/84'/0'/0'/0/1" } as any,
        ],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.allTxids.size).toBe(1);
      expect(result.allTxids.has(sharedTxid)).toBe(true);
    });

    it('should fall back to individual requests on batch failure', async () => {
      mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressHistory.mockResolvedValue([
        { tx_hash: 'c'.repeat(64), height: 800000 },
      ]);

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(1);
      expect(mockElectrumClient.getAddressHistory).toHaveBeenCalled();
    });
  });

  describe('checkExistingPhase', () => {
    it('should identify new transactions', async () => {
      const existingTxid = 'existing'.padEnd(64, 'a');
      const newTxid = 'new'.padEnd(64, 'b');

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { txid: existingTxid, type: 'received' },
      ]);

      const ctx = createTestContext({
        allTxids: new Set([existingTxid, newTxid]),
      });

      const result = await checkExistingPhase(ctx);

      expect(result.newTxids).toContain(newTxid);
      expect(result.newTxids).not.toContain(existingTxid);
      expect(result.existingTxidSet.has(existingTxid)).toBe(true);
    });

    it('should handle empty transaction set', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const ctx = createTestContext({
        allTxids: new Set(),
      });

      const result = await checkExistingPhase(ctx);

      expect(result.newTxids).toEqual([]);
      expect(result.existingTxidSet.size).toBe(0);
    });
  });

  describe('fetchUtxosPhase', () => {
    it('should fetch UTXOs for all addresses', async () => {
      const addr1 = 'tb1qaddr1';
      const addr2 = 'tb1qaddr2';

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([
          [addr1, [createMockUTXO({ value: 100000, height: 800000 })]],
          [addr2, [createMockUTXO({ value: 200000, height: 800001 })]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: addr1 } as any,
          { id: '2', address: addr2 } as any,
        ],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      expect(result.utxoResults.length).toBe(2);
      // utxosFetched counts total UTXO count, not addresses
      expect(result.stats.utxosFetched).toBeGreaterThanOrEqual(1);
    });

    it('should build UTXO data map with correct keys', async () => {
      const txid = 'utxo_tx'.padEnd(64, 'a');
      const vout = 1;

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([
          ['addr1', [{ tx_hash: txid, tx_pos: vout, value: 50000, height: 800000 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1' } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      const key = `${txid}:${vout}`;
      expect(result.allUtxoKeys.has(key)).toBe(true);
      expect(result.utxoDataMap.get(key)).toBeDefined();
      expect(result.utxoDataMap.get(key)?.address).toBe('addr1');
    });

    it('should fall back to individual requests on batch failure', async () => {
      mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([
        createMockUTXO({ value: 75000, height: 800000 }),
      ]);

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1' } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      expect(result.utxoResults.length).toBe(1);
      expect(mockElectrumClient.getAddressUTXOs).toHaveBeenCalled();
    });
  });

  describe('reconcileUtxosPhase', () => {
    it('should mark spent UTXOs', async () => {
      const spentUtxoTxid = 'spent'.padEnd(64, 'a');

      // Existing UTXO in database
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: spentUtxoTxid, vout: 0, spent: false, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(), // UTXO no longer on chain
        successfullyFetchedAddresses: new Set(['addr1']),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.objectContaining({ in: ['utxo-1'] }),
          }),
          data: { spent: true },
        })
      );
    });

    it('should update confirmations for existing UTXOs', async () => {
      const txid = 'existing'.padEnd(64, 'b');

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid, vout: 0, spent: false, confirmations: 5, blockHeight: 799995, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        successfullyFetchedAddresses: new Set(['addr1']),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 799995 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'utxo-1' },
          data: expect.objectContaining({
            confirmations: 6, // 800000 - 799995 + 1
          }),
        })
      );
    });

    it('should not mark UTXOs as spent for addresses not fetched', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'a'.repeat(64), vout: 0, spent: false, address: 'unfetched_addr' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        successfullyFetchedAddresses: new Set(['other_addr']), // Different address
      });

      await reconcileUtxosPhase(ctx);

      // Should not mark as spent since we didn't fetch that address
      expect(mockPrismaClient.uTXO.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateAddressesPhase', () => {
    it('should mark addresses with transactions as used', async () => {
      const usedAddress = 'tb1qused';
      const unusedAddress = 'tb1qunused';

      const ctx = createTestContext({
        walletId: 'test-wallet',
        addresses: [
          { id: 'addr-1', address: usedAddress, used: false } as any,
          { id: 'addr-2', address: unusedAddress, used: false } as any,
        ],
        historyResults: new Map([
          [usedAddress, [{ tx_hash: 'a'.repeat(64), height: 800000 }]],
          [unusedAddress, []],
        ]),
      });

      await updateAddressesPhase(ctx);

      expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            address: expect.objectContaining({ in: [usedAddress] }),
          }),
          data: { used: true },
        })
      );
    });

    it('should handle no addresses needing update', async () => {
      const ctx = createTestContext({
        walletId: 'test-wallet',
        addresses: [],
        historyResults: new Map(),
      });

      await updateAddressesPhase(ctx);

      expect(mockPrismaClient.address.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('gapLimitPhase', () => {
    const mockDescriptor = "wpkh([12345678/84'/0'/0']xpub6CatWdiZiodmUeTDp...)";

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'test-wallet',
        descriptor: mockDescriptor,
        network: 'mainnet',
      });
    });

    it('should not generate addresses when gap limit is satisfied', async () => {
      // Create 25 receive addresses with last 20 unused (gap = 20)
      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5,
      }));
      // Create 25 change addresses with last 20 unused (gap = 20)
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5,
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        client: mockElectrumClient as any,
      });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBe(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should generate addresses when gap limit is not satisfied', async () => {
      // Only 10 addresses with last 5 unused (gap = 5, need 15 more)
      const addresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5,
      }));

      mockPrismaClient.address.findMany.mockResolvedValue(addresses);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 15 });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBeGreaterThan(0);
      expect(result.stats.newAddressesGenerated).toBeGreaterThan(0);
    });

    it('should skip wallets without descriptor', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'test-wallet',
        descriptor: null,
        network: 'mainnet',
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBe(0);
    });
  });
});
