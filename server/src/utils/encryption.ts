import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// Salt for key derivation - configurable via environment variable
// IMPORTANT: Changing this will invalidate all existing encrypted data
function getEncryptionSalt(): string {
  const salt = process.env.ENCRYPTION_SALT;
  if (!salt) {
    // Fall back to default for backward compatibility with existing installations
    // New installations should set ENCRYPTION_SALT for better security
    console.warn('');
    console.warn('SECURITY WARNING: ENCRYPTION_SALT environment variable is not set.');
    console.warn('Using default salt for backward compatibility.');
    console.warn('For better security, set a unique ENCRYPTION_SALT in your environment.');
    console.warn('');
    console.warn('CAUTION: If you set ENCRYPTION_SALT after data has been encrypted,');
    console.warn('existing encrypted data (like node passwords) will become unreadable.');
    console.warn('You will need to re-enter those values after changing the salt.');
    console.warn('');
    return 'sanctuary-node-config'; // Default for backward compatibility
  }
  return salt;
}

let encryptionKeyCache: Buffer | null = null;
let encryptionSaltCache: string | null = null;

function getEncryptionKey(): Buffer {
  // Get the salt (cached after first call with warning)
  const currentSalt = getEncryptionSalt();

  // If salt changed, invalidate the key cache
  if (encryptionSaltCache !== null && encryptionSaltCache !== currentSalt) {
    encryptionKeyCache = null;
  }
  encryptionSaltCache = currentSalt;

  if (encryptionKeyCache) {
    return encryptionKeyCache;
  }

  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY environment variable must be set and at least 32 characters long'
    );
  }

  encryptionKeyCache = crypto.scryptSync(key, currentSalt, 32);
  return encryptionKeyCache;
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an encrypted string
 * @param encrypted String in format: iv:authTag:ciphertext (all base64)
 */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format');
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  return (
    decipher.update(ciphertextB64, 'base64', 'utf8') + decipher.final('utf8')
  );
}

/**
 * Check if a string appears to be encrypted (matches our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;

  const parts = value.split(':');
  if (parts.length !== 3) return false;

  // Check each part is valid base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return parts.every((p) => p.length > 0 && base64Regex.test(p));
}

/**
 * Decrypt a value if it's encrypted, otherwise return as-is
 * Useful for backward compatibility with existing plaintext passwords
 */
export function decryptIfEncrypted(value: string): string {
  if (isEncrypted(value)) {
    return decrypt(value);
  }
  return value;
}

/**
 * Validate that the encryption key is configured
 * Call this at startup to fail fast if key is missing
 */
export function validateEncryptionKey(): void {
  getEncryptionKey();
}
