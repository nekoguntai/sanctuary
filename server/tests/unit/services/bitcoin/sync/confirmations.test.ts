import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';

const {
  mockWalletLog,
  mockGetConfig,
  mockGetNodeClient,
  mockGetBlockHeight,
  mockGetBlockTimestamp,
  mockRecalculateWalletBalances,
} = vi.hoisted(() => ({
  mockWalletLog: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetNodeClient: vi.fn(),
  mockGetBlockHeight: vi.fn(),
  mockGetBlockTimestamp: vi.fn(),
  mockRecalculateWalletBalances: vi.fn(),
}));

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
}));

vi.mock('../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockHeight: mockGetBlockHeight,
  getBlockTimestamp: mockGetBlockTimestamp,
}));

vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: mockWalletLog,
}));

vi.mock('../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: mockRecalculateWalletBalances,
}));

import {
  populateMissingTransactionFields,
  updateTransactionConfirmations,
} from '../../../../../src/services/bitcoin/sync/confirmations';

describe('confirmations service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockGetConfig.mockReturnValue({
      sync: { transactionBatchSize: 2 },
    });
    mockGetBlockHeight.mockResolvedValue(1000);
    mockGetBlockTimestamp.mockResolvedValue(new Date('2024-01-01T00:00:00.000Z'));
  });

  describe('updateTransactionConfirmations', () => {
    it('returns empty when wallet does not exist', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const result = await updateTransactionConfirmations('wallet-1');

      expect(result).toEqual([]);
      expect(mockPrismaClient.systemSetting.findUnique).not.toHaveBeenCalled();
    });

    it('returns empty when no transactions are eligible', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const result = await updateTransactionConfirmations('wallet-1');

      expect(result).toEqual([]);
      expect(mockGetBlockHeight).not.toHaveBeenCalled();
    });

    it('updates in chunks and marks newly confirmed tx as confirmed for RBF status', async () => {
      mockGetConfig.mockReturnValue({
        sync: { transactionBatchSize: 1 },
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { id: 't1', txid: 'tx-1', blockHeight: 1000, confirmations: 0 },
        { id: 't2', txid: 'tx-2', blockHeight: 999, confirmations: 2 },
        { id: 't3', txid: 'tx-3', blockHeight: 998, confirmations: 0 },
      ]);
      mockGetBlockHeight.mockResolvedValue(1000);

      const updates = await updateTransactionConfirmations('wallet-1');

      expect(updates).toEqual([
        { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
        { txid: 'tx-3', oldConfirmations: 0, newConfirmations: 3 },
      ]);
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { confirmations: 1, rbfStatus: 'confirmed' },
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't3' },
        data: { confirmations: 3, rbfStatus: 'confirmed' },
      });
      expect(mockWalletLog).toHaveBeenCalledWith(
        'wallet-1',
        'debug',
        'DB',
        expect.stringContaining('Processing batch')
      );
    });

    it('uses network fallback and skips zero-height/unchanged transactions without writes', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: '' });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { id: 't-zero', txid: 'tx-zero', blockHeight: 0, confirmations: 0 },
        { id: 't-same', txid: 'tx-same', blockHeight: 1000, confirmations: 1 },
      ]);
      mockGetBlockHeight.mockResolvedValue(1000);

      const updates = await updateTransactionConfirmations('wallet-1');

      expect(updates).toEqual([]);
      expect(mockGetBlockHeight).toHaveBeenCalledWith('mainnet');
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });

    it('updates confirmations without setting rbfStatus when tx was already confirmed', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { id: 't-already-confirmed', txid: 'tx-already-confirmed', blockHeight: 999, confirmations: 1 },
      ]);
      mockGetBlockHeight.mockResolvedValue(1000);

      const updates = await updateTransactionConfirmations('wallet-1');

      expect(updates).toEqual([
        { txid: 'tx-already-confirmed', oldConfirmations: 1, newConfirmations: 2 },
      ]);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-already-confirmed' },
        data: { confirmations: 2 },
      });
    });
  });

  describe('populateMissingTransactionFields', () => {
    it('returns empty result when wallet does not exist', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
      expect(mockGetNodeClient).not.toHaveBeenCalled();
    });

    it('returns early when no incomplete transactions are found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue({
        getAddressHistory: vi.fn(),
        getTransaction: vi.fn(),
      });
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
      expect(mockWalletLog).toHaveBeenCalledWith(
        'wallet-1',
        'info',
        'POPULATE',
        'All transaction fields are complete'
      );
    });

    it('populates block/fee/address fields, uses history + prev tx cache, and recalculates balances when amount changes', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async (address: string) => {
          if (address === 'wallet-addr') {
            return [{ tx_hash: 'tx-recv-nodetails', height: 995 }];
          }
          return [];
        }),
        getTransaction: vi.fn(async (txid: string) => {
          const txMap: Record<string, unknown> = {
            'tx-sent': {
              confirmations: 2,
              vin: [{ txid: 'prev-fee', vout: 0 }],
              vout: [
                { value: 0.0009, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } },
                { value: 0.00005, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } },
              ],
            },
            'tx-recv-nodetails': null,
            'tx-recv-detailed': {
              time: 1700000000,
              vin: [
                {
                  prevout: {
                    value: 0.0004,
                    scriptPubKey: { address: 'sender-addr', addresses: ['sender-addr'] },
                  },
                },
              ],
              vout: [{ value: 0.0003, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'tx-consolidate': {
              blockheight: 999,
              fee: 0.00002,
              vin: [
                {
                  prevout: {
                    value: 0.001,
                    scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                  },
                },
              ],
              vout: [{ value: 0.00098, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'prev-fee': {
              vout: [{ value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
          };
          return (txMap[txid] as any) ?? null;
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't1',
          txid: 'tx-sent',
          type: 'sent',
          amount: BigInt(-95000),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't2',
          txid: 'tx-recv-nodetails',
          type: 'received',
          amount: BigInt(30000),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't3',
          txid: 'tx-recv-detailed',
          type: 'received',
          amount: BigInt(30000),
          fee: null,
          blockHeight: 997,
          blockTime: null,
          confirmations: 4,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't4',
          txid: 'tx-consolidate',
          type: 'consolidation',
          amount: BigInt(0),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
        { id: 'addr-2', address: 'change-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBe(4);
      expect(result.confirmationUpdates).toEqual([
        { txid: 'tx-sent', oldConfirmations: 0, newConfirmations: 2 },
        { txid: 'tx-recv-nodetails', oldConfirmations: 0, newConfirmations: 6 },
        { txid: 'tx-consolidate', oldConfirmations: 0, newConfirmations: 2 },
      ]);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-fee', true);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({
          blockHeight: 999,
          confirmations: 2,
          fee: BigInt(5000),
          counterpartyAddress: 'external-addr',
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({
          blockHeight: 995,
          confirmations: 6,
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't3' },
        data: expect.objectContaining({
          counterpartyAddress: 'sender-addr',
          addressId: 'addr-1',
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't4' },
        data: expect.objectContaining({
          fee: BigInt(2000),
          amount: BigInt(-2000),
        }),
      });
      expect(mockRecalculateWalletBalances).toHaveBeenCalledWith('wallet-1');
    });

    it('populates addressId for sent transactions from input prevout wallet addresses', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async () => ({
          vin: [
            {
              prevout: {
                scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
              },
            },
          ],
          vout: [{ value: 0.0005, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
        })),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-sent-addressid',
          txid: 'tx-sent-addressid',
          type: 'sent',
          amount: BigInt(-50000),
          fee: BigInt(1000),
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBe(1);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-sent-addressid' },
        data: expect.objectContaining({
          addressId: 'addr-1',
        }),
      });
    });

    it('leaves received transaction addressId unset when no output matches wallet addresses', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async () => ({
          vin: [],
          vout: [{ value: 0.0002, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
        })),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-recv-no-match',
          txid: 'tx-recv-no-match',
          type: 'received',
          amount: BigInt(20000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBe(0);
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('does not set received addressId when wallet lookup returns no id', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async () => ({
          vin: [],
          vout: [{ value: 0.0002, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
        })),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-recv-missing-id',
          txid: 'tx-recv-missing-id',
          type: 'received',
          amount: BigInt(20000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
      ]);
      // Intentionally missing id to exercise the falsy-id branch.
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: undefined, address: 'wallet-addr' } as any,
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBe(0);
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('handles sent addressId fallback branches when vin is missing or lookup id is missing', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async (txid: string) => {
          if (txid === 'tx-sent-no-vin') {
            return {
              vout: [{ value: 0.0003, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
            };
          }
          return {
            vin: [
              {
                prevout: {
                  scriptPubKey: { addresses: ['external-in'] },
                },
              },
              {
                prevout: {
                  scriptPubKey: { addresses: ['wallet-addr'] },
                },
              },
            ],
            vout: [{ value: 0.0003, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
          };
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-sent-no-vin',
          txid: 'tx-sent-no-vin',
          type: 'sent',
          amount: BigInt(-30000),
          fee: BigInt(1000),
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
        {
          id: 't-sent-missing-id',
          txid: 'tx-sent-missing-id',
          type: 'sent',
          amount: BigInt(-30000),
          fee: BigInt(1000),
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
      ]);
      // Intentionally missing id to hit falsy lookup branch.
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: undefined, address: 'wallet-addr' } as any,
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBe(0);
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('handles address/transaction fetch failures and reports no updates needed', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => {
          throw new Error('history unavailable');
        }),
        getTransaction: vi.fn(async () => {
          throw new Error('tx fetch failed');
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-fail',
          txid: 'tx-fail',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      expect(mockWalletLog).toHaveBeenCalledWith(
        'wallet-1',
        'info',
        'POPULATE',
        'No transaction updates needed'
      );
    });

    it('covers mixed fee/address fallback branches including invalid fee, coinbase, prevout, and consolidation amount update', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async (txid: string) => {
          const txMap: Record<string, unknown> = {
            'tx-invalid-fee': {
              fee: 2, // invalid (> 1 BTC), should be rejected
              vin: [{ prevout: { value: 0.002, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
              vout: [{ value: 0.0019, scriptPubKey: { address: 'external-1', addresses: ['external-1'] } }],
            },
            'tx-coinbase': {
              vin: [{ coinbase: true }],
              vout: [{ value: 0.001, scriptPubKey: { address: 'external-2', addresses: ['external-2'] } }],
            },
            'tx-prevout-fee': {
              vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
              vout: [{ value: 0.0009, scriptPubKey: { address: 'external-3', addresses: ['external-3'] } }],
            },
            'tx-consolidation-calc': {
              vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
              vout: [{ value: 0.00095, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'tx-recv-prevcache-ok': {
              vin: [{ txid: 'prev-ok', vout: 0 }],
              vout: [{ value: 0.0004, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'tx-recv-prevcache-fail': {
              vin: [{ txid: 'prev-fail', vout: 0 }],
              vout: [{ value: 0.0004, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'prev-ok': {
              vout: [{ value: 0.0004, scriptPubKey: { address: 'sender-prev-ok', addresses: ['sender-prev-ok'] } }],
            },
          };
          if (txid === 'prev-fail') {
            throw new Error('prev tx unavailable');
          }
          return (txMap[txid] as any) ?? null;
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-invalid-fee',
          txid: 'tx-invalid-fee',
          type: 'sent',
          amount: BigInt(-1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-coinbase',
          txid: 'tx-coinbase',
          type: 'sent',
          amount: BigInt(-1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-prevout-fee',
          txid: 'tx-prevout-fee',
          type: 'sent',
          amount: BigInt(-1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-consolidation',
          txid: 'tx-consolidation-calc',
          type: 'consolidation',
          amount: BigInt(0),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-recv-prev-ok',
          txid: 'tx-recv-prevcache-ok',
          type: 'received',
          amount: BigInt(40000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-recv-prev-fail',
          txid: 'tx-recv-prevcache-fail',
          type: 'received',
          amount: BigInt(40000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBeGreaterThan(0);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-ok', true);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-fail', true);

      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-prevout-fee' },
        data: expect.objectContaining({
          fee: BigInt(10000),
          counterpartyAddress: 'external-3',
          addressId: 'addr-1',
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-consolidation' },
        data: expect.objectContaining({
          fee: BigInt(5000),
          amount: BigInt(-5000),
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-recv-prev-ok' },
        data: expect.objectContaining({
          counterpartyAddress: 'sender-prev-ok',
          addressId: 'addr-1',
        }),
      });
    });

    it('continues when fee/counterparty parsing and per-transaction processing throw errors', async () => {
      const outputWithThrowingFields: any = {};
      Object.defineProperty(outputWithThrowingFields, 'value', {
        get() {
          throw new Error('value parse error');
        },
      });
      Object.defineProperty(outputWithThrowingFields, 'scriptPubKey', {
        get() {
          throw new Error('script parse error');
        },
      });

      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async (txid: string) => {
          if (txid === 'tx-fee-counterparty-error') {
            return {
              vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr' } } }],
              vout: [outputWithThrowingFields],
            };
          }
          return {
            // Force outer catch in addressId section (for...of on non-iterable)
            vin: [],
            vout: 1,
          };
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-fee-counterparty-error',
          txid: 'tx-fee-counterparty-error',
          type: 'sent',
          amount: BigInt(-1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-outer-catch',
          txid: 'tx-outer-catch',
          type: 'received',
          amount: BigInt(500),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.confirmationUpdates).toEqual([]);
      expect(result.updated).toBeGreaterThanOrEqual(1);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalled();
      expect(mockWalletLog).toHaveBeenCalledWith(
        'wallet-1',
        'warn',
        'POPULATE',
        expect.stringContaining('Failed to process tx'),
        expect.any(Object),
      );
    });

    it('covers network fallback and blockTime derivation branches when wallet has no addresses', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-no-height', height: 0 }]),
        getTransaction: vi.fn(async (txid: string) => {
          if (txid === 'tx-no-height') {
            return {};
          }
          return { vin: [], vout: undefined };
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: '' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-no-height',
          txid: 'tx-no-height',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-needs-timestamp',
          txid: 'tx-needs-timestamp',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: 999,
          blockTime: null,
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([]);
      mockGetBlockTimestamp.mockResolvedValue(null);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
      expect(mockGetNodeClient).toHaveBeenCalledWith('mainnet');
      expect(mockGetBlockTimestamp).toHaveBeenCalledWith(999, 'mainnet');
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('ignores non-positive heights from address history during block-height extraction', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-h0', height: 0 }]),
        getTransaction: vi.fn(async () => null),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-h0',
          txid: 'tx-h0',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: null,
          blockTime: null,
          confirmations: 0,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
      expect(mockClient.getAddressHistory).toHaveBeenCalledWith('wallet-addr');
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('covers fee/counterparty/addressId fallback branches for sent, consolidation, and received txs', async () => {
      const mockClient = {
        getAddressHistory: vi.fn(async () => []),
        getTransaction: vi.fn(async (txid: string) => {
          const txMap: Record<string, unknown> = {
            'tx-sent-fallbacks': {
              vin: [
                {
                  prevout: {
                    value: 0.0001,
                    scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                  },
                },
                {},
                { txid: 'prev-missing', vout: 0 },
              ],
              vout: [
                { value: 0.0002, scriptPubKey: {} },
                { value: 0.0001, scriptPubKey: { addresses: ['external-by-array'] } },
              ],
            },
            'tx-consolidation-nonzero': {
              fee: 0.00001,
              vin: [
                {
                  prevout: {
                    value: 0.001,
                    scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                  },
                },
              ],
              vout: [{ value: 0.00099, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'tx-recv-coinbase': {
              vin: [{ coinbase: true }],
              vout: [{ value: 0.0001, scriptPubKey: {} }],
            },
            'tx-recv-vout-missing': {
              vin: [],
            },
            'tx-recv-prevout-mix': {
              vin: [
                { prevout: { scriptPubKey: {} } },
                { prevout: { scriptPubKey: { addresses: ['sender-array'] } } },
              ],
              vout: [{ value: 0.0001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'tx-recv-prevtx-mix': {
              vin: [
                {},
                { txid: 'prev-none', vout: 0 },
                { txid: 'prev-array', vout: 0 },
              ],
              vout: [{ value: 0.0001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
            },
            'prev-none': {
              vout: [{ value: 0.0001, scriptPubKey: {} }],
            },
            'prev-array': {
              vout: [{ value: 0.0001, scriptPubKey: { addresses: ['sender-prev-array'] } }],
            },
          };
          if (txid === 'prev-missing') {
            return null;
          }
          return (txMap[txid] as any) ?? null;
        }),
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
      mockGetNodeClient.mockResolvedValue(mockClient);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 't-sent-fallbacks',
          txid: 'tx-sent-fallbacks',
          type: 'sent',
          amount: BigInt(-1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-consolidation-nonzero',
          txid: 'tx-consolidation-nonzero',
          type: 'consolidation',
          amount: BigInt(-1),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: 'already-set',
        },
        {
          id: 't-recv-coinbase',
          txid: 'tx-recv-coinbase',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-recv-vout-missing',
          txid: 'tx-recv-vout-missing',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-recv-prevout-mix',
          txid: 'tx-recv-prevout-mix',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
        {
          id: 't-recv-prevtx-mix',
          txid: 'tx-recv-prevtx-mix',
          type: 'received',
          amount: BigInt(1000),
          fee: null,
          blockHeight: 999,
          blockTime: new Date('2024-01-01T00:00:00.000Z'),
          confirmations: 1,
          addressId: null,
          counterpartyAddress: null,
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: 'wallet-addr' },
      ]);

      const result = await populateMissingTransactionFields('wallet-1');

      expect(result.updated).toBeGreaterThan(0);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-missing', true);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-none', true);
      expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-array', true);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-sent-fallbacks' },
        data: expect.objectContaining({
          counterpartyAddress: 'external-by-array',
          addressId: 'addr-1',
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-consolidation-nonzero' },
        data: expect.objectContaining({
          fee: BigInt(1000),
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-recv-prevout-mix' },
        data: expect.objectContaining({
          counterpartyAddress: 'sender-array',
        }),
      });
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 't-recv-prevtx-mix' },
        data: expect.objectContaining({
          counterpartyAddress: 'sender-prev-array',
        }),
      });
    });
  });
});
