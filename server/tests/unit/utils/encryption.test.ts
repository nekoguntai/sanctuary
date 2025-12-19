/**
 * Encryption Utilities Tests
 *
 * Tests for AES-256-GCM encryption/decryption functions used to protect
 * sensitive data like node configuration passwords.
 */

describe('Encryption Utilities', () => {
  // Store original env before any changes
  const originalEnv = process.env.ENCRYPTION_KEY;

  // Set up encryption key before running tests - must be at least 32 characters
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-for-testing-only';
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  // Helper to get fresh module for each test group
  const getEncryptionModule = () => {
    // Clear module cache to get fresh module with current env
    jest.resetModules();
    return require('../../../src/utils/encryption');
  };

  describe('encrypt', () => {
    it('should encrypt a plaintext string', () => {
      const { encrypt } = getEncryptionModule();
      const plaintext = 'my secret password';
      const encrypted = encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const { encrypt } = getEncryptionModule();
      const plaintext = 'same text twice';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce output in iv:authTag:ciphertext format', () => {
      const { encrypt } = getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      // Each part should be valid base64
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      expect(parts[0]).toMatch(base64Regex); // IV
      expect(parts[1]).toMatch(base64Regex); // Auth Tag
      expect(parts[2]).toMatch(base64Regex); // Ciphertext
    });

    it('should handle empty string', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const encrypted = encrypt('');
      expect(encrypted).toBeDefined();

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'Password with unicode symbols!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'A'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle JSON strings', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const jsonData = JSON.stringify({
        username: 'admin',
        password: 'secret123',
        nested: { key: 'value' },
      });
      const encrypted = encrypt(jsonData);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(jsonData);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonData));
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted string', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'my secret password';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error for invalid format (wrong number of parts)', () => {
      const { decrypt } = getEncryptionModule();
      expect(() => decrypt('invalid-string')).toThrow('Invalid encrypted string format');
      expect(() => decrypt('part1:part2')).toThrow('Invalid encrypted string format');
      expect(() => decrypt('part1:part2:part3:part4')).toThrow('Invalid encrypted string format');
    });

    it('should throw error for tampered ciphertext', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with ciphertext
      const tamperedCiphertext = 'YWJj' + parts[2].substring(4); // Replace start of ciphertext
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw error for tampered auth tag', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');

      // Tamper with auth tag
      const tamperedAuthTag = 'AAAAAAAAAAAAAAAAAAAAAA==';
      const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw error for invalid base64 in IV', () => {
      const { decrypt } = getEncryptionModule();
      expect(() => decrypt('!!!invalid!!!:dGVzdA==:dGVzdA==')).toThrow();
    });
  });

  describe('isEncrypted', () => {
    it('should return true for properly formatted encrypted strings', () => {
      const { encrypt, isEncrypted } = getEncryptionModule();
      const encrypted = encrypt('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for null or undefined', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted(null as any)).toBe(false);
      expect(isEncrypted(undefined as any)).toBe(false);
    });

    it('should return false for empty string', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for plaintext', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted('plaintext password')).toBe(false);
      expect(isEncrypted('simple string')).toBe(false);
    });

    it('should return false for strings with wrong number of colons', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted('no:colons:here:extra')).toBe(false);
      expect(isEncrypted('only:one')).toBe(false);
    });

    it('should return false for non-base64 parts', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted('invalid!!!:invalid!!!:invalid!!!')).toBe(false);
    });

    it('should return false for empty parts', () => {
      const { isEncrypted } = getEncryptionModule();
      expect(isEncrypted('::dGVzdA==')).toBe(false);
      expect(isEncrypted('dGVzdA==::')).toBe(false);
    });

    it('should return true for valid base64 format with colons', () => {
      const { isEncrypted } = getEncryptionModule();
      // Valid base64 parts
      expect(isEncrypted('dGVzdA==:dGVzdA==:dGVzdA==')).toBe(true);
    });
  });

  describe('decryptIfEncrypted', () => {
    it('should decrypt encrypted values', () => {
      const { encrypt, decryptIfEncrypted } = getEncryptionModule();
      const plaintext = 'secret password';
      const encrypted = encrypt(plaintext);

      const result = decryptIfEncrypted(encrypted);
      expect(result).toBe(plaintext);
    });

    it('should return plaintext values unchanged', () => {
      const { decryptIfEncrypted } = getEncryptionModule();
      const plaintext = 'not encrypted';
      const result = decryptIfEncrypted(plaintext);

      expect(result).toBe(plaintext);
    });

    it('should handle legacy unencrypted passwords', () => {
      const { decryptIfEncrypted } = getEncryptionModule();
      // Simulates backward compatibility with pre-encryption passwords
      const legacyPassword = 'old-plaintext-password';
      const result = decryptIfEncrypted(legacyPassword);

      expect(result).toBe(legacyPassword);
    });

    it('should handle strings that look like encrypted but are not valid', () => {
      const { isEncrypted, decryptIfEncrypted } = getEncryptionModule();
      // This has the format but invalid content
      const fakeEncrypted = 'YWJj:ZGVm:Z2hp';

      // isEncrypted returns true because format matches
      expect(isEncrypted(fakeEncrypted)).toBe(true);

      // But decryption will fail, so this should throw
      expect(() => decryptIfEncrypted(fakeEncrypted)).toThrow();
    });
  });

  describe('validateEncryptionKey', () => {
    it('should not throw when encryption key is valid', () => {
      const { validateEncryptionKey } = getEncryptionModule();
      expect(() => validateEncryptionKey()).not.toThrow();
    });
  });

  describe('encryption key validation', () => {
    it('should use consistent key derivation for encrypt/decrypt cycle', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      // Verify that multiple encrypt/decrypt cycles work
      for (let i = 0; i < 5; i++) {
        const plaintext = `test message ${i}`;
        const encrypted = encrypt(plaintext);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });
  });

  describe('edge cases and security', () => {
    it('should handle newlines in plaintext', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'line1\nline2\r\nline3';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle null bytes in plaintext', () => {
      const { encrypt, decrypt } = getEncryptionModule();
      const plaintext = 'before\x00after';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce deterministic output length based on input', () => {
      const { encrypt } = getEncryptionModule();
      // The ciphertext length should correlate with plaintext length
      const short = encrypt('a');
      const medium = encrypt('a'.repeat(100));
      const long = encrypt('a'.repeat(1000));

      expect(short.length).toBeLessThan(medium.length);
      expect(medium.length).toBeLessThan(long.length);
    });
  });
});
