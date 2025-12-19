/**
 * Two-Factor Authentication Service Tests
 *
 * Tests for TOTP generation, verification, and backup codes.
 */

import * as bcrypt from 'bcryptjs';

// Import the service
import {
  generateSecret,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  getRemainingBackupCodeCount,
  isBackupCode,
} from '../../../src/services/twoFactorService';

describe('Two-Factor Authentication Service', () => {
  describe('Secret Generation', () => {
    it('should generate a secret and QR code', async () => {
      const username = 'testuser';
      const result = await generateSecret(username);

      expect(result.secret).toBeDefined();
      expect(typeof result.secret).toBe('string');
      expect(result.secret.length).toBeGreaterThan(0);

      expect(result.qrCodeDataUrl).toBeDefined();
      expect(result.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('should generate unique secrets each time', async () => {
      const username = 'testuser';
      const result1 = await generateSecret(username);
      const result2 = await generateSecret(username);

      expect(result1.secret).not.toBe(result2.secret);
    });

    it('should generate Base32 encoded secret', async () => {
      const result = await generateSecret('testuser');

      // Base32 characters: A-Z and 2-7
      const base32Regex = /^[A-Z2-7]+$/;
      expect(base32Regex.test(result.secret)).toBe(true);
    });
  });

  describe('Token Verification', () => {
    // Use a known test secret
    const testSecret = 'JBSWY3DPEHPK3PXP'; // Base32 encoded

    it('should reject invalid token format', () => {
      expect(verifyToken(testSecret, 'invalid')).toBe(false);
      expect(verifyToken(testSecret, '12345')).toBe(false); // Too short
      expect(verifyToken(testSecret, '12345678')).toBe(false); // Too long
      expect(verifyToken(testSecret, 'abcdef')).toBe(false); // Not numeric
    });

    it('should reject token with invalid secret', () => {
      expect(verifyToken('', '123456')).toBe(false);
      expect(verifyToken('invalid-secret', '123456')).toBe(false);
    });

    it('should handle 6-digit token format', () => {
      // We can't test actual TOTP validation without time-based tokens,
      // but we can verify the format handling
      const result = verifyToken(testSecret, '000000');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Backup Codes Generation', () => {
    it('should generate 10 backup codes', () => {
      const codes = generateBackupCodes();

      expect(codes.length).toBe(10);
    });

    it('should generate 8-character alphanumeric codes', () => {
      const codes = generateBackupCodes();

      codes.forEach((code) => {
        expect(code.length).toBe(8);
        expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
      });
    });

    it('should generate unique codes', () => {
      const codes = generateBackupCodes();
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('should generate different codes each time', () => {
      const codes1 = generateBackupCodes();
      const codes2 = generateBackupCodes();

      // Very unlikely to have any matching codes
      const matching = codes1.filter((c) => codes2.includes(c));
      expect(matching.length).toBe(0);
    });
  });

  describe('Backup Codes Hashing', () => {
    it('should hash all backup codes', async () => {
      const codes = generateBackupCodes();
      const hashedJson = await hashBackupCodes(codes);

      expect(typeof hashedJson).toBe('string');

      const parsed = JSON.parse(hashedJson);
      expect(parsed.length).toBe(codes.length);

      parsed.forEach((entry: { hash: string; used: boolean }) => {
        expect(entry.hash).toBeDefined();
        expect(entry.hash.startsWith('$2a$') || entry.hash.startsWith('$2b$')).toBe(true);
        expect(entry.used).toBe(false);
      });
    });

    it('should produce different hashes for same codes', async () => {
      const codes = ['TESTCODE'];
      const hashed1 = await hashBackupCodes(codes);
      const hashed2 = await hashBackupCodes(codes);

      const parsed1 = JSON.parse(hashed1);
      const parsed2 = JSON.parse(hashed2);

      expect(parsed1[0].hash).not.toBe(parsed2[0].hash);
    });
  });

  describe('Backup Code Verification', () => {
    let codes: string[];
    let hashedCodesJson: string;

    beforeEach(async () => {
      codes = generateBackupCodes();
      hashedCodesJson = await hashBackupCodes(codes);
    });

    it('should verify valid backup code', async () => {
      const codeToVerify = codes[0];
      const result = await verifyBackupCode(hashedCodesJson, codeToVerify);

      expect(result.valid).toBe(true);
      expect(result.updatedCodesJson).toBeDefined();
    });

    it('should mark code as used after verification', async () => {
      const codeToVerify = codes[0];
      const result = await verifyBackupCode(hashedCodesJson, codeToVerify);

      expect(result.valid).toBe(true);

      const updatedCodes = JSON.parse(result.updatedCodesJson!);
      expect(updatedCodes[0].used).toBe(true);
    });

    it('should reject already used code', async () => {
      const codeToVerify = codes[0];

      // First use
      const result1 = await verifyBackupCode(hashedCodesJson, codeToVerify);
      expect(result1.valid).toBe(true);

      // Second use should fail
      const result2 = await verifyBackupCode(result1.updatedCodesJson!, codeToVerify);
      expect(result2.valid).toBe(false);
    });

    it('should reject invalid backup code', async () => {
      const result = await verifyBackupCode(hashedCodesJson, 'WRONGCODE');

      expect(result.valid).toBe(false);
      expect(result.updatedCodesJson).toBeNull();
    });

    it('should handle null hashed codes', async () => {
      const result = await verifyBackupCode(null, 'ANYCODE');

      expect(result.valid).toBe(false);
    });

    it('should handle invalid JSON', async () => {
      const result = await verifyBackupCode('not-json', 'ANYCODE');

      expect(result.valid).toBe(false);
    });

    it('should be case-insensitive for backup codes', async () => {
      const codeToVerify = codes[0].toLowerCase();
      const result = await verifyBackupCode(hashedCodesJson, codeToVerify);

      expect(result.valid).toBe(true);
    });

    it('should ignore non-alphanumeric characters in input', async () => {
      const codeWithDashes = codes[0].slice(0, 4) + '-' + codes[0].slice(4);
      const result = await verifyBackupCode(hashedCodesJson, codeWithDashes);

      expect(result.valid).toBe(true);
    });
  });

  describe('Remaining Backup Codes Count', () => {
    it('should return count of unused codes', async () => {
      const codes = generateBackupCodes();
      const hashedJson = await hashBackupCodes(codes);

      const count = getRemainingBackupCodeCount(hashedJson);

      expect(count).toBe(10);
    });

    it('should decrease count after code is used', async () => {
      const codes = generateBackupCodes();
      let hashedJson = await hashBackupCodes(codes);

      expect(getRemainingBackupCodeCount(hashedJson)).toBe(10);

      // Use first code
      const result = await verifyBackupCode(hashedJson, codes[0]);
      hashedJson = result.updatedCodesJson!;

      expect(getRemainingBackupCodeCount(hashedJson)).toBe(9);
    });

    it('should return 0 for null input', () => {
      expect(getRemainingBackupCodeCount(null)).toBe(0);
    });

    it('should return 0 for invalid JSON', () => {
      expect(getRemainingBackupCodeCount('not-json')).toBe(0);
    });

    it('should handle all codes used', async () => {
      // Create mock with all used
      const usedCodes = [
        { hash: await bcrypt.hash('CODE1234', 10), used: true },
        { hash: await bcrypt.hash('CODE5678', 10), used: true },
      ];
      const hashedJson = JSON.stringify(usedCodes);

      expect(getRemainingBackupCodeCount(hashedJson)).toBe(0);
    });
  });

  describe('Backup Code Detection', () => {
    it('should identify backup code format', () => {
      expect(isBackupCode('ABCD1234')).toBe(true);
      expect(isBackupCode('abcd1234')).toBe(true);
      expect(isBackupCode('AAAA1111')).toBe(true);
    });

    it('should identify TOTP code format (6 digits)', () => {
      expect(isBackupCode('123456')).toBe(false);
      expect(isBackupCode('000000')).toBe(false);
      expect(isBackupCode('999999')).toBe(false);
    });

    it('should handle codes with dashes/spaces', () => {
      expect(isBackupCode('ABCD-1234')).toBe(true);
      expect(isBackupCode('ABCD 1234')).toBe(true);
    });

    it('should reject wrong length codes', () => {
      expect(isBackupCode('ABC')).toBe(false);
      expect(isBackupCode('ABCDEFGHIJ')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isBackupCode('')).toBe(false);
      expect(isBackupCode('12345678')).toBe(false); // All numeric = could be TOTP
    });
  });

  describe('Security Properties', () => {
    it('should use sufficient salt rounds for backup codes', async () => {
      const codes = ['TESTCODE'];
      const hashedJson = await hashBackupCodes(codes);
      const parsed = JSON.parse(hashedJson);

      // bcrypt hash should indicate 10 rounds ($2a$10$ or $2b$10$)
      expect(parsed[0].hash).toMatch(/^\$2[ab]\$10\$/);
    });

    it('should generate cryptographically random backup codes', () => {
      // Generate many codes and check distribution
      const allCodes: string[] = [];
      for (let i = 0; i < 100; i++) {
        allCodes.push(...generateBackupCodes());
      }

      // Check that we have reasonable character distribution
      const charCounts: Record<string, number> = {};
      allCodes.join('').split('').forEach((char) => {
        charCounts[char] = (charCounts[char] || 0) + 1;
      });

      // Should have variety of characters (A-Z, 0-9)
      const uniqueChars = Object.keys(charCounts).length;
      expect(uniqueChars).toBeGreaterThan(20); // Should use most of the 36 possible chars
    });
  });
});
