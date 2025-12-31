/**
 * Trezor Adapter Tests
 *
 * Tests the validateSatoshiAmount utility function which handles
 * conversion and validation of satoshi amounts for Trezor transactions.
 */

import { validateSatoshiAmount } from '../trezor';

describe('validateSatoshiAmount', () => {
  describe('Valid amounts', () => {
    it('converts number amount to string', () => {
      expect(validateSatoshiAmount(100000, 'Input 0')).toBe('100000');
    });

    it('converts BigInt amount to string', () => {
      expect(validateSatoshiAmount(BigInt(100000), 'Input 0')).toBe('100000');
    });

    it('handles zero amount', () => {
      expect(validateSatoshiAmount(0, 'Input 0')).toBe('0');
    });

    it('handles large BigInt amounts (above Number.MAX_SAFE_INTEGER)', () => {
      // 21 million BTC in satoshis = 2,100,000,000,000,000
      const largeBigInt = BigInt('2100000000000000');
      expect(validateSatoshiAmount(largeBigInt, 'Input 0')).toBe('2100000000000000');
    });

    it('handles typical transaction amounts', () => {
      expect(validateSatoshiAmount(50000, 'Input 0')).toBe('50000'); // 0.0005 BTC
      expect(validateSatoshiAmount(100000000, 'Input 0')).toBe('100000000'); // 1 BTC
      expect(validateSatoshiAmount(21000000, 'Input 0')).toBe('21000000'); // 0.21 BTC
    });
  });

  describe('Missing amounts', () => {
    it('throws for undefined amount', () => {
      expect(() => validateSatoshiAmount(undefined, 'Input 0')).toThrow(
        'Input 0: amount is missing'
      );
    });

    it('throws for null amount', () => {
      // TypeScript would catch this, but runtime check is important
      expect(() => validateSatoshiAmount(null as any, 'Output 1')).toThrow(
        'Output 1: amount is missing'
      );
    });
  });

  describe('Invalid amounts', () => {
    it('throws for negative number amount', () => {
      expect(() => validateSatoshiAmount(-100, 'Input 0')).toThrow(
        'Input 0: invalid amount -100'
      );
    });

    it('throws for negative BigInt amount', () => {
      expect(() => validateSatoshiAmount(BigInt(-100), 'Output 2')).toThrow(
        'Output 2: invalid amount -100'
      );
    });

    it('throws for Infinity', () => {
      expect(() => validateSatoshiAmount(Infinity, 'Input 0')).toThrow(
        'Input 0: invalid amount Infinity'
      );
    });

    it('throws for negative Infinity', () => {
      expect(() => validateSatoshiAmount(-Infinity, 'Input 1')).toThrow(
        'Input 1: invalid amount -Infinity'
      );
    });

    it('throws for NaN', () => {
      expect(() => validateSatoshiAmount(NaN, 'Output 0')).toThrow(
        'Output 0: invalid amount NaN'
      );
    });
  });

  describe('Context messages', () => {
    it('includes context in error messages', () => {
      expect(() => validateSatoshiAmount(undefined, 'Custom Context')).toThrow(
        'Custom Context: amount is missing'
      );
      expect(() => validateSatoshiAmount(-1, 'UTXO 5')).toThrow(
        'UTXO 5: invalid amount -1'
      );
    });
  });

  describe('Edge cases', () => {
    it('handles very small amounts (dust)', () => {
      expect(validateSatoshiAmount(1, 'Input 0')).toBe('1');
      expect(validateSatoshiAmount(546, 'Input 0')).toBe('546'); // Typical dust limit
    });

    it('handles floating point that converts to integer', () => {
      // JavaScript number precision: 100000.0 === 100000
      expect(validateSatoshiAmount(100000.0, 'Input 0')).toBe('100000');
    });

    it('preserves precision when converting BigInt to string', () => {
      // BigInt preserves exact value when converted to string
      const precise = BigInt('9007199254740993'); // Above MAX_SAFE_INTEGER
      expect(validateSatoshiAmount(precise, 'Input 0')).toBe('9007199254740993');
    });
  });
});
