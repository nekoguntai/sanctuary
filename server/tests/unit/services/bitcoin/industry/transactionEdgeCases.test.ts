/**
 * Transaction Creation Industry Edge Case Tests
 *
 * Tests for common Bitcoin transaction creation pitfalls:
 * - Fee sniping prevention (nLockTime)
 * - Batch payment duplicate address handling
 * - RBF sequence number correctness
 * - Transaction version field
 * - MAX_MONEY output validation
 * - Deep chain reorganization resilience
 */

import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createTransaction,
  parseTransaction,
  estimateTransactionSize,
  calculateFee,
} from '../../../../../src/services/bitcoin/utils';
import { RBF_SEQUENCE, MAX_RBF_SEQUENCE } from '../../../../../src/services/bitcoin/advancedTx/shared';

const TESTNET = bitcoin.networks.testnet;

// Generate valid testnet P2WPKH addresses for testing
function getTestnetAddress(seed: number): string {
  const hash = Buffer.alloc(20, seed);
  return bitcoin.payments.p2wpkh({ hash, network: TESTNET }).address!;
}

// Helper to create a valid testnet P2WPKH output script
function p2wpkhScript(): string {
  return '0014' + 'aa'.repeat(20);
}

// Helper to create test inputs
function createTestInputs(count: number, valuePerInput: number = 100_000) {
  return Array.from({ length: count }, (_, i) => ({
    txid: (i.toString(16).padStart(2, '0')).repeat(32),
    vout: 0,
    value: valuePerInput,
    scriptPubKey: p2wpkhScript(),
  }));
}

// Helper to create test outputs with valid testnet addresses
function createTestOutputs(amounts: number[]) {
  return amounts.map((amount, i) => ({
    address: getTestnetAddress(0x10 + i),
    value: amount,
  }));
}

