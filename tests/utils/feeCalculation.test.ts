/**
 * Fee Calculation Utility Tests
 *
 * Tests for Bitcoin transaction size and fee calculation functions.
 * These are critical for accurate fee estimation.
 */

import { describe, it, expect } from 'vitest';
import {
  getInputSize,
  getOutputSize,
  calculateFee,
  estimateVbytes,
} from '../../utils/feeCalculation';

describe('Fee Calculation', () => {
  describe('getInputSize', () => {
    it('should return correct size for native segwit (P2WPKH)', () => {
      expect(getInputSize('native_segwit')).toBe(68);
    });

    it('should return correct size for nested segwit (P2SH-P2WPKH)', () => {
      expect(getInputSize('nested_segwit')).toBe(91);
    });

    it('should return correct size for taproot (P2TR)', () => {
      expect(getInputSize('taproot')).toBe(58);
    });

    it('should return correct size for legacy (P2PKH)', () => {
      expect(getInputSize('legacy')).toBe(148);
    });

    it('should default to native segwit for unknown type', () => {
      expect(getInputSize('unknown')).toBe(68);
    });

    it('should default to native segwit for undefined', () => {
      expect(getInputSize(undefined)).toBe(68);
    });
  });

  describe('getOutputSize', () => {
    it('should return correct size for native segwit output', () => {
      expect(getOutputSize('native_segwit')).toBe(31);
    });

    it('should return correct size for nested segwit output', () => {
      expect(getOutputSize('nested_segwit')).toBe(32);
    });

    it('should return correct size for taproot output', () => {
      expect(getOutputSize('taproot')).toBe(43);
    });

    it('should return correct size for legacy output', () => {
      expect(getOutputSize('legacy')).toBe(34);
    });

    it('should default to native segwit for unknown type', () => {
      expect(getOutputSize('unknown')).toBe(31);
    });

    it('should default to native segwit for undefined', () => {
      expect(getOutputSize(undefined)).toBe(31);
    });
  });

  describe('calculateFee', () => {
    it('should calculate fee for simple 1-input, 2-output native segwit tx', () => {
      // 1 input (68) + 2 outputs (31*2=62) + overhead (11) = 141 vbytes
      // At 10 sat/vB = 1410 sats
      const fee = calculateFee(1, 2, 10, 'native_segwit');
      expect(fee).toBe(1410);
    });

    it('should calculate fee for multi-input transaction', () => {
      // 3 inputs (68*3=204) + 2 outputs (31*2=62) + overhead (11) = 277 vbytes
      // At 5 sat/vB = 1385 sats
      const fee = calculateFee(3, 2, 5, 'native_segwit');
      expect(fee).toBe(1385);
    });

    it('should calculate higher fee for legacy transactions', () => {
      // 1 input (148) + 2 outputs (34*2=68) + overhead (11) = 227 vbytes
      // At 10 sat/vB = 2270 sats
      const fee = calculateFee(1, 2, 10, 'legacy');
      expect(fee).toBe(2270);
    });

    it('should calculate lower fee for taproot transactions', () => {
      // 1 input (58) + 2 outputs (43*2=86) + overhead (11) = 155 vbytes
      // At 10 sat/vB = 1550 sats
      const fee = calculateFee(1, 2, 10, 'taproot');
      expect(fee).toBe(1550);
    });

    it('should round up fractional fees', () => {
      // Fee rate of 1.5 would result in fractional satoshis
      // Should always round up to ensure tx is accepted
      const fee = calculateFee(1, 2, 1.5, 'native_segwit');
      // 141 * 1.5 = 211.5, rounded up = 212
      expect(fee).toBe(212);
    });

    it('should handle zero inputs (edge case)', () => {
      // 0 inputs + 1 output (31) + overhead (11) = 42 vbytes
      const fee = calculateFee(0, 1, 10, 'native_segwit');
      expect(fee).toBe(420);
    });

    it('should handle zero outputs (edge case)', () => {
      // 1 input (68) + 0 outputs + overhead (11) = 79 vbytes
      const fee = calculateFee(1, 0, 10, 'native_segwit');
      expect(fee).toBe(790);
    });

    it('should handle high fee rates', () => {
      // Stress test with high fee rate (congested mempool)
      const fee = calculateFee(1, 2, 500, 'native_segwit');
      // 141 * 500 = 70500
      expect(fee).toBe(70500);
    });

    it('should handle large number of inputs', () => {
      // 100 inputs for consolidation
      // 100 * 68 + 1 * 31 + 11 = 6842 vbytes
      const fee = calculateFee(100, 1, 1, 'native_segwit');
      expect(fee).toBe(6842);
    });
  });

  describe('estimateVbytes', () => {
    it('should estimate vbytes for simple transaction', () => {
      // 1 input (68) + 2 outputs (31*2=62) + overhead (11) = 141
      const vbytes = estimateVbytes(1, 2, 'native_segwit');
      expect(vbytes).toBe(141);
    });

    it('should estimate vbytes for taproot transaction', () => {
      // 1 input (58) + 2 outputs (43*2=86) + overhead (11) = 155
      const vbytes = estimateVbytes(1, 2, 'taproot');
      expect(vbytes).toBe(155);
    });

    it('should estimate vbytes for nested segwit transaction', () => {
      // 1 input (91) + 2 outputs (32*2=64) + overhead (11) = 166
      const vbytes = estimateVbytes(1, 2, 'nested_segwit');
      expect(vbytes).toBe(166);
    });

    it('should estimate vbytes for legacy transaction', () => {
      // 1 input (148) + 2 outputs (34*2=68) + overhead (11) = 227
      const vbytes = estimateVbytes(1, 2, 'legacy');
      expect(vbytes).toBe(227);
    });

    it('should use default script type when not specified', () => {
      const vbytes = estimateVbytes(1, 2);
      // Default is native_segwit: 68 + 62 + 11 = 141
      expect(vbytes).toBe(141);
    });

    it('should return consistent results with calculateFee', () => {
      const vbytes = estimateVbytes(2, 3, 'native_segwit');
      const fee = calculateFee(2, 3, 1, 'native_segwit');
      // At 1 sat/vB, fee should equal vbytes
      expect(fee).toBe(vbytes);
    });
  });

  describe('Script type comparison', () => {
    it('should show taproot as most efficient for inputs', () => {
      expect(getInputSize('taproot')).toBeLessThan(getInputSize('native_segwit'));
      expect(getInputSize('native_segwit')).toBeLessThan(getInputSize('nested_segwit'));
      expect(getInputSize('nested_segwit')).toBeLessThan(getInputSize('legacy'));
    });

    it('should show native segwit as most efficient for outputs', () => {
      expect(getOutputSize('native_segwit')).toBeLessThan(getOutputSize('nested_segwit'));
      expect(getOutputSize('nested_segwit')).toBeLessThan(getOutputSize('legacy'));
      expect(getOutputSize('legacy')).toBeLessThan(getOutputSize('taproot'));
    });
  });
});
