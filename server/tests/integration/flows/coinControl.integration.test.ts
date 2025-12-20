/**
 * Coin Control Integration Tests (HIGH)
 *
 * End-to-end coin control flow tests:
 * - UTXO selection with different strategies
 * - Privacy score calculation
 * - Spend analysis for selected UTXOs
 * - Frozen/locked UTXO exclusion
 *
 * These tests verify the complete coin control workflow.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma before importing services
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
} from '../../../src/services/utxoSelectionService';

import {
  calculateUtxoPrivacy,
  calculateWalletPrivacy,
  calculateSpendPrivacy,
} from '../../../src/services/privacyService';

// Test constants
const WALLET_ID = 'wallet-integration-test';
const ADDRESS_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ADDRESS_2 = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
const ADDRESS_3 = 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg';
const ADDRESS_4 = 'tb1qqqqqq0rd4lfmx0x7g0y76wz95wgc4qrm6c9s00';

// Create realistic test UTXOs
const createTestUtxo = (overrides: Partial<{
  id: string;
  txid: string;
  vout: number;
  walletId: string;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight: number | null;
  frozen: boolean;
  spent: boolean;
  draftLock: null | { draftId: string };
  scriptPubKey: string;
}> = {}) => ({
  id: 'utxo-1',
  txid: 'a'.repeat(64),
  vout: 0,
  walletId: WALLET_ID,
  address: ADDRESS_1,
  amount: BigInt(100000),
  confirmations: 6,
  blockHeight: 800000,
  frozen: false,
  spent: false,
  draftLock: null,
  scriptPubKey: '0014' + 'a'.repeat(40),
  ...overrides,
});

describe('Coin Control Integration Tests', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('Complete Coin Control Flow', () => {
    it('should select UTXOs and calculate privacy impact', async () => {
      // Create a wallet with mixed privacy UTXOs
      const utxos = [
        createTestUtxo({
          id: 'good-utxo-1',
          address: ADDRESS_1,
          amount: BigInt(100000),
          confirmations: 100,
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'good-utxo-2',
          address: ADDRESS_2,
          amount: BigInt(80000),
          confirmations: 50,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'round-utxo',
          address: ADDRESS_3,
          amount: BigInt(10_000_000), // Round amount
          confirmations: 20,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'reused-addr-1',
          address: ADDRESS_4,
          amount: BigInt(50000),
          confirmations: 10,
          txid: 'd'.repeat(64),
        }),
        createTestUtxo({
          id: 'reused-addr-2',
          address: ADDRESS_4, // Same address as above
          amount: BigInt(50000),
          confirmations: 10,
          txid: 'e'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      // Step 1: Select UTXOs for a transaction
      const selection = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(150000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(selection.selected.length).toBeGreaterThan(0);
      expect(selection.totalAmount).toBeGreaterThanOrEqual(BigInt(150000));

      // Step 2: Calculate privacy impact of selection
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        selection.selected.map(s => utxos.find(u => u.id === s.id)!)
      );

      const spendPrivacy = await calculateSpendPrivacy(
        selection.selected.map(u => u.id)
      );

      // Verify privacy metrics are calculated
      expect(spendPrivacy.score).toBeGreaterThanOrEqual(0);
      expect(spendPrivacy.score).toBeLessThanOrEqual(100);
      expect(spendPrivacy.linkedAddresses).toBeGreaterThanOrEqual(0);
    });

    it('should compare all selection strategies', async () => {
      const utxos = [
        createTestUtxo({
          id: 'large-old',
          amount: BigInt(500000),
          confirmations: 1000,
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'medium-new',
          amount: BigInt(100000),
          confirmations: 5,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-old',
          amount: BigInt(20000),
          confirmations: 500,
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(100000),
        10
      );

      // All strategies should return results
      expect(results.privacy).toBeDefined();
      expect(results.efficiency).toBeDefined();
      expect(results.oldest_first).toBeDefined();
      expect(results.largest_first).toBeDefined();
      expect(results.smallest_first).toBeDefined();

      // Different strategies may select differently
      // Efficiency/Largest should prefer the large UTXO
      expect(results.efficiency.selected[0].id).toBe('large-old');
      expect(results.largest_first.selected[0].id).toBe('large-old');

      // Oldest first should prefer high confirmation UTXOs
      expect(results.oldest_first.selected[0].id).toBe('large-old');

      // Smallest first should start with smallest
      expect(results.smallest_first.selected[0].id).toBe('small-old');
    });
  });

  describe('Privacy-Focused Selection', () => {
    it('should prefer already-linked UTXOs for better privacy', async () => {
      const sharedTxid = 'shared'.padEnd(64, '0');

      const utxos = [
        // Two outputs from same transaction (already linked)
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
          amount: BigInt(50000),
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
          amount: BigInt(60000),
        }),
        // Unrelated UTXO
        createTestUtxo({
          id: 'unrelated',
          txid: 'other'.padEnd(64, '0'),
          vout: 0,
          address: ADDRESS_3,
          amount: BigInt(200000),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'privacy',
      });

      // Privacy strategy should attempt to use linked UTXOs
      expect(result.strategy).toBe('privacy');
      expect(result.privacyImpact).toBeDefined();
    });

    it('should warn about linking multiple addresses', async () => {
      const utxos = [
        createTestUtxo({
          id: 'addr1',
          address: ADDRESS_1,
          amount: BigInt(50000),
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'addr2',
          address: ADDRESS_2,
          amount: BigInt(50000),
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'addr3',
          address: ADDRESS_3,
          amount: BigInt(50000),
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(120000), // Needs at least 3 UTXOs
        feeRate: 5,
        strategy: 'privacy',
      });

      // Should warn about multi-address linking
      if (result.privacyImpact && result.privacyImpact.linkedAddresses > 1) {
        expect(result.warnings.some(w => w.includes('address'))).toBe(true);
      }
    });
  });

  describe('Frozen/Locked UTXO Handling', () => {
    it('should exclude frozen UTXOs from selection', async () => {
      const utxos = [
        createTestUtxo({
          id: 'frozen',
          amount: BigInt(1000000),
          frozen: true,
        }),
        createTestUtxo({
          id: 'available',
          amount: BigInt(50000),
          frozen: false,
          txid: 'b'.repeat(64),
        }),
      ];

      // Mock returns only unfrozen
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        utxos.filter(u => !u.frozen)
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(40000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: true,
      });

      // Should only use the available UTXO
      expect(result.selected.every(u => u.id !== 'frozen')).toBe(true);
      expect(result.selected.some(u => u.id === 'available')).toBe(true);
    });

    it('should exclude draft-locked UTXOs', async () => {
      const utxos = [
        createTestUtxo({
          id: 'locked',
          amount: BigInt(500000),
          draftLock: { draftId: 'draft-123' },
        }),
        createTestUtxo({
          id: 'unlocked',
          amount: BigInt(100000),
          draftLock: null,
          txid: 'b'.repeat(64),
        }),
      ];

      // Mock returns only unlocked
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        utxos.filter(u => u.draftLock === null)
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected.every(u => u.id !== 'locked')).toBe(true);
    });

    it('should include frozen when explicitly requested', async () => {
      const utxos = [
        createTestUtxo({
          id: 'frozen',
          amount: BigInt(100000),
          frozen: true,
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: false, // Explicitly include frozen
      });

      expect(result.selected).toHaveLength(1);
    });
  });

  describe('Wallet Privacy Analysis', () => {
    it('should calculate privacy scores for entire wallet', async () => {
      const utxos = [
        createTestUtxo({
          id: 'good',
          address: ADDRESS_1,
          amount: BigInt(123456), // Non-round
          confirmations: 50,
        }),
        createTestUtxo({
          id: 'round',
          address: ADDRESS_2,
          amount: BigInt(100_000_000), // 1 BTC - round
          confirmations: 10,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'reuse-1',
          address: ADDRESS_3,
          amount: BigInt(50000),
          confirmations: 20,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'reuse-2',
          address: ADDRESS_3, // Same address
          amount: BigInt(50000),
          confirmations: 20,
          txid: 'd'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);
      mockPrismaClient.uTXO.findUnique.mockImplementation(async ({ where }: any) => {
        const utxo = utxos.find(u => u.id === where.id);
        return utxo ? { ...utxo, wallet: { id: WALLET_ID } } : null;
      });
      mockPrismaClient.uTXO.count.mockImplementation(async ({ where }: any) => {
        if (where?.address) {
          return utxos.filter(u => u.address === where.address && !u.spent).length;
        }
        return 1;
      });

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.utxoCount).toBe(4);
      expect(result.summary.addressReuseCount).toBe(1); // ADDRESS_3 is reused
      expect(result.summary.roundAmountCount).toBeGreaterThanOrEqual(1);
      expect(result.summary.averageScore).toBeGreaterThan(0);
      expect(result.summary.averageScore).toBeLessThanOrEqual(100);

      // Should have recommendations
      expect(result.summary.recommendations.length).toBeGreaterThan(0);
    });

    it('should handle empty wallet', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await calculateWalletPrivacy(WALLET_ID);

      expect(result.summary.utxoCount).toBe(0);
      expect(result.summary.averageScore).toBe(100); // Perfect for empty
      expect(result.summary.grade).toBe('excellent');
    });
  });

  describe('Spend Privacy Analysis', () => {
    it('should analyze privacy impact before spending', async () => {
      const utxo1 = createTestUtxo({
        id: 'utxo-1',
        address: ADDRESS_1,
        amount: BigInt(100000),
      });
      const utxo2 = createTestUtxo({
        id: 'utxo-2',
        address: ADDRESS_2,
        amount: BigInt(100000),
        txid: 'b'.repeat(64),
      });

      // First call returns only utxo-1 (for single address test)
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([utxo1]);

      // Spending from single address
      const singleAddressResult = await calculateSpendPrivacy(['utxo-1']);
      expect(singleAddressResult.linkedAddresses).toBe(1);
      expect(singleAddressResult.score).toBeGreaterThan(90);

      // Second call returns both UTXOs (for multi-address test)
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([utxo1, utxo2]);
      const multiAddressResult = await calculateSpendPrivacy(['utxo-1', 'utxo-2']);
      expect(multiAddressResult.linkedAddresses).toBe(2);
      expect(multiAddressResult.score).toBeLessThan(singleAddressResult.score);
      expect(multiAddressResult.warnings.some(w => w.includes('address'))).toBe(true);
    });

    it('should give bonus for already-linked UTXOs', async () => {
      const sharedTxid = 'shared'.padEnd(64, '0');

      const linkedUtxos = [
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(linkedUtxos);

      const result = await calculateSpendPrivacy(['linked-1', 'linked-2']);

      // Even though 2 addresses, they're already linked
      expect(result.score).toBeGreaterThan(70);
    });

    it('should warn about dust UTXOs', async () => {
      const utxos = [
        createTestUtxo({
          id: 'dust',
          amount: BigInt(500),
        }),
        createTestUtxo({
          id: 'normal',
          amount: BigInt(100000),
          txid: 'b'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await calculateSpendPrivacy(['dust', 'normal']);

      expect(result.warnings.some(w => w.includes('dust'))).toBe(true);
    });
  });

  describe('Fee Optimization', () => {
    it('should minimize fees with efficiency strategy in high-fee environment', async () => {
      const utxos = [
        createTestUtxo({
          id: 'large',
          amount: BigInt(500000),
          confirmations: 10,
        }),
        createTestUtxo({
          id: 'small-1',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-2',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-3',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'd'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const highFeeRate = 100; // sat/vB

      const efficiencyResult = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: highFeeRate,
        strategy: 'efficiency',
      });

      // Should use 1 large UTXO instead of 3 small
      expect(efficiencyResult.inputCount).toBe(1);
      expect(efficiencyResult.selected[0].id).toBe('large');
    });

    it('should consolidate in low-fee environment', async () => {
      const utxos = Array.from({ length: 20 }, (_, i) =>
        createTestUtxo({
          id: `small-${i}`,
          amount: BigInt(10000),
          txid: `${i}`.padStart(64, '0'),
        })
      );

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      // Condition for smallest_first: feeRate < 5 AND utxoCount > 20
      const recommendation = getRecommendedStrategy(21, 2); // 21 UTXOs, 2 sat/vB

      expect(recommendation.strategy).toBe('smallest_first');
      expect(recommendation.reason).toContain('consolidate');
    });
  });

  describe('Strategy Recommendations', () => {
    it('should recommend privacy strategy when explicitly requested', () => {
      const result = getRecommendedStrategy(10, 20, true);

      expect(result.strategy).toBe('privacy');
    });

    it('should recommend efficiency for high fees', () => {
      const result = getRecommendedStrategy(10, 100);

      expect(result.strategy).toBe('efficiency');
    });

    it('should recommend consolidation for low fees with many UTXOs', () => {
      const result = getRecommendedStrategy(50, 2);

      expect(result.strategy).toBe('smallest_first');
    });

    it('should default to efficiency for normal conditions', () => {
      const result = getRecommendedStrategy(5, 20);

      expect(result.strategy).toBe('efficiency');
    });
  });

  describe('Edge Cases', () => {
    describe('Confirmation Filtering', () => {
      it('should exclude unconfirmed UTXOs when required', async () => {
        const utxos = [
          createTestUtxo({
            id: 'confirmed',
            confirmations: 3,
            amount: BigInt(50000),
          }),
          createTestUtxo({
            id: 'unconfirmed',
            confirmations: 0,
            amount: BigInt(500000),
            txid: 'b'.repeat(64),
          }),
        ];

        // Only return confirmed
        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          utxos.filter(u => u.confirmations > 0)
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(40000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUnconfirmed: true,
        });

        expect(result.selected.every(u => u.id !== 'unconfirmed')).toBe(true);
      });
    });

    describe('Specific UTXO Exclusion', () => {
      it('should exclude specific UTXOs by ID', async () => {
        const utxos = [
          createTestUtxo({ id: 'exclude-me', amount: BigInt(1000000) }),
          createTestUtxo({ id: 'use-me', amount: BigInt(100000), txid: 'b'.repeat(64) }),
        ];

        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          utxos.filter(u => u.id !== 'exclude-me')
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUtxoIds: ['exclude-me'],
        });

        expect(result.selected.every(u => u.id !== 'exclude-me')).toBe(true);
      });
    });

    describe('Script Type Fee Calculation', () => {
      it('should calculate different fees for different script types', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const segwitResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'native_segwit',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const legacyResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'legacy',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const taprootResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'taproot',
        });

        // Legacy > SegWit > Taproot in terms of size
        expect(Number(legacyResult.estimatedFee)).toBeGreaterThan(Number(segwitResult.estimatedFee));
        expect(Number(segwitResult.estimatedFee)).toBeGreaterThanOrEqual(Number(taprootResult.estimatedFee));
      });
    });

    describe('Change Output Handling', () => {
      it('should include change when above dust threshold', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        // Should have significant change
        expect(Number(result.changeAmount)).toBeGreaterThan(546);
      });

      it('should handle near-exact amount (minimal/no change)', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(50500) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 1, // Low fee
          strategy: 'efficiency',
        });

        // Change should be minimal or absorbed
        expect(Number(result.changeAmount)).toBeLessThan(1000);
      });
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle typical payment scenario', async () => {
      // Simulate wallet with various UTXOs from normal usage
      const utxos = [
        // Previous payment change
        createTestUtxo({
          id: 'change-1',
          address: ADDRESS_1,
          amount: BigInt(45000),
          confirmations: 50,
          txid: 'a'.repeat(64),
        }),
        // Exchange withdrawal (round amount)
        createTestUtxo({
          id: 'exchange',
          address: ADDRESS_2,
          amount: BigInt(50_000_000), // 0.5 BTC
          confirmations: 100,
          txid: 'b'.repeat(64),
        }),
        // Previous payment change
        createTestUtxo({
          id: 'change-2',
          address: ADDRESS_3,
          amount: BigInt(32000),
          confirmations: 30,
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      // Make a payment of ~0.001 BTC
      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 20,
        strategy: 'efficiency',
      });

      expect(result.selected.length).toBeGreaterThan(0);
      expect(Number(result.totalAmount)).toBeGreaterThanOrEqual(100000);
    });

    it('should handle consolidation scenario', async () => {
      // Many small UTXOs that should be consolidated
      const utxos = Array.from({ length: 15 }, (_, i) =>
        createTestUtxo({
          id: `small-${i}`,
          address: `tb1q${'x'.repeat(38)}${i.toString().padStart(2, '0')}`,
          amount: BigInt(10000 + i * 1000),
          confirmations: 100 - i,
          txid: `${i}`.padEnd(64, '0'),
        })
      );

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      // Low fee environment - good for consolidation
      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 1,
        strategy: 'smallest_first',
      });

      // Should use multiple small UTXOs
      expect(result.inputCount).toBeGreaterThan(1);
    });

    it('should handle privacy-focused send', async () => {
      // UTXOs with mixed privacy characteristics
      const sharedTxid = 'shared'.padEnd(64, '0');
      const utxos = [
        // Already linked (from same tx)
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
          amount: BigInt(80000),
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
          amount: BigInt(70000),
        }),
        // Separate UTXOs
        createTestUtxo({
          id: 'separate',
          txid: 'other'.padEnd(64, '0'),
          vout: 0,
          address: ADDRESS_3,
          amount: BigInt(200000),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'privacy',
      });

      // Privacy strategy should have privacy impact calculated
      expect(result.privacyImpact).toBeDefined();
      expect(result.privacyImpact!.score).toBeGreaterThan(0);
    });
  });
});
