import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// Configure TOTP settings
authenticator.options = {
  window: 1, // Allow 1 step before/after for clock drift
};

const ISSUER = 'Sanctuary';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

/**
 * Generate a new TOTP secret and QR code for 2FA setup
 */
export async function generateSecret(username: string): Promise<{
  secret: string;
  qrCodeDataUrl: string;
}> {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(username, ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { secret, qrCodeDataUrl };
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyToken(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/**
 * Generate random backup codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Generate 8 character alphanumeric code
    const code = crypto
      .randomBytes(BACKUP_CODE_LENGTH)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, BACKUP_CODE_LENGTH)
      .toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash backup codes for secure storage
 */
export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashedCodes = await Promise.all(
    codes.map(async (code) => ({
      hash: await bcrypt.hash(code.toUpperCase(), 10),
      used: false,
    }))
  );
  return JSON.stringify(hashedCodes);
}

/**
 * Verify a backup code and mark it as used if valid
 * Returns the updated hashed codes string if valid, null if invalid
 */
export async function verifyBackupCode(
  hashedCodesJson: string | null,
  inputCode: string
): Promise<{ valid: boolean; updatedCodesJson: string | null }> {
  if (!hashedCodesJson) {
    return { valid: false, updatedCodesJson: null };
  }

  try {
    const codes: Array<{ hash: string; used: boolean }> = JSON.parse(hashedCodesJson);
    const normalizedInput = inputCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

    for (let i = 0; i < codes.length; i++) {
      if (codes[i].used) continue;

      const match = await bcrypt.compare(normalizedInput, codes[i].hash);
      if (match) {
        // Mark code as used
        codes[i].used = true;
        return { valid: true, updatedCodesJson: JSON.stringify(codes) };
      }
    }

    return { valid: false, updatedCodesJson: null };
  } catch {
    return { valid: false, updatedCodesJson: null };
  }
}

/**
 * Get the count of remaining (unused) backup codes
 */
export function getRemainingBackupCodeCount(hashedCodesJson: string | null): number {
  if (!hashedCodesJson) return 0;

  try {
    const codes: Array<{ hash: string; used: boolean }> = JSON.parse(hashedCodesJson);
    return codes.filter((c) => !c.used).length;
  } catch {
    return 0;
  }
}

/**
 * Check if a code looks like a backup code (8 alphanumeric chars) vs TOTP (6 digits)
 */
export function isBackupCode(code: string): boolean {
  const normalized = code.replace(/[^A-Z0-9]/gi, '');
  // TOTP codes are 6 digits, backup codes are 8 alphanumeric
  return normalized.length === BACKUP_CODE_LENGTH && !/^\d+$/.test(normalized);
}

export default {
  generateSecret,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  getRemainingBackupCodeCount,
  isBackupCode,
};
