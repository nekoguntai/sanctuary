/**
 * Tests for utils/urPsbt.ts
 *
 * Tests the utility functions for UR format detection and parsing.
 * Note: The encoding/decoding functions require complex external library mocking
 * and are better tested via integration tests with actual hardware wallet flows.
 */

import { describe, it, expect } from 'vitest';
import {
  isUrFormat,
  getUrType,
} from '../../utils/urPsbt';

describe('urPsbt', () => {
  describe('isUrFormat', () => {
    it('returns true for ur: prefix', () => {
      expect(isUrFormat('ur:crypto-psbt/...')).toBe(true);
    });

    it('returns true for uppercase UR: prefix', () => {
      expect(isUrFormat('UR:crypto-psbt/...')).toBe(true);
    });

    it('returns true for mixed case Ur: prefix', () => {
      expect(isUrFormat('Ur:crypto-psbt/...')).toBe(true);
    });

    it('returns false for non-ur strings', () => {
      expect(isUrFormat('bitcoin:bc1q...')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isUrFormat('')).toBe(false);
    });

    it('returns false for string starting with ur but no colon', () => {
      expect(isUrFormat('uranium')).toBe(false);
    });

    it('returns true for ur:bytes format', () => {
      expect(isUrFormat('ur:bytes/abc123')).toBe(true);
    });

    it('returns true for ur:crypto-account format', () => {
      expect(isUrFormat('ur:crypto-account/xyz789')).toBe(true);
    });

    it('returns true for multi-part UR strings', () => {
      expect(isUrFormat('ur:crypto-psbt/1-5/abc123def')).toBe(true);
    });
  });

  describe('getUrType', () => {
    it('extracts crypto-psbt type', () => {
      expect(getUrType('ur:crypto-psbt/abc123')).toBe('crypto-psbt');
    });

    it('extracts bytes type', () => {
      expect(getUrType('ur:bytes/abc123')).toBe('bytes');
    });

    it('extracts crypto-account type', () => {
      expect(getUrType('ur:crypto-account/xyz789')).toBe('crypto-account');
    });

    it('extracts crypto-hdkey type', () => {
      expect(getUrType('ur:crypto-hdkey/data')).toBe('crypto-hdkey');
    });

    it('extracts crypto-output type', () => {
      expect(getUrType('ur:crypto-output/descriptor')).toBe('crypto-output');
    });

    it('handles uppercase input', () => {
      expect(getUrType('UR:CRYPTO-PSBT/ABC123')).toBe('crypto-psbt');
    });

    it('handles mixed case input', () => {
      expect(getUrType('Ur:Crypto-PSBT/Data')).toBe('crypto-psbt');
    });

    it('returns null for invalid format', () => {
      expect(getUrType('not-a-ur-string')).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(getUrType('')).toBe(null);
    });

    it('returns null for ur: without type', () => {
      expect(getUrType('ur:')).toBe(null);
    });

    it('returns null for ur:/ without type', () => {
      expect(getUrType('ur:/')).toBe(null);
    });

    it('handles types with numbers', () => {
      expect(getUrType('ur:crypto-hdkey-1/xyz')).toBe('crypto-hdkey-1');
    });

    it('handles multi-part UR strings (extracts type before part number)', () => {
      expect(getUrType('ur:crypto-psbt/1-5/abc')).toBe('crypto-psbt');
    });

    it('handles simple type with data', () => {
      expect(getUrType('ur:bytes/00112233')).toBe('bytes');
    });
  });

  describe('edge cases', () => {
    it('isUrFormat handles whitespace prefix', () => {
      expect(isUrFormat(' ur:crypto-psbt/data')).toBe(false);
    });

    it('isUrFormat handles newline in string', () => {
      expect(isUrFormat('ur:crypto-psbt/line1\nline2')).toBe(true);
    });

    it('getUrType handles special characters in data portion', () => {
      expect(getUrType('ur:crypto-psbt/abc!@#$%')).toBe('crypto-psbt');
    });

    it('getUrType returns correct type for long data', () => {
      const longData = 'a'.repeat(1000);
      expect(getUrType(`ur:bytes/${longData}`)).toBe('bytes');
    });
  });
});
