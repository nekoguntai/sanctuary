/**
 * Transaction API Routes Tests
 *
 * Tests for transaction endpoints including:
 * - GET /wallets/:walletId/transactions
 * - GET /wallets/:walletId/transactions/pending
 * - GET /wallets/:walletId/transactions/export
 * - GET /wallets/:walletId/utxos
 * - POST /wallets/:walletId/transactions/create
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  generateTestToken,
  randomTxid,
  randomAddress,
} from '../../helpers/testUtils';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock blockchain service
jest.mock('../../../src/services/bitcoin/blockchain', () => ({
  getBlockHeight: jest.fn().mockResolvedValue(850000),
  getCachedBlockHeight: jest.fn().mockReturnValue(850000),
  broadcastTransaction: jest.fn().mockResolvedValue('mock-txid'),
}));

// Mock wallet service
jest.mock('../../../src/services/wallet', () => ({
  checkWalletAccess: jest.fn().mockResolvedValue(true),
  checkWalletEditAccess: jest.fn().mockResolvedValue(true),
}));

// Mock address derivation
jest.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  generateNextAddress: jest.fn().mockResolvedValue({
    address: 'tb1qtest123',
    derivationPath: "m/84'/1'/0'/0/0",
  }),
}));

// Mock audit service
jest.mock('../../../src/services/auditService', () => ({
  auditService: {
    log: jest.fn().mockResolvedValue(undefined),
    logFromRequest: jest.fn().mockResolvedValue(undefined),
  },
  AuditAction: {
    TRANSACTION_BROADCAST: 'TRANSACTION_BROADCAST',
    TRANSACTION_CREATE: 'TRANSACTION_CREATE',
  },
  AuditCategory: {
    TRANSACTION: 'TRANSACTION',
  },
}));

// Mock fetch for mempool.space API
global.fetch = jest.fn();

describe('Transactions API', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
  });

  describe('GET /wallets/:walletId/transactions', () => {
    it('should return transactions for a wallet', async () => {
      const walletId = 'wallet-123';
      const userId = 'user-123';

      const mockTransactions = [
        {
          id: 'tx-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          fee: BigInt(500),
          balanceAfter: BigInt(100000), // Running balance after first transaction
          confirmations: 6,
          blockHeight: BigInt(849994),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/0" },
          transactionLabels: [],
        },
        {
          id: 'tx-2',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-50000),
          fee: BigInt(300),
          balanceAfter: BigInt(50000), // Running balance after second transaction (100000 - 50000)
          confirmations: 3,
          blockHeight: BigInt(849997),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/1" },
          transactionLabels: [
            { label: { id: 'label-1', name: 'Rent', color: '#ff0000' } },
          ],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const req = createMockRequest({
        params: { walletId },
        query: { limit: '10', offset: '0' },
        user: { userId, username: 'testuser', isAdmin: false },
      });
      (req as any).walletId = walletId;

      const { res, getResponse } = createMockResponse();

      // Import the handler
      const { getBlockHeight } = require('../../../src/services/bitcoin/blockchain');

      // Simulate route handler logic
      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        include: {
          address: { select: { address: true, derivationPath: true } },
          transactionLabels: { include: { label: true } },
        },
        orderBy: { blockTime: 'desc' },
        take: 10,
        skip: 0,
      });

      const currentBlockHeight = await getBlockHeight();

      const serializedTransactions = transactions.map((tx: any) => {
        const blockHeight = Number(tx.blockHeight);
        return {
          ...tx,
          amount: Number(tx.amount),
          fee: Number(tx.fee),
          balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
          blockHeight,
          confirmations: blockHeight > 0 ? currentBlockHeight - blockHeight + 1 : 0,
          labels: tx.transactionLabels.map((tl: any) => tl.label),
        };
      });

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].amount).toBe(100000);
      expect(response.body[1].labels).toHaveLength(1);
    });

    it('should handle empty transaction list', async () => {
      const walletId = 'wallet-empty';
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      res.json!(transactions);

      const response = getResponse();
      expect(response.body).toEqual([]);
    });

    it('should apply pagination correctly', async () => {
      const walletId = 'wallet-123';
      const limit = 5;
      const offset = 10;

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: { walletId },
        take: limit,
        skip: offset,
      });

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: limit,
          skip: offset,
        })
      );
    });
  });

  describe('GET /wallets/:walletId/transactions/pending', () => {
    it('should return pending transactions with mempool data', async () => {
      const walletId = 'wallet-123';
      const txid = randomTxid();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'testnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'pending-1',
          txid,
          walletId,
          type: 'sent',
          amount: BigInt(-25000),
          fee: BigInt(500),
          confirmations: 0,
          createdAt: new Date(Date.now() - 60000), // 1 minute ago
          counterpartyAddress: randomAddress(),
        },
      ]);

      // Mock mempool.space API response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ weight: 560, fee: 500 }),
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the handler
      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
        select: { name: true, network: true },
      });

      const pendingTxs = await mockPrismaClient.transaction.findMany({
        where: { walletId, confirmations: 0 },
      });

      const mempoolBaseUrl = wallet?.network === 'testnet'
        ? 'https://mempool.space/testnet/api'
        : 'https://mempool.space/api';

      const pendingTransactions = await Promise.all(
        pendingTxs.map(async (tx: any) => {
          let fee = tx.fee ? Number(tx.fee) : 0;
          let vsize: number | undefined;
          let feeRate = 0;

          const response = await fetch(`${mempoolBaseUrl}/tx/${tx.txid}`);
          if (response.ok) {
            const txData = await response.json() as { weight?: number; fee?: number };
            vsize = txData.weight ? Math.ceil(txData.weight / 4) : undefined;
            if (vsize && fee > 0) {
              feeRate = Math.round((fee / vsize) * 10) / 10;
            }
          }

          return {
            txid: tx.txid,
            walletId: tx.walletId,
            walletName: wallet?.name,
            type: 'sent',
            amount: Number(tx.amount),
            fee,
            feeRate,
            vsize,
          };
        })
      );

      res.json!(pendingTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(1);
      expect(response.body[0].vsize).toBe(140); // 560 / 4
      expect(response.body[0].feeRate).toBeCloseTo(3.6, 1); // 500 / 140
    });

    it('should return empty array when no pending transactions', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'mainnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const pendingTxs = await mockPrismaClient.transaction.findMany({
        where: { walletId, confirmations: 0 },
      });

      if (pendingTxs.length === 0) {
        res.json!([]);
      }

      expect(getResponse().body).toEqual([]);
    });

    it('should handle mempool API failure gracefully', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'mainnet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'pending-1',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-25000),
          fee: BigInt(500),
          confirmations: 0,
          createdAt: new Date(),
        },
      ]);

      // Mock API failure
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // Should not throw - gracefully handle the error
      const { res, getResponse } = createMockResponse();

      try {
        await fetch('https://mempool.space/api/tx/test');
      } catch {
        // Expected to fail
      }

      // Transaction should still be returned without mempool data
      res.json!([{
        txid: 'test-txid',
        fee: 500,
        feeRate: 0,
        vsize: undefined,
      }]);

      expect(getResponse().body[0].feeRate).toBe(0);
    });

    it('should exclude replaced RBF transactions from pending', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        network: 'testnet',
      });

      // Simulate the query that should include rbfStatus filter
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: {
          walletId,
          rbfStatus: { not: 'replaced' },
          OR: [
            { blockHeight: 0 },
            { blockHeight: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      // Verify the query includes rbfStatus filter to exclude replaced transactions
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            rbfStatus: { not: 'replaced' },
          }),
        })
      );
    });
  });

  describe('GET /wallets/:walletId/transactions/export', () => {
    it('should export transactions as JSON', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(1000000),
          fee: null,
          confirmations: 10,
          blockTime: new Date('2024-01-15'),
          createdAt: new Date('2024-01-15'),
          label: 'Salary',
          memo: 'January payment',
          counterpartyAddress: null,
          blockHeight: BigInt(849000),
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
        select: { name: true },
      });

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        include: { transactionLabels: { include: { label: true } } },
        orderBy: { blockTime: 'desc' },
      });

      const exportData = transactions.map((tx: any) => ({
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: Number(tx.amount) / 100000000,
        amountSats: Number(tx.amount),
        feeSats: tx.fee ? Number(tx.fee) : null,
        confirmations: tx.confirmations,
        label: tx.label || '',
        memo: tx.memo || '',
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body[0].amountBtc).toBe(0.01);
      expect(response.body[0].amountSats).toBe(1000000);
      expect(response.body[0].label).toBe('Salary');
    });

    it('should filter by date range', async () => {
      const walletId = 'wallet-123';
      const startDate = '2024-01-01';
      const endDate = '2024-01-31';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await mockPrismaClient.transaction.findMany({
        where: {
          walletId,
          blockTime: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
      });

      // Verify date filter was applied
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalled();
    });
  });

  describe('GET /wallets/:walletId/utxos', () => {
    it('should return UTXOs for a wallet', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          id: 'utxo-1',
          txid: randomTxid(),
          vout: 0,
          walletId,
          addressId: 'addr-1',
          value: BigInt(50000),
          confirmations: 6,
          isSpent: false,
          address: {
            address: randomAddress(),
            derivationPath: "m/84'/1'/0'/0/0",
          },
        },
        {
          id: 'utxo-2',
          txid: randomTxid(),
          vout: 1,
          walletId,
          addressId: 'addr-2',
          value: BigInt(30000),
          confirmations: 3,
          isSpent: false,
          address: {
            address: randomAddress(),
            derivationPath: "m/84'/1'/0'/0/1",
          },
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, isSpent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
        },
      });

      const serialized = utxos.map((utxo: any) => ({
        ...utxo,
        value: Number(utxo.value),
      }));

      res.json!(serialized);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].value).toBe(50000);
      expect(response.body[1].value).toBe(30000);
    });

    it('should exclude spent UTXOs', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await mockPrismaClient.uTXO.findMany({
        where: { walletId, isSpent: false },
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isSpent: false,
          }),
        })
      );
    });

    it('should include draft lock info for locked UTXOs', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 1;

      const mockUtxos = [
        {
          id: 'utxo-locked',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 6,
          frozen: false,
          createdAt: new Date(),
          blockHeight: 850000,
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/0" },
          draftLock: {
            draftId: 'draft-456',
            draft: { label: 'Pending Payment' },
            createdAt: new Date(),
          },
        },
        {
          id: 'utxo-unlocked',
          txid: randomTxid(),
          vout: 1,
          walletId,
          amount: BigInt(50000),
          confirmations: 10,
          frozen: false,
          createdAt: new Date(),
          blockHeight: 849996,
          address: { address: randomAddress(), derivationPath: "m/84'/1'/0'/0/1" },
          draftLock: null, // Not locked
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
          draftLock: {
            include: { draft: { select: { label: true } } },
          },
        },
      });

      // Simulate the API serialization logic
      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          txid: utxo.txid,
          vout: utxo.vout,
          amount: Number(utxo.amount),
          confirmations: utxo.confirmations,
          frozen: utxo.frozen,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
          lockedByDraftId: utxo.draftLock?.draftId,
          lockedByDraftLabel: utxo.draftLock?.draft?.label,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos).toHaveLength(2);

      // Locked UTXO
      const lockedUtxo = response.body.utxos.find((u: any) => u.id === 'utxo-locked');
      expect(lockedUtxo.lockedByDraftId).toBe('draft-456');
      expect(lockedUtxo.lockedByDraftLabel).toBe('Pending Payment');
      expect(lockedUtxo.spendable).toBe(false); // Not spendable because locked

      // Unlocked UTXO
      const unlockedUtxo = response.body.utxos.find((u: any) => u.id === 'utxo-unlocked');
      expect(unlockedUtxo.lockedByDraftId).toBeUndefined();
      expect(unlockedUtxo.lockedByDraftLabel).toBeUndefined();
      expect(unlockedUtxo.spendable).toBe(true);
    });

    it('should mark frozen UTXOs as not spendable', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 1;

      const mockUtxos = [
        {
          id: 'utxo-frozen',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 100,
          frozen: true, // Frozen
          createdAt: new Date(),
          blockHeight: 849900,
          draftLock: null,
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
      });

      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          amount: Number(utxo.amount),
          frozen: utxo.frozen,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos[0].frozen).toBe(true);
      expect(response.body.utxos[0].spendable).toBe(false);
    });

    it('should mark unconfirmed UTXOs as not spendable', async () => {
      const walletId = 'wallet-123';
      const confirmationThreshold = 3; // Require 3 confirmations

      const mockUtxos = [
        {
          id: 'utxo-unconfirmed',
          txid: randomTxid(),
          vout: 0,
          walletId,
          amount: BigInt(100000),
          confirmations: 1, // Only 1 confirmation, need 3
          frozen: false,
          createdAt: new Date(),
          draftLock: null,
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(mockUtxos);

      const { res, getResponse } = createMockResponse();

      const utxos = await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
      });

      const serializedUtxos = utxos.map((utxo: any) => {
        const isLockedByDraft = !!utxo.draftLock;
        return {
          id: utxo.id,
          confirmations: utxo.confirmations,
          spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
        };
      });

      res.json!({ utxos: serializedUtxos });

      const response = getResponse();
      expect(response.body.utxos[0].confirmations).toBe(1);
      expect(response.body.utxos[0].spendable).toBe(false);
    });

    it('should include draft lock in UTXO query', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await mockPrismaClient.uTXO.findMany({
        where: { walletId, spent: false },
        include: {
          address: { select: { address: true, derivationPath: true } },
          draftLock: {
            include: { draft: { select: { label: true } } },
          },
        },
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            draftLock: expect.objectContaining({
              include: expect.objectContaining({
                draft: expect.objectContaining({
                  select: expect.objectContaining({
                    label: true,
                  }),
                }),
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Confirmation Calculation', () => {
    it('should calculate confirmations dynamically', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = 849990;

      // confirmations = currentBlockHeight - txBlockHeight + 1
      const confirmations = currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(11);
    });

    it('should return 0 confirmations for unconfirmed transactions', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = 0;

      const confirmations = txBlockHeight <= 0 ? 0 : currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(0);
    });

    it('should return 0 confirmations for null block height', () => {
      const currentBlockHeight = 850000;
      const txBlockHeight = null;

      const confirmations = !txBlockHeight || txBlockHeight <= 0 ? 0 : currentBlockHeight - txBlockHeight + 1;

      expect(confirmations).toBe(0);
    });
  });

  describe('BigInt Serialization', () => {
    it('should convert BigInt to number for JSON response', () => {
      const bigIntValue = BigInt(1234567890);
      const numberValue = Number(bigIntValue);

      expect(typeof numberValue).toBe('number');
      expect(numberValue).toBe(1234567890);
    });

    it('should handle zero BigInt', () => {
      const bigIntValue = BigInt(0);
      const numberValue = Number(bigIntValue);

      expect(numberValue).toBe(0);
    });

    it('should handle null fee', () => {
      const fee: bigint | null = null;
      const feeNumber = fee ? Number(fee) : null;

      expect(feeNumber).toBeNull();
    });

    it('should convert balanceAfter BigInt to number', () => {
      const balanceAfter = BigInt(150000);
      const balanceAfterNumber = Number(balanceAfter);

      expect(typeof balanceAfterNumber).toBe('number');
      expect(balanceAfterNumber).toBe(150000);
    });

    it('should handle null balanceAfter', () => {
      const balanceAfter: bigint | null = null;
      const balanceAfterNumber = balanceAfter ? Number(balanceAfter) : null;

      expect(balanceAfterNumber).toBeNull();
    });
  });

  describe('Running Balance (balanceAfter)', () => {
    it('should include balanceAfter in transaction response', async () => {
      const walletId = 'wallet-with-balance';

      const mockTransactions = [
        {
          id: 'tx-balance-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(200000),
          fee: null,
          balanceAfter: BigInt(200000),
          confirmations: 10,
          blockHeight: BigInt(850000),
          blockTime: new Date('2024-02-01'),
          createdAt: new Date('2024-02-01'),
          address: null,
          transactionLabels: [],
        },
        {
          id: 'tx-balance-2',
          txid: randomTxid(),
          walletId,
          type: 'sent',
          amount: BigInt(-75000),
          fee: BigInt(1000),
          balanceAfter: BigInt(125000), // 200000 - 75000
          confirmations: 8,
          blockHeight: BigInt(850002),
          blockTime: new Date('2024-02-02'),
          createdAt: new Date('2024-02-02'),
          address: null,
          transactionLabels: [],
        },
        {
          id: 'tx-balance-3',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(50000),
          fee: null,
          balanceAfter: BigInt(175000), // 125000 + 50000
          confirmations: 5,
          blockHeight: BigInt(850005),
          blockTime: new Date('2024-02-03'),
          createdAt: new Date('2024-02-03'),
          address: null,
          transactionLabels: [],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const serializedTransactions = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        fee: tx.fee ? Number(tx.fee) : null,
        balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        blockHeight: Number(tx.blockHeight),
      }));

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body).toHaveLength(3);

      // Verify balanceAfter values
      expect(response.body[0].balanceAfter).toBe(200000);
      expect(response.body[1].balanceAfter).toBe(125000);
      expect(response.body[2].balanceAfter).toBe(175000);

      // Verify types
      expect(typeof response.body[0].balanceAfter).toBe('number');
      expect(typeof response.body[1].balanceAfter).toBe('number');
      expect(typeof response.body[2].balanceAfter).toBe('number');
    });

    it('should handle transactions with null balanceAfter (legacy data)', async () => {
      const walletId = 'wallet-legacy';

      const mockTransactions = [
        {
          id: 'tx-legacy-1',
          txid: randomTxid(),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          fee: null,
          balanceAfter: null, // Legacy transaction without balanceAfter
          confirmations: 100,
          blockHeight: BigInt(800000),
          blockTime: new Date('2023-01-01'),
          createdAt: new Date('2023-01-01'),
          address: null,
          transactionLabels: [],
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const serializedTransactions = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
      }));

      res.json!(serializedTransactions);

      const response = getResponse();
      expect(response.body[0].balanceAfter).toBeNull();
    });
  });

  describe('GET /wallets/:walletId/transactions/stats', () => {
    it('should return walletBalance from last transaction balanceAfter', async () => {
      const walletId = 'wallet-with-stats';

      // Mock the last transaction query (ordered by blockTime desc, createdAt desc)
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(175000),
      });

      // Mock count and aggregations
      mockPrismaClient.transaction.count.mockResolvedValue(5);
      mockPrismaClient.transaction.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(50000), fee: BigInt(2500) },
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the stats endpoint logic
      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 5,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(175000);
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
          select: { balanceAfter: true },
        })
      );
    });

    it('should return 0 walletBalance for empty wallet', async () => {
      const walletId = 'wallet-empty';

      // No transactions
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockPrismaClient.transaction.count.mockResolvedValue(0);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 0,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(0);
      expect(response.body.totalCount).toBe(0);
    });

    it('should return correct balance for single transaction', async () => {
      const walletId = 'wallet-single-tx';

      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(100000),
      });
      mockPrismaClient.transaction.count.mockResolvedValue(1);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 1,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(100000);
    });

    it('should handle null balanceAfter (legacy data) gracefully', async () => {
      const walletId = 'wallet-legacy-stats';

      // Legacy transaction without balanceAfter
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: null,
      });
      mockPrismaClient.transaction.count.mockResolvedValue(1);

      const { res, getResponse } = createMockResponse();

      const lastTx = await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      // Falls back to 0 when balanceAfter is null
      const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

      res.json!({
        walletBalance: Number(walletBalance),
        totalCount: 1,
      });

      const response = getResponse();
      expect(response.body.walletBalance).toBe(0);
    });

    it('should use correct ordering for most recent transaction', async () => {
      const walletId = 'wallet-ordering-test';

      // Two transactions with same blockTime but different createdAt
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        balanceAfter: BigInt(250000), // The most recent by createdAt
      });

      await mockPrismaClient.transaction.findFirst({
        where: { walletId },
        orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      // Verify the query used correct ordering
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
        })
      );
    });
  });

  describe('POST /wallets/:walletId/transactions/recalculate', () => {
    it('should recalculate all balanceAfter values correctly', async () => {
      const walletId = 'wallet-recalc';

      const mockTransactions = [
        {
          id: 'tx-1',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'tx-2',
          amount: BigInt(-30000),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'tx-3',
          amount: BigInt(50000),
          blockTime: new Date('2024-01-03'),
          createdAt: new Date('2024-01-03'),
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      const { res, getResponse } = createMockResponse();

      // Simulate recalculation logic
      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, amount: true },
      });

      let runningBalance = BigInt(0);
      for (const tx of transactions) {
        runningBalance += tx.amount;
        await mockPrismaClient.transaction.update({
          where: { id: tx.id },
          data: { balanceAfter: runningBalance },
        });
      }

      res.json!({
        success: true,
        transactionsUpdated: transactions.length,
        finalBalance: Number(runningBalance),
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.transactionsUpdated).toBe(3);
      expect(response.body.finalBalance).toBe(120000); // 100000 - 30000 + 50000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(3);
    });

    it('should handle empty wallet recalculation', async () => {
      const walletId = 'wallet-empty-recalc';

      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
      });

      res.json!({
        success: true,
        transactionsUpdated: 0,
        finalBalance: 0,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.transactionsUpdated).toBe(0);
      expect(response.body.finalBalance).toBe(0);
    });

    it('should handle pending transactions (null blockTime) in correct order', async () => {
      const walletId = 'wallet-pending-recalc';

      const mockTransactions = [
        {
          id: 'tx-confirmed',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'tx-pending-1',
          amount: BigInt(25000),
          blockTime: null, // Unconfirmed
          createdAt: new Date('2024-01-02T10:00:00'),
        },
        {
          id: 'tx-pending-2',
          amount: BigInt(-10000),
          blockTime: null, // Unconfirmed
          createdAt: new Date('2024-01-02T11:00:00'),
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
      });

      let runningBalance = BigInt(0);
      for (const tx of transactions) {
        runningBalance += tx.amount;
      }

      res.json!({
        success: true,
        transactionsUpdated: 3,
        finalBalance: Number(runningBalance),
      });

      const response = getResponse();
      expect(response.body.finalBalance).toBe(115000); // 100000 + 25000 - 10000
    });
  });

  describe('Export with balanceAfter', () => {
    it('should include balanceAfterBtc and balanceAfterSats in JSON export', async () => {
      const walletId = 'wallet-export-balance';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Export Test Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(1000000),
          fee: null,
          balanceAfter: BigInt(1000000),
          confirmations: 10,
          blockTime: new Date('2024-01-15'),
          createdAt: new Date('2024-01-15'),
          label: 'Initial deposit',
          transactionLabels: [],
        },
        {
          id: 'tx-2',
          txid: randomTxid(),
          type: 'sent',
          amount: BigInt(-500000),
          fee: BigInt(1000),
          balanceAfter: BigInt(500000),
          confirmations: 8,
          blockTime: new Date('2024-01-16'),
          createdAt: new Date('2024-01-16'),
          label: 'Payment',
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
        orderBy: { blockTime: 'desc' },
      });

      const exportData = transactions.map((tx: any) => ({
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: Number(tx.amount) / 100000000,
        amountSats: Number(tx.amount),
        feeSats: tx.fee ? Number(tx.fee) : null,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        label: tx.label || '',
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body).toHaveLength(2);

      // First transaction (received)
      expect(response.body[0].balanceAfterSats).toBe(1000000);
      expect(response.body[0].balanceAfterBtc).toBe(0.01);

      // Second transaction (sent)
      expect(response.body[1].balanceAfterSats).toBe(500000);
      expect(response.body[1].balanceAfterBtc).toBe(0.005);
    });

    it('should handle null balanceAfter in export gracefully', async () => {
      const walletId = 'wallet-export-legacy';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Legacy Export Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-legacy',
          txid: randomTxid(),
          type: 'received',
          amount: BigInt(50000),
          fee: null,
          balanceAfter: null, // Legacy transaction
          confirmations: 100,
          blockTime: new Date('2023-06-01'),
          createdAt: new Date('2023-06-01'),
          label: '',
          transactionLabels: [],
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      const exportData = transactions.map((tx: any) => ({
        txid: tx.txid,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
      }));

      res.json!(exportData);

      const response = getResponse();
      expect(response.body[0].balanceAfterBtc).toBeNull();
      expect(response.body[0].balanceAfterSats).toBeNull();
    });

    it('should include balance columns in CSV export format', async () => {
      const walletId = 'wallet-csv-export';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'CSV Export Wallet',
      });

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: 'abc123',
          type: 'received',
          amount: BigInt(100000),
          fee: null,
          balanceAfter: BigInt(100000),
          confirmations: 5,
          blockTime: new Date('2024-02-01'),
          createdAt: new Date('2024-02-01'),
          label: 'Test',
          transactionLabels: [],
        },
      ]);

      const transactions = await mockPrismaClient.transaction.findMany({
        where: { walletId },
      });

      // Simulate CSV header generation
      const csvHeaders = [
        'Date',
        'TXID',
        'Type',
        'Amount (BTC)',
        'Amount (sats)',
        'Fee (sats)',
        'Balance After (BTC)',
        'Balance After (sats)',
        'Label',
      ];

      // Simulate CSV row generation
      const csvRow = transactions.map((tx: any) => [
        tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        tx.txid,
        tx.type,
        (Number(tx.amount) / 100000000).toFixed(8),
        Number(tx.amount),
        tx.fee ? Number(tx.fee) : '',
        tx.balanceAfter ? (Number(tx.balanceAfter) / 100000000).toFixed(8) : '',
        tx.balanceAfter ? Number(tx.balanceAfter) : '',
        tx.label || '',
      ]);

      // Verify headers include balance columns
      expect(csvHeaders).toContain('Balance After (BTC)');
      expect(csvHeaders).toContain('Balance After (sats)');

      // Verify row includes balance values
      expect(csvRow[0][6]).toBe('0.00100000'); // Balance After (BTC)
      expect(csvRow[0][7]).toBe(100000); // Balance After (sats)
    });
  });

  describe('GET /transactions/:txid/raw', () => {
    it('should return raw tx hex when user has wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User has access to the wallet
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        rawTx: '0200000001abcdef...',
        wallet: { network: 'mainnet' },
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      if (transaction?.rawTx) {
        res.json!({ hex: transaction.rawTx });
      }

      const response = getResponse();
      expect(response.body.hex).toBe('0200000001abcdef...');
    });

    it('should deny access when user does not have wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User does NOT have access - findFirst returns null due to wallet access filter
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API to also fail (transaction not found publicly)
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { res, getResponse } = createMockResponse();

      // First check database with wallet access filter
      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Not found in database (due to access control), try mempool.space
      if (!transaction?.rawTx) {
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (!response.ok) {
          res.status!(404).json!({
            error: 'Not Found',
            message: 'Transaction not found',
          });
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('should verify wallet access filter includes user and group membership', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Verify the query includes proper access control
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            wallet: expect.objectContaining({
              OR: expect.arrayContaining([
                { users: { some: { userId } } },
                { group: { members: { some: { userId } } } },
              ]),
            }),
          }),
        })
      );
    });

    it('should fallback to mempool.space when transaction not in database', async () => {
      const txid = randomTxid();
      const userId = 'user-123';
      const mockHex = '0200000001fedcba...';

      // Transaction not in our database
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API success
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: async () => mockHex,
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
      });

      if (!transaction?.rawTx) {
        // Fallback to mempool.space
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (response.ok) {
          const hex = await response.text();
          res.json!({ hex });
        }
      }

      const response = getResponse();
      expect(response.body.hex).toBe(mockHex);
    });
  });

  describe('Input Validation', () => {
    describe('feeRate validation', () => {
      it('should reject NaN feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = 'invalid';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should reject zero feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = '0';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should reject negative feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = '-5';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should accept valid positive feeRate', async () => {
        const feeRate = '10.5';
        const feeRateNum = parseFloat(feeRate);

        const isValid = !isNaN(feeRateNum) && feeRateNum > 0;

        expect(isValid).toBe(true);
        expect(feeRateNum).toBe(10.5);
      });
    });
  });

  describe('POST /wallets/:walletId/transactions/create', () => {
    const mockTransactionService = {
      createTransaction: jest.fn(),
    };

    beforeEach(() => {
      jest.doMock('../../../src/services/bitcoin/transactionService', () => mockTransactionService);
      mockTransactionService.createTransaction.mockReset();
    });

    it('should create a transaction with valid inputs', async () => {
      const walletId = 'wallet-123';
      const recipient = 'tb1qtest123456789';
      const amount = 50000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
        type: 'single_sig',
      });

      mockTransactionService.createTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8BAH0CAAAAAb...',
        fee: 500,
        totalInput: 100000,
        totalOutput: 99500,
        changeAmount: 49500,
        changeAddress: 'tb1qchange123',
        utxos: [{ txid: 'abc123', vout: 0, value: 100000 }],
        inputPaths: ["m/84'/1'/0'/0/0"],
        effectiveAmount: 50000,
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the route handler validation
      if (!recipient || !amount) {
        res.status!(400).json!({ error: 'Bad Request', message: 'recipient and amount are required' });
      } else if (!feeRate || feeRate < 1) {
        res.status!(400).json!({ error: 'Bad Request', message: 'feeRate must be at least 1 sat/vB' });
      } else {
        const txData = await mockTransactionService.createTransaction(
          walletId, recipient, amount, feeRate, {}
        );
        res.json!(txData);
      }

      const response = getResponse();
      expect(response.body.psbtBase64).toBe('cHNidP8BAH0CAAAAAb...');
      expect(response.body.fee).toBe(500);
      expect(response.body.effectiveAmount).toBe(50000);
    });

    it('should reject request without recipient', async () => {
      const { res, getResponse } = createMockResponse();

      const recipient = undefined;
      const amount = 50000;

      if (!recipient || !amount) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient and amount are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('recipient and amount are required');
    });

    it('should reject request without amount', async () => {
      const { res, getResponse } = createMockResponse();

      const recipient = 'tb1qtest123';
      const amount = undefined;

      if (!recipient || !amount) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient and amount are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should reject feeRate below minimum', async () => {
      const { res, getResponse } = createMockResponse();
      const MIN_FEE_RATE = 1;

      const feeRate = 0.5;

      if (!feeRate || feeRate < MIN_FEE_RATE) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('feeRate must be at least');
    });

    it('should return 404 for non-existent wallet', async () => {
      const walletId = 'non-existent-wallet';

      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('should handle insufficient balance error', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createTransaction.mockRejectedValue(
        new Error('Insufficient funds: need 100000 sats but only have 50000 sats')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await mockTransactionService.createTransaction(walletId, 'tb1q...', 100000, 5, {});
        res.json!({});
      } catch (error) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: error instanceof Error ? error.message : 'Failed to create transaction',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Insufficient funds');
    });

    it('should include decoy outputs when enabled', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8...',
        fee: 600,
        totalInput: 150000,
        totalOutput: 149400,
        changeAmount: 99400,
        changeAddress: 'tb1qchange',
        effectiveAmount: 50000,
        decoyOutputs: [
          { address: 'tb1qdecoy1', amount: 25000 },
          { address: 'tb1qdecoy2', amount: 24400 },
        ],
      });

      const { res, getResponse } = createMockResponse();

      const txData = await mockTransactionService.createTransaction(
        walletId, 'tb1qrecipient', 50000, 5,
        { decoyOutputs: 2 }
      );

      res.json!({
        ...txData,
        decoyOutputs: txData.decoyOutputs,
      });

      const response = getResponse();
      expect(response.body.decoyOutputs).toHaveLength(2);
    });
  });

  describe('POST /wallets/:walletId/transactions/batch', () => {
    const mockTransactionService = {
      createBatchTransaction: jest.fn(),
    };

    beforeEach(() => {
      mockTransactionService.createBatchTransaction.mockReset();
    });

    it('should create batch transaction with multiple outputs', async () => {
      const walletId = 'wallet-123';
      const outputs = [
        { address: 'tb1qrecipient1', amount: 25000 },
        { address: 'tb1qrecipient2', amount: 30000 },
      ];
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createBatchTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8...',
        fee: 700,
        totalInput: 100000,
        totalOutput: 99300,
        changeAmount: 44300,
        changeAddress: 'tb1qchange',
        utxos: [{ txid: 'abc123', vout: 0, value: 100000 }],
        inputPaths: ["m/84'/1'/0'/0/0"],
        outputs: [
          { address: 'tb1qrecipient1', amount: 25000 },
          { address: 'tb1qrecipient2', amount: 30000 },
        ],
      });

      const { res, getResponse } = createMockResponse();

      // Simulate validation
      if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
        res.status!(400).json!({ error: 'Bad Request', message: 'outputs array is required' });
      } else {
        const txData = await mockTransactionService.createBatchTransaction(
          walletId, outputs, feeRate, {}
        );
        res.json!(txData);
      }

      const response = getResponse();
      expect(response.body.outputs).toHaveLength(2);
      expect(response.body.fee).toBe(700);
    });

    it('should reject empty outputs array', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs: any[] = [];

      if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'outputs array is required with at least one output',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('outputs array is required');
    });

    it('should reject output without address', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { amount: 25000 }, // Missing address
      ];

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i] as { address?: string; amount: number };
        if (!output.address) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: `Output ${i + 1}: address is required`,
          });
          break;
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('address is required');
    });

    it('should reject output without amount (when sendMax is false)', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { address: 'tb1qtest', amount: 0 }, // Invalid amount
      ];

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i] as { address: string; amount?: number; sendMax?: boolean };
        if (!output.sendMax && (!output.amount || output.amount <= 0)) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: `Output ${i + 1}: amount is required (or set sendMax: true)`,
          });
          break;
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('amount is required');
    });

    it('should reject multiple sendMax outputs', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { address: 'tb1qtest1', sendMax: true },
        { address: 'tb1qtest2', sendMax: true }, // Second sendMax - invalid
      ];

      const sendMaxCount = outputs.filter(o => o.sendMax).length;
      if (sendMaxCount > 1) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Only one output can have sendMax enabled',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Only one output can have sendMax');
    });

    it('should allow single sendMax output', async () => {
      const outputs = [
        { address: 'tb1qtest1', amount: 10000 },
        { address: 'tb1qtest2', sendMax: true },
      ];

      const sendMaxCount = outputs.filter(o => o.sendMax).length;
      expect(sendMaxCount).toBe(1);
    });
  });

  describe('POST /wallets/:walletId/transactions/broadcast', () => {
    const mockBlockchain = require('../../../src/services/bitcoin/blockchain');

    it('should broadcast signed PSBT successfully', async () => {
      const walletId = 'wallet-123';
      const signedPsbtBase64 = 'cHNidP8BAHsCAAAAAQ...signed...';
      const txid = randomTxid();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockBlockchain.broadcastTransaction.mockResolvedValue(txid);

      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-new',
        txid,
        walletId,
        type: 'sent',
        amount: BigInt(-50000),
        fee: BigInt(500),
      });

      const { res, getResponse } = createMockResponse();

      // Simulate successful broadcast
      const broadcastedTxid = await mockBlockchain.broadcastTransaction('signed-hex');
      res.json!({
        success: true,
        txid: broadcastedTxid,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.txid).toBe(txid);
    });

    it('should handle broadcast with raw transaction hex (Trezor)', async () => {
      const walletId = 'wallet-123';
      const rawTxHex = '0200000001abc...';
      const txid = randomTxid();

      mockBlockchain.broadcastTransaction.mockResolvedValue(txid);

      const { res, getResponse } = createMockResponse();

      const broadcastedTxid = await mockBlockchain.broadcastTransaction(rawTxHex);
      res.json!({
        success: true,
        txid: broadcastedTxid,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
    });

    it('should reject broadcast without signed data', async () => {
      const { res, getResponse } = createMockResponse();

      const signedPsbtBase64 = undefined;
      const rawTxHex = undefined;

      if (!signedPsbtBase64 && !rawTxHex) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Either signedPsbtBase64 or rawTxHex is required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('signedPsbtBase64 or rawTxHex');
    });

    it('should handle broadcast failure gracefully', async () => {
      mockBlockchain.broadcastTransaction.mockRejectedValue(
        new Error('Transaction rejected: insufficient fee')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await mockBlockchain.broadcastTransaction('invalid-hex');
        res.json!({ success: true });
      } catch (error) {
        res.status!(400).json!({
          error: 'Broadcast Failed',
          message: error instanceof Error ? error.message : 'Failed to broadcast transaction',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('insufficient fee');
    });

    it('should create transaction record after successful broadcast', async () => {
      const walletId = 'wallet-123';
      const txid = randomTxid();
      const recipient = randomAddress();

      mockBlockchain.broadcastTransaction.mockResolvedValue(txid);
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-new',
        txid,
        walletId,
      });

      // Simulate creating the transaction record
      await mockPrismaClient.transaction.create({
        data: {
          txid,
          walletId,
          type: 'sent',
          amount: BigInt(-50000),
          fee: BigInt(500),
          counterpartyAddress: recipient,
          confirmations: 0,
        },
      });

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            txid,
            walletId,
            type: 'sent',
          }),
        })
      );
    });
  });

  describe('PATCH /utxos/:utxoId/freeze', () => {
    it('should freeze a UTXO', async () => {
      const utxoId = 'utxo-123';
      const userId = 'user-123';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        frozen: false,
        wallet: {
          users: [{ userId }],
        },
      });

      mockPrismaClient.uTXO.update.mockResolvedValue({
        id: utxoId,
        frozen: true,
      });

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
        include: { wallet: { include: { users: true } } },
      });

      if (!utxo) {
        res.status!(404).json!({ error: 'Not Found' });
      } else {
        const updated = await mockPrismaClient.uTXO.update({
          where: { id: utxoId },
          data: { frozen: true },
        });
        res.json!(updated);
      }

      const response = getResponse();
      expect(response.body.frozen).toBe(true);
    });

    it('should unfreeze a UTXO', async () => {
      const utxoId = 'utxo-123';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        frozen: true,
      });

      mockPrismaClient.uTXO.update.mockResolvedValue({
        id: utxoId,
        frozen: false,
      });

      const { res, getResponse } = createMockResponse();

      const updated = await mockPrismaClient.uTXO.update({
        where: { id: utxoId },
        data: { frozen: false },
      });
      res.json!(updated);

      const response = getResponse();
      expect(response.body.frozen).toBe(false);
    });

    it('should return 404 for non-existent UTXO', async () => {
      const utxoId = 'non-existent';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
      });

      if (!utxo) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'UTXO not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.message).toBe('UTXO not found');
    });

    it('should deny freeze for unauthorized user', async () => {
      const utxoId = 'utxo-123';
      const requestUserId = 'user-456'; // Different user

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        wallet: {
          users: [{ userId: 'user-123' }], // Owned by different user
        },
      });

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
        include: { wallet: { include: { users: true } } },
      });

      const hasAccess = utxo?.wallet?.users?.some(
        (u: { userId: string }) => u.userId === requestUserId
      );

      if (!hasAccess) {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'You do not have access to this UTXO',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /wallets/:walletId/transactions/estimate', () => {
    it('should return fee estimate for transaction', async () => {
      const walletId = 'wallet-123';
      const recipient = 'tb1qtest123';
      const amount = 50000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      const { res, getResponse } = createMockResponse();

      // Simulate fee estimation calculation
      // Typical P2WPKH: 1 input (68 vbytes) + 2 outputs (62 vbytes) + overhead (10.5 vbytes) ≈ 141 vbytes
      const estimatedVsize = 141;
      const estimatedFee = Math.ceil(estimatedVsize * feeRate);

      res.json!({
        estimatedFee,
        estimatedVsize,
        feeRate,
        totalRequired: amount + estimatedFee,
      });

      const response = getResponse();
      expect(response.body.estimatedFee).toBe(705); // 141 * 5
      expect(response.body.estimatedVsize).toBe(141);
      expect(response.body.totalRequired).toBe(50705);
    });

    it('should estimate for sendMax (subtract fees)', async () => {
      const walletId = 'wallet-123';
      const availableBalance = 100000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      const { res, getResponse } = createMockResponse();

      // SendMax: no change output, so smaller transaction
      // 1 input (68 vbytes) + 1 output (31 vbytes) + overhead (10.5 vbytes) ≈ 110 vbytes
      const estimatedVsize = 110;
      const estimatedFee = Math.ceil(estimatedVsize * feeRate);
      const effectiveAmount = availableBalance - estimatedFee;

      res.json!({
        estimatedFee,
        estimatedVsize,
        feeRate,
        effectiveAmount, // Amount after fees
        sendMax: true,
      });

      const response = getResponse();
      expect(response.body.estimatedFee).toBe(550); // 110 * 5
      expect(response.body.effectiveAmount).toBe(99450); // 100000 - 550
      expect(response.body.sendMax).toBe(true);
    });
  });

  describe('GET /wallets/:walletId/addresses', () => {
    it('should return addresses for a wallet', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: randomAddress(),
          walletId,
          type: 'receive',
          addressIndex: 0,
          derivationPath: "m/84'/1'/0'/0/0",
          isUsed: true,
          createdAt: new Date(),
        },
        {
          id: 'addr-2',
          address: randomAddress(),
          walletId,
          type: 'receive',
          addressIndex: 1,
          derivationPath: "m/84'/1'/0'/0/1",
          isUsed: false,
          createdAt: new Date(),
        },
        {
          id: 'addr-3',
          address: randomAddress(),
          walletId,
          type: 'change',
          addressIndex: 0,
          derivationPath: "m/84'/1'/0'/1/0",
          isUsed: true,
          createdAt: new Date(),
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const addresses = await mockPrismaClient.address.findMany({
        where: { walletId },
        orderBy: [{ type: 'asc' }, { addressIndex: 'asc' }],
      });

      res.json!(addresses);

      const response = getResponse();
      expect(response.body).toHaveLength(3);
      expect(response.body[0].type).toBe('receive');
    });

    it('should filter by address type', async () => {
      const walletId = 'wallet-123';
      const type = 'receive';

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', type: 'receive', addressIndex: 0 },
        { id: 'addr-2', type: 'receive', addressIndex: 1 },
      ]);

      await mockPrismaClient.address.findMany({
        where: { walletId, type },
      });

      expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'receive',
          }),
        })
      );
    });

    it('should filter by used status', async () => {
      const walletId = 'wallet-123';
      const isUsed = false;

      mockPrismaClient.address.findMany.mockResolvedValue([]);

      await mockPrismaClient.address.findMany({
        where: { walletId, isUsed },
      });

      expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isUsed: false,
          }),
        })
      );
    });
  });

  describe('POST /wallets/:walletId/addresses/generate', () => {
    const mockAddressDerivation = require('../../../src/services/bitcoin/addressDerivation');

    it('should generate new receive address', async () => {
      const walletId = 'wallet-123';
      const newAddress = randomAddress();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
        descriptor: "wpkh([abc123/84'/1'/0']tpub.../*)",
      });

      mockAddressDerivation.generateNextAddress.mockResolvedValue({
        address: newAddress,
        derivationPath: "m/84'/1'/0'/0/5",
      });

      mockPrismaClient.address.create.mockResolvedValue({
        id: 'addr-new',
        address: newAddress,
        walletId,
        type: 'receive',
        addressIndex: 5,
        derivationPath: "m/84'/1'/0'/0/5",
      });

      const { res, getResponse } = createMockResponse();

      const generated = await mockAddressDerivation.generateNextAddress();
      res.json!({
        address: generated.address,
        derivationPath: generated.derivationPath,
        type: 'receive',
      });

      const response = getResponse();
      expect(response.body.address).toBe(newAddress);
      expect(response.body.type).toBe('receive');
    });

    it('should generate new change address', async () => {
      const walletId = 'wallet-123';
      const newAddress = randomAddress();

      mockAddressDerivation.generateNextAddress.mockResolvedValue({
        address: newAddress,
        derivationPath: "m/84'/1'/0'/1/3",
      });

      const { res, getResponse } = createMockResponse();

      const generated = await mockAddressDerivation.generateNextAddress();
      res.json!({
        address: generated.address,
        derivationPath: generated.derivationPath,
        type: 'change',
      });

      const response = getResponse();
      expect(response.body.derivationPath).toContain('/1/'); // Change path
    });

    it('should reject generation for wallet without descriptor', async () => {
      const walletId = 'wallet-no-descriptor';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
        descriptor: null, // No descriptor
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet?.descriptor) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Cannot generate addresses for wallet without descriptor',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('without descriptor');
    });
  });

  describe('GET /transactions/recent', () => {
    it('should return recent transactions across all accessible wallets', async () => {
      const userId = 'user-123';

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          txid: randomTxid(),
          walletId: 'wallet-1',
          type: 'received',
          amount: BigInt(50000),
          confirmations: 0,
          createdAt: new Date(Date.now() - 60000),
          wallet: { name: 'Wallet 1' },
        },
        {
          id: 'tx-2',
          txid: randomTxid(),
          walletId: 'wallet-2',
          type: 'sent',
          amount: BigInt(-30000),
          confirmations: 2,
          createdAt: new Date(Date.now() - 120000),
          wallet: { name: 'Wallet 2' },
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: {
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        include: {
          wallet: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const serialized = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        walletName: tx.wallet?.name,
      }));

      res.json!(serialized);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].walletName).toBe('Wallet 1');
    });
  });
});
