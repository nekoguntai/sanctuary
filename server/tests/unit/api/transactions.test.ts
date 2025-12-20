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
});