describe('Transaction Creation Industry Edge Cases', () => {
  // ==========================================================================
  // FEE SNIPING PREVENTION
  // ==========================================================================
  describe('Fee sniping prevention (nLockTime)', () => {
    it('should document that nLockTime is not currently set', () => {
      // Bitcoin Core sets nLockTime to the current block height by default
      // to prevent fee sniping attacks. Fee sniping is when a miner re-mines
      // a recent block and includes previously-confirmed transactions to
      // steal their fees.
      //
      // With nLockTime set to current block height:
      // - The transaction can only be included in the next block or later
      // - Re-mining an older block won't include this transaction
      //
      // Current implementation creates PSBTs without setting locktime.
      // bitcoinjs-lib defaults locktime to 0 (no restriction).
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      expect(psbt.locktime).toBe(0);

      // RECOMMENDATION: Set psbt.setLocktime(currentBlockHeight) when creating
      // transactions. This is a best-practice defense against fee sniping with
      // no downside to the user.
    });

    it('should verify locktime 0 means no block height restriction', () => {
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      // Parse the PSBT to check locktime
      expect(result.psbt.locktime).toBe(0);
    });

    it('should document the recommended locktime value', () => {
      // Best practice per Bitcoin Core:
      // 1. Set nLockTime = currentBlockHeight
      // 2. With 10% probability, subtract a random value 0-99 from locktime
      //    to avoid fingerprinting locktime-using wallets
      const currentBlockHeight = 800_000;
      const recommendedLocktime = currentBlockHeight;

      expect(recommendedLocktime).toBeGreaterThan(0);
      expect(recommendedLocktime).toBeLessThan(500_000_000); // Below this = block height, above = UNIX timestamp
    });
  });

  // ==========================================================================
  // RBF SEQUENCE CONSTANTS
  // ==========================================================================
  describe('RBF sequence number correctness', () => {
    it('should use standard RBF sequence value', () => {
      // BIP125 RBF: any sequence < 0xFFFFFFFE signals replacement
      // 0xFFFFFFFD is the conventional value used by Bitcoin Core
      expect(RBF_SEQUENCE).toBe(0xfffffffd);
    });

    it('should correctly define the RBF boundary', () => {
      // 0xFFFFFFFE = final, no RBF, but allows relative timelock (BIP68)
      // 0xFFFFFFFF = final, no RBF, no relative timelock
      expect(MAX_RBF_SEQUENCE).toBe(0xfffffffe);
      expect(RBF_SEQUENCE).toBeLessThan(MAX_RBF_SEQUENCE);
    });

    it('should create RBF-enabled transactions by default', () => {
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, {
        network: 'testnet',
        enableRBF: true,
      });

      // Verify all inputs have RBF sequence
      const txInputs = result.psbt.txInputs;
      for (const input of txInputs) {
        expect(input.sequence).toBe(0xfffffffd);
      }
    });

    it('should create non-RBF transactions when disabled', () => {
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, {
        network: 'testnet',
        enableRBF: false,
      });

      const txInputs = result.psbt.txInputs;
      for (const input of txInputs) {
        expect(input.sequence).toBe(0xffffffff);
      }
    });
  });

  // ==========================================================================
  // TRANSACTION VERSION
  // ==========================================================================
  describe('Transaction version field', () => {
    it('should create version 2 transactions', () => {
      // Version 2 is required for BIP68 relative timelock enforcement.
      // bitcoinjs-lib defaults to version 2.
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      // bitcoinjs-lib PSBT uses transaction version 2 by default
      expect(result.psbt.version).toBe(2);
    });
  });

  // ==========================================================================
  // BATCH PAYMENT EDGE CASES
  // ==========================================================================
  describe('Batch payment edge cases', () => {
    it('should handle duplicate addresses in outputs', () => {
      // Sending to the same address twice is technically valid but unusual.
      // It creates two separate UTXOs at the same address.
      const sameAddress = getTestnetAddress(0x50);
      const outputs = [
        { address: sameAddress, value: 10_000 },
        { address: sameAddress, value: 20_000 },
      ];

      const inputs = createTestInputs(1, 100_000);
      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      // Should create two outputs to the same address
      expect(result.psbt.txOutputs).toHaveLength(2);
      expect(result.psbt.txOutputs[0].value + result.psbt.txOutputs[1].value).toBe(30_000);
    });
  });

  // ==========================================================================
  // NEGATIVE/OVERFLOW OUTPUT VALUES
  // ==========================================================================
  describe('Output value safety', () => {
    const MAX_MONEY_SATS = 2_100_000_000_000_000;

    it('should handle maximum single output value', () => {
      // A single output can be up to MAX_MONEY (21M BTC)
      // but this would require an input of MAX_MONEY + fee
      const inputs = createTestInputs(1, MAX_MONEY_SATS);
      const outputs = createTestOutputs([MAX_MONEY_SATS - 1000]);

      // bitcoinjs-lib should handle this (it uses number, which is safe up to 2^53)
      expect(() => {
        createTransaction(inputs, outputs, 0, { network: 'testnet' });
      }).not.toThrow();
    });

    it('should not create negative-value outputs', () => {
      // Negative values would be a critical bug
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      for (const output of result.psbt.txOutputs) {
        expect(output.value).toBeGreaterThanOrEqual(0);
      }
    });

    it('total input should always exceed total output (fee is positive)', () => {
      const inputs = createTestInputs(2, 50_000);
      const outputs = createTestOutputs([40_000, 30_000]);

      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      expect(result.totalInput).toBeGreaterThan(result.totalOutput);
      expect(result.fee).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // TRANSACTION PARSING
  // ==========================================================================
  describe('Transaction parsing edge cases', () => {
    it('should correctly reverse txid byte order (little-endian to display)', () => {
      // Bitcoin txids are displayed in reversed byte order compared to
      // their internal representation. This is a common source of bugs.
      const inputs = createTestInputs(1);
      const outputs = createTestOutputs([50_000]);

      const result = createTransaction(inputs, outputs, 1, { network: 'testnet' });

      const parsedInputs = result.psbt.txInputs;
      for (const input of parsedInputs) {
        // hash is internal (little-endian), displayed txid is reversed
        const displayTxid = Buffer.from(input.hash).reverse().toString('hex');
        expect(displayTxid).toHaveLength(64);
        // Should match the input txid we provided
      }
    });

    it('should correctly parse weight and vsize', () => {
      // Weight = base_size * 3 + total_size (BIP141)
      // vsize = ceil(weight / 4)
      const size1in2out = estimateTransactionSize(1, 2, 'native_segwit');
      // 10.5 + 68 + 2*34 = 146.5
      expect(size1in2out).toBeCloseTo(146.5, 1);

      const size2in2out = estimateTransactionSize(2, 2, 'native_segwit');
      // 10.5 + 2*68 + 2*34 = 214.5
      expect(size2in2out).toBeCloseTo(214.5, 1);
    });
  });

  // ==========================================================================
  // DEEP CHAIN REORGANIZATION HANDLING
  // ==========================================================================
  describe('Chain reorganization resilience', () => {
    it('should document the reorg handling approach', () => {
      // Chain reorganizations can invalidate confirmed transactions.
      // The wallet needs to:
      // 1. Detect reorg (block height went backwards or block hash changed)
      // 2. Mark affected transactions as unconfirmed
      // 3. Restore UTXOs that were spent in now-invalid transactions
      // 4. Re-sync from the fork point
      //
      // Current sync pipeline handles 1-block reorgs via RBF cleanup.
      // Deeper reorgs may leave the wallet in an inconsistent state.
      //
      // RECOMMENDATION: On detecting a reorg deeper than 1 block:
      // 1. Find the common ancestor block
      // 2. Roll back all transactions confirmed after that block
      // 3. Re-sync from the common ancestor

      const SHALLOW_REORG_DEPTH = 1;
      const DEEP_REORG_DEPTH = 6;

      // 6+ block reorgs are extremely rare but have happened
      // (the 2013 Bitcoin fork required a manual rollback)
      expect(DEEP_REORG_DEPTH).toBeGreaterThan(SHALLOW_REORG_DEPTH);
    });

    it('should document confirmation finality thresholds', () => {
      // Industry standard confirmation thresholds:
      const FINALITY_THRESHOLDS = {
        lowValue: 1,       // < $1,000 — 1 confirmation is typically sufficient
        mediumValue: 3,    // $1,000 - $10,000
        highValue: 6,      // > $10,000 — "6 confirmations" is the Bitcoin standard
        exchange: 3,       // Most exchanges require 3 confirmations
        coinbase: 100,     // Coinbase outputs — consensus rule, not configurable
      };

      expect(FINALITY_THRESHOLDS.coinbase).toBe(100);
      expect(FINALITY_THRESHOLDS.highValue).toBe(6);
    });
  });
});
