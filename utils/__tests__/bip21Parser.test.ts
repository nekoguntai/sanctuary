/**
 * BIP21 Parser Tests
 *
 * Tests precision-safe conversion from BTC to satoshis.
 * The parser uses string manipulation to avoid floating-point errors
 * (e.g., 0.1 * 100000000 = 10000000.000000001 in JavaScript).
 */

import { parseBip21Uri, isBip21Uri } from '../bip21Parser';

describe('bip21Parser', () => {
  describe('parseBip21Uri', () => {
    describe('Basic URI parsing', () => {
      it('parses address-only URI', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123');
        expect(result).toEqual({
          address: 'bc1qtest123',
        });
      });

      it('parses uppercase BITCOIN prefix', () => {
        const result = parseBip21Uri('BITCOIN:bc1qtest123');
        expect(result).toEqual({
          address: 'bc1qtest123',
        });
      });

      it('returns null for non-BIP21 strings', () => {
        expect(parseBip21Uri('bc1qtest123')).toBeNull();
        expect(parseBip21Uri('not a uri')).toBeNull();
        expect(parseBip21Uri('')).toBeNull();
      });

      it('parses URI with label and message', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qtest123?label=Test%20Payment&message=Hello%20World'
        );
        expect(result).toEqual({
          address: 'bc1qtest123',
          label: 'Test Payment',
          message: 'Hello World',
        });
      });

      it('parses URI with payjoin URL', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qtest123?pj=https%3A%2F%2Fpayjoin.example.com%2Fpj'
        );
        expect(result).toEqual({
          address: 'bc1qtest123',
          payjoinUrl: 'https://payjoin.example.com/pj',
        });
      });
    });

    describe('Amount precision (BTC to satoshis)', () => {
      it('converts 0.1 BTC to exactly 10000000 satoshis (no floating point error)', () => {
        // This is the critical test - parseFloat(0.1) * 100000000 = 10000000.000000001
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.1');
        expect(result?.amount).toBe(10000000);
        // Verify it's exactly an integer, not a float like 10000000.000000001
        expect(Number.isInteger(result?.amount)).toBe(true);
      });

      it('converts 0.00000001 BTC to exactly 1 satoshi', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.00000001');
        expect(result?.amount).toBe(1);
      });

      it('converts 1 BTC to exactly 100000000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=1');
        expect(result?.amount).toBe(100000000);
      });

      it('converts 1.0 BTC to exactly 100000000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=1.0');
        expect(result?.amount).toBe(100000000);
      });

      it('converts 1.00000000 BTC to exactly 100000000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=1.00000000');
        expect(result?.amount).toBe(100000000);
      });

      it('converts 0.001 BTC to exactly 100000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.001');
        expect(result?.amount).toBe(100000);
      });

      it('converts 0.00001 BTC to exactly 1000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.00001');
        expect(result?.amount).toBe(1000);
      });

      it('converts 21 BTC to exactly 2100000000 satoshis', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=21');
        expect(result?.amount).toBe(2100000000);
      });

      it('converts 21.21 BTC correctly', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=21.21');
        expect(result?.amount).toBe(2121000000);
      });

      it('handles 0.3 BTC without floating point error', () => {
        // 0.3 * 100000000 = 29999999.999999996 in JavaScript
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.3');
        expect(result?.amount).toBe(30000000);
        expect(Number.isInteger(result?.amount)).toBe(true);
      });

      it('handles 0.7 BTC without floating point error', () => {
        // 0.7 * 100000000 = 69999999.99999999 in JavaScript
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.7');
        expect(result?.amount).toBe(70000000);
        expect(Number.isInteger(result?.amount)).toBe(true);
      });

      it('handles very small amount 0.00000002 BTC', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.00000002');
        expect(result?.amount).toBe(2);
      });

      it('handles amount with whitespace', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=  0.5  ');
        expect(result?.amount).toBe(50000000);
      });

      it('handles zero amount', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0');
        expect(result?.amount).toBe(0);
      });

      it('handles 0.0 amount', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.0');
        expect(result?.amount).toBe(0);
      });

      it('handles amount with only decimal part', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=.5');
        expect(result?.amount).toBe(50000000);
      });

      it('handles large integer amount', () => {
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=1000');
        expect(result?.amount).toBe(100000000000);
      });

      it('truncates excess decimal places (satoshi precision limit)', () => {
        // BIP21 amounts are in BTC with max 8 decimal places
        // Extra precision should be truncated, not rounded
        const result = parseBip21Uri('bitcoin:bc1qtest123?amount=0.000000019');
        expect(result?.amount).toBe(1); // 0.00000001 = 1 sat, 9 is beyond precision
      });
    });

    describe('Combined parameters', () => {
      it('parses URI with amount and payjoin', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qtest123?amount=0.1&pj=https%3A%2F%2Fpayjoin.example.com'
        );
        expect(result).toEqual({
          address: 'bc1qtest123',
          amount: 10000000,
          payjoinUrl: 'https://payjoin.example.com',
        });
      });

      it('parses URI with all parameters', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qtest123?amount=0.5&label=Donation&message=Thank%20you&pj=https%3A%2F%2Fexample.com%2Fpj'
        );
        expect(result).toEqual({
          address: 'bc1qtest123',
          amount: 50000000,
          label: 'Donation',
          message: 'Thank you',
          payjoinUrl: 'https://example.com/pj',
        });
      });
    });
  });

  describe('isBip21Uri', () => {
    it('returns true for bitcoin: prefix', () => {
      expect(isBip21Uri('bitcoin:bc1qtest')).toBe(true);
    });

    it('returns true for BITCOIN: prefix (case insensitive)', () => {
      expect(isBip21Uri('BITCOIN:bc1qtest')).toBe(true);
      expect(isBip21Uri('Bitcoin:bc1qtest')).toBe(true);
    });

    it('returns false for non-bitcoin URIs', () => {
      expect(isBip21Uri('bc1qtest')).toBe(false);
      expect(isBip21Uri('ethereum:0x123')).toBe(false);
      expect(isBip21Uri('')).toBe(false);
    });
  });
});
