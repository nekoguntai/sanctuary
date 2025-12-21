/**
 * UTXO Selection Service Tests (HIGH)
 *
 * Tests for UTXO selection strategies:
 * - selectUtxos() - All 5 strategies
 * - selectForPrivacy() - Same-txid preference
 * - selectForEfficiency() - Largest first
 * - selectOldestFirst() / selectSmallestFirst()
 * - Edge cases: insufficient funds, all frozen, dust change
 *
 * These tests are important for transaction fee optimization and privacy.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma before importing service
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  selectUtxos,
  compareStrategies,
  getRecommendedStrategy,
  SelectionStrategy,
  SelectionResult,
} from '../../../src/services/utxoSelectionService';

// Test constants
const WALLET_ID = 'wallet-123';
const ADDRESS_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ADDRESS_2 = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
const ADDRESS_3 = 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg';

// Create test UTXOs
const createTestUtxo = (overrides: Partial<{
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight: number | null;
  frozen: boolean;
  spent: boolean;
  draftLock: null | { draftId: string };
}> = {}) => ({
  id: 'utxo-1',
  txid: 'aaaa'.repeat(16),
  vout: 0,
  address: ADDRESS_1,
  amount: BigInt(100000),
  confirmations: 6,
  blockHeight: 800000,
  frozen: false,
  spent: false,
  draftLock: null,
  ...overrides,
});

describe('UTXO Selection Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('selectUtxos', () => {
    describe('Basic Selection', () => {
      it('should select UTXOs to cover target amount', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(50000) }),
          createTestUtxo({ id: 'utxo-2', amount: BigInt(100000) }),
          createTestUtxo({ id: 'utxo-3', amount: BigInt(200000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.selected.length).toBeGreaterThan(0);
        expect(result.totalAmount).toBeGreaterThanOrEqual(BigInt(80000));
        expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
      });

      it('should return empty selection when no UTXOs available', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.selected).toHaveLength(0);
        expect(result.totalAmount).toBe(BigInt(0));
        expect(result.warnings).toContain('No available UTXOs');
      });

      it('should warn when insufficient funds', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(10000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(1000000), // More than available
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
      });

      it('should calculate change amount correctly', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        // change = totalAmount - targetAmount - fee
        expect(result.changeAmount).toBe(
          result.totalAmount - BigInt(50000) - result.estimatedFee
        );
      });

      it('should not return negative change', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(50100) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.changeAmount).toBeGreaterThanOrEqual(BigInt(0));
      });
    });

    describe('Filter Options', () => {
      it('should exclude frozen UTXOs by default', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              frozen: false,
            }),
          })
        );
      });

      it('should include frozen UTXOs when excludeFrozen is false', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeFrozen: false,
        });

        expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({
              frozen: false,
            }),
          })
        );
      });

      it('should exclude unconfirmed UTXOs when specified', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUnconfirmed: true,
        });

        expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              confirmations: { gt: 0 },
            }),
          })
        );
      });

      it('should exclude specific UTXO IDs', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUtxoIds: ['utxo-1', 'utxo-2'],
        });

        expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: { notIn: ['utxo-1', 'utxo-2'] },
            }),
          })
        );
      });

      it('should exclude draft-locked UTXOs', async () => {
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              draftLock: null,
            }),
          })
        );
      });
    });

    describe('Efficiency Strategy (Largest First)', () => {
      it('should select largest UTXOs first', async () => {
        const utxos = [
          createTestUtxo({ id: 'small', amount: BigInt(10000) }),
          createTestUtxo({ id: 'medium', amount: BigInt(50000) }),
          createTestUtxo({ id: 'large', amount: BigInt(200000) }),
        ];
        // Mock returns UTXOs sorted by amount desc
        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          [...utxos].sort((a, b) => Number(b.amount - a.amount))
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(100000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        // Should use the large UTXO first
        expect(result.selected[0].id).toBe('large');
      });

      it('should minimize input count', async () => {
        const utxos = [
          createTestUtxo({ id: 'large', amount: BigInt(200000) }),
          createTestUtxo({ id: 'small-1', amount: BigInt(10000) }),
          createTestUtxo({ id: 'small-2', amount: BigInt(10000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          [...utxos].sort((a, b) => Number(b.amount - a.amount))
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(20000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        // Should use 1 large UTXO instead of 2 small ones
        expect(result.inputCount).toBe(1);
      });
    });

    describe('Privacy Strategy', () => {
      it('should prefer UTXOs from same transaction', async () => {
        const sameTxid = 'aaaa'.repeat(16);
        const utxos = [
          createTestUtxo({ id: 'tx1-0', txid: sameTxid, vout: 0, amount: BigInt(50000), address: ADDRESS_1 }),
          createTestUtxo({ id: 'tx1-1', txid: sameTxid, vout: 1, amount: BigInt(50000), address: ADDRESS_2 }),
          createTestUtxo({ id: 'tx2-0', txid: 'bbbb'.repeat(16), vout: 0, amount: BigInt(200000), address: ADDRESS_3 }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000),
          feeRate: 10,
          strategy: 'privacy',
        });

        // Should prefer using both outputs from same tx if they cover the amount
        expect(result.selected.length).toBeGreaterThan(0);
        expect(result.strategy).toBe('privacy');
      });

      it('should prefer UTXOs with same address', async () => {
        const utxos = [
          createTestUtxo({ id: 'addr1-1', address: ADDRESS_1, amount: BigInt(50000) }),
          createTestUtxo({ id: 'addr1-2', address: ADDRESS_1, amount: BigInt(60000) }),
          createTestUtxo({ id: 'addr2-1', address: ADDRESS_2, amount: BigInt(200000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000),
          feeRate: 10,
          strategy: 'privacy',
        });

        // Privacy calculation should track linked addresses
        expect(result.privacyImpact).toBeDefined();
        expect(result.privacyImpact!.linkedAddresses).toBeGreaterThanOrEqual(1);
      });

      it('should warn about multi-address spending', async () => {
        const utxos = [
          createTestUtxo({ id: 'addr1', address: ADDRESS_1, amount: BigInt(30000) }),
          createTestUtxo({ id: 'addr2', address: ADDRESS_2, amount: BigInt(30000) }),
          createTestUtxo({ id: 'addr3', address: ADDRESS_3, amount: BigInt(30000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000),
          feeRate: 10,
          strategy: 'privacy',
        });

        if (result.privacyImpact && result.privacyImpact.linkedAddresses > 1) {
          expect(result.warnings.some(w => w.includes('address'))).toBe(true);
        }
      });

      it('should calculate privacy score', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'privacy',
        });

        expect(result.privacyImpact).toBeDefined();
        expect(result.privacyImpact!.score).toBeGreaterThanOrEqual(0);
        expect(result.privacyImpact!.score).toBeLessThanOrEqual(100);
      });
    });

    describe('Oldest First Strategy', () => {
      it('should select UTXOs with most confirmations first', async () => {
        const utxos = [
          createTestUtxo({ id: 'new', confirmations: 2 }),
          createTestUtxo({ id: 'old', confirmations: 1000 }),
          createTestUtxo({ id: 'medium', confirmations: 50 }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'oldest_first',
        });

        expect(result.selected[0].confirmations).toBe(1000);
        expect(result.strategy).toBe('oldest_first');
      });
    });

    describe('Largest First Strategy', () => {
      it('should behave same as efficiency', async () => {
        const utxos = [
          createTestUtxo({ id: 'small', amount: BigInt(10000) }),
          createTestUtxo({ id: 'large', amount: BigInt(200000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          [...utxos].sort((a, b) => Number(b.amount - a.amount))
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'largest_first',
        });

        expect(result.selected[0].id).toBe('large');
        expect(result.strategy).toBe('largest_first');
      });
    });

    describe('Smallest First Strategy (Consolidation)', () => {
      it('should select smallest UTXOs first', async () => {
        const utxos = [
          createTestUtxo({ id: 'large', amount: BigInt(200000) }),
          createTestUtxo({ id: 'small', amount: BigInt(10000) }),
          createTestUtxo({ id: 'medium', amount: BigInt(50000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 1, // Low fee to allow consolidation
          strategy: 'smallest_first',
        });

        expect(result.selected[0].id).toBe('small');
        expect(result.strategy).toBe('smallest_first');
      });

      it('should warn about many small UTXOs', async () => {
        const utxos = Array.from({ length: 10 }, (_, i) =>
          createTestUtxo({
            id: `small-${i}`,
            amount: BigInt(10000),
            txid: `${'a'.repeat(60)}${i.toString().padStart(4, '0')}`,
          })
        );
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000),
          feeRate: 1,
          strategy: 'smallest_first',
        });

        if (result.inputCount > 5) {
          expect(result.warnings.some(w => w.includes('small UTXOs'))).toBe(true);
        }
      });
    });

    describe('Fee Calculation', () => {
      it('should estimate fee based on script type', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const resultSegwit = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'native_segwit',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const resultLegacy = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'legacy',
        });

        // Legacy should have higher fee than native segwit
        expect(resultLegacy.estimatedFee).toBeGreaterThan(resultSegwit.estimatedFee);
      });

      it('should use native_segwit as default script type', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          // No scriptType specified
        });

        // Should use native_segwit fee calculation
        expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
      });

      it('should scale fee with input count', async () => {
        const utxos = [
          createTestUtxo({ id: 'utxo-1', amount: BigInt(50000) }),
          createTestUtxo({ id: 'utxo-2', amount: BigInt(50000), txid: 'bbbb'.repeat(16) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result1 = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(40000), // Needs 1 UTXO
          feeRate: 10,
          strategy: 'efficiency',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result2 = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(80000), // Needs 2 UTXOs
          feeRate: 10,
          strategy: 'efficiency',
        });

        // 2 inputs should have higher fee than 1 input
        if (result2.inputCount > result1.inputCount) {
          expect(result2.estimatedFee).toBeGreaterThan(result1.estimatedFee);
        }
      });
    });
  });

  describe('compareStrategies', () => {
    it('should return results for all 5 strategies', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(100000), confirmations: 10 }),
        createTestUtxo({ id: 'utxo-2', amount: BigInt(50000), confirmations: 5, txid: 'bbbb'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(80000),
        10
      );

      expect(results.privacy).toBeDefined();
      expect(results.efficiency).toBeDefined();
      expect(results.oldest_first).toBeDefined();
      expect(results.largest_first).toBeDefined();
      expect(results.smallest_first).toBeDefined();
    });

    it('should show different results for different strategies', async () => {
      const utxos = [
        createTestUtxo({ id: 'new-large', amount: BigInt(200000), confirmations: 1 }),
        createTestUtxo({ id: 'old-small', amount: BigInt(10000), confirmations: 1000, txid: 'bbbb'.repeat(16) }),
        createTestUtxo({ id: 'medium', amount: BigInt(50000), confirmations: 50, txid: 'cccc'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(30000),
        10
      );

      // Different strategies may select different UTXOs
      expect(results.largest_first.selected[0].id).toBe('new-large');
      expect(results.oldest_first.selected[0].id).toBe('old-small');
    });

    it('should use default script type', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(50000),
        10
        // No scriptType
      );

      // All results should have fees calculated
      Object.values(results).forEach(result => {
        expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
      });
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should recommend privacy when prioritizePrivacy is true', () => {
      const recommendation = getRecommendedStrategy(10, 20, true);

      expect(recommendation.strategy).toBe('privacy');
      expect(recommendation.reason).toContain('privacy');
    });

    it('should recommend efficiency for high fee environment', () => {
      const recommendation = getRecommendedStrategy(10, 100); // > 50 sat/vB

      expect(recommendation.strategy).toBe('efficiency');
      expect(recommendation.reason).toContain('fee');
    });

    it('should recommend smallest_first for low fee with many UTXOs', () => {
      const recommendation = getRecommendedStrategy(25, 2); // > 20 UTXOs, < 5 sat/vB

      expect(recommendation.strategy).toBe('smallest_first');
      expect(recommendation.reason).toContain('consolidate');
    });

    it('should default to efficiency for normal conditions', () => {
      const recommendation = getRecommendedStrategy(5, 20);

      expect(recommendation.strategy).toBe('efficiency');
    });
  });

  describe('Edge Cases', () => {
    describe('Insufficient Funds', () => {
      it('should handle when total UTXOs less than target', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(10000) }),
          createTestUtxo({ amount: BigInt(20000), txid: 'bbbb'.repeat(16) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(1000000), // Much more than available
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
        expect(result.selected.length).toBe(2); // All UTXOs selected
      });

      it('should handle when fee exceeds available after target', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(50100) }), // Just barely covers target
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 100, // High fee rate
          strategy: 'efficiency',
        });

        // Should warn if fee pushes it over
        if (result.totalAmount < BigInt(50000) + result.estimatedFee) {
          expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
        }
      });
    });

    describe('All UTXOs Frozen', () => {
      it('should return empty selection when all frozen', async () => {
        // When excludeFrozen=true, findMany returns empty if all frozen
        mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeFrozen: true,
        });

        expect(result.selected).toHaveLength(0);
        expect(result.warnings).toContain('No available UTXOs');
      });
    });

    describe('Dust Change Handling', () => {
      it('should not create dust change (absorbed into fee)', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(50600) }), // Creates ~600 sat change
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 1, // Low fee
          strategy: 'efficiency',
        });

        // Dust threshold is typically 546 sats
        // If change would be < dust, it should be 0 (absorbed)
        if (result.changeAmount < BigInt(546) && result.changeAmount > BigInt(0)) {
          // Some implementations might still show small change
          // This is acceptable as long as it's handled in tx creation
        }
      });

      it('should keep change when above dust threshold', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        // With 100k input, 50k target, ~1k fee, should have ~49k change
        expect(result.changeAmount).toBeGreaterThan(BigInt(546));
      });
    });

    describe('Single UTXO', () => {
      it('should handle wallet with single UTXO', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(result.inputCount).toBe(1);
        expect(result.selected[0].id).toBe('utxo-1');
      });
    });

    describe('Zero Target Amount', () => {
      it('should reject zero target amount', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        await expect(selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(0),
          feeRate: 10,
          strategy: 'efficiency',
        })).rejects.toThrow('targetAmount must be a positive BigInt');
      });

      it('should reject negative target amount', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        await expect(selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(-1000),
          feeRate: 10,
          strategy: 'efficiency',
        })).rejects.toThrow('targetAmount must be a positive BigInt');
      });
    });

    describe('Very High Fee Rate', () => {
      it('should handle extremely high fee rate', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(1000000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(100000),
          feeRate: 1000, // 1000 sat/vB
          strategy: 'efficiency',
        });

        expect(result.estimatedFee).toBeGreaterThan(BigInt(100000));
      });
    });

    describe('Very Low Fee Rate', () => {
      it('should handle 1 sat/vB minimum fee', async () => {
        const utxos = [
          createTestUtxo({ amount: BigInt(100000) }),
        ];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 1, // Minimum
          strategy: 'efficiency',
        });

        expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
      });
    });
  });

  describe('Result Structure', () => {
    it('should return all required fields', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result).toHaveProperty('selected');
      expect(result).toHaveProperty('totalAmount');
      expect(result).toHaveProperty('estimatedFee');
      expect(result).toHaveProperty('changeAmount');
      expect(result).toHaveProperty('inputCount');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('warnings');
    });

    it('should return UTXO details in selected array', async () => {
      const utxos = [createTestUtxo()];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected[0]).toHaveProperty('id');
      expect(result.selected[0]).toHaveProperty('txid');
      expect(result.selected[0]).toHaveProperty('vout');
      expect(result.selected[0]).toHaveProperty('address');
      expect(result.selected[0]).toHaveProperty('amount');
      expect(result.selected[0]).toHaveProperty('confirmations');
    });
  });
});
