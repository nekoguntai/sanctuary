/**
 * DeviceDetail Component Tests
 *
 * Tests for the account type configuration, helper functions, and import logic
 */

import { describe, it, expect } from 'vitest';

// Replicate the types and config from DeviceDetail for testing
interface DeviceAccount {
  id: string;
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

interface Device {
  id: string;
  type: string;
  label: string;
  fingerprint: string;
  derivationPath?: string;
  xpub?: string;
  accounts?: DeviceAccount[];
}

// Enum to match WalletType
enum WalletType {
  SINGLE_SIG = 'single_sig',
  MULTI_SIG = 'multi_sig',
}

interface AccountTypeInfo {
  title: string;
  description: string;
  addressPrefix: string;
  recommended?: boolean;
}

const ACCOUNT_TYPE_CONFIG: Record<string, AccountTypeInfo> = {
  // Single-sig accounts
  'single_sig:native_segwit': {
    title: 'Native SegWit (BIP-84)',
    description: 'Most common modern address type. Lower fees than legacy.',
    addressPrefix: 'bc1q...',
    recommended: true,
  },
  'single_sig:taproot': {
    title: 'Taproot (BIP-86)',
    description: 'Latest address type with enhanced privacy and smart contract capabilities.',
    addressPrefix: 'bc1p...',
  },
  'single_sig:nested_segwit': {
    title: 'Nested SegWit (BIP-49)',
    description: 'SegWit wrapped in legacy format for compatibility with older software.',
    addressPrefix: '3...',
  },
  'single_sig:legacy': {
    title: 'Legacy (BIP-44)',
    description: 'Original Bitcoin address format. Higher fees but maximum compatibility.',
    addressPrefix: '1...',
  },
  // Multisig accounts
  'multisig:native_segwit': {
    title: 'Multisig Native SegWit (BIP-48)',
    description: 'For multi-signature wallets. Most efficient fee-wise.',
    addressPrefix: 'bc1q...',
    recommended: true,
  },
  'multisig:nested_segwit': {
    title: 'Multisig Nested SegWit (BIP-48)',
    description: 'For multi-signature wallets with better legacy software compatibility.',
    addressPrefix: '3...',
  },
};

function getAccountTypeInfo(account: DeviceAccount): AccountTypeInfo {
  const key = `${account.purpose}:${account.scriptType}`;
  return ACCOUNT_TYPE_CONFIG[key] || {
    title: 'Unknown Format',
    description: account.derivationPath,
    addressPrefix: '?',
  };
}

describe('DeviceDetail', () => {
  describe('ACCOUNT_TYPE_CONFIG', () => {
    it('has all single-sig script types defined', () => {
      expect(ACCOUNT_TYPE_CONFIG['single_sig:native_segwit']).toBeDefined();
      expect(ACCOUNT_TYPE_CONFIG['single_sig:taproot']).toBeDefined();
      expect(ACCOUNT_TYPE_CONFIG['single_sig:nested_segwit']).toBeDefined();
      expect(ACCOUNT_TYPE_CONFIG['single_sig:legacy']).toBeDefined();
    });

    it('has multisig script types defined', () => {
      expect(ACCOUNT_TYPE_CONFIG['multisig:native_segwit']).toBeDefined();
      expect(ACCOUNT_TYPE_CONFIG['multisig:nested_segwit']).toBeDefined();
    });

    it('marks recommended account types', () => {
      expect(ACCOUNT_TYPE_CONFIG['single_sig:native_segwit'].recommended).toBe(true);
      expect(ACCOUNT_TYPE_CONFIG['multisig:native_segwit'].recommended).toBe(true);
      // Others should not be recommended
      expect(ACCOUNT_TYPE_CONFIG['single_sig:legacy'].recommended).toBeUndefined();
    });

    it('has correct address prefixes for each type', () => {
      expect(ACCOUNT_TYPE_CONFIG['single_sig:native_segwit'].addressPrefix).toBe('bc1q...');
      expect(ACCOUNT_TYPE_CONFIG['single_sig:taproot'].addressPrefix).toBe('bc1p...');
      expect(ACCOUNT_TYPE_CONFIG['single_sig:nested_segwit'].addressPrefix).toBe('3...');
      expect(ACCOUNT_TYPE_CONFIG['single_sig:legacy'].addressPrefix).toBe('1...');
    });
  });

  describe('getAccountTypeInfo', () => {
    const createAccount = (
      purpose: 'single_sig' | 'multisig',
      scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy',
      derivationPath: string = "m/84'/0'/0'"
    ): DeviceAccount => ({
      id: 'test-id',
      purpose,
      scriptType,
      derivationPath,
      xpub: 'xpub123...',
    });

    it('returns correct info for single-sig native segwit', () => {
      const account = createAccount('single_sig', 'native_segwit', "m/84'/0'/0'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Native SegWit (BIP-84)');
      expect(info.addressPrefix).toBe('bc1q...');
      expect(info.recommended).toBe(true);
    });

    it('returns correct info for single-sig taproot', () => {
      const account = createAccount('single_sig', 'taproot', "m/86'/0'/0'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Taproot (BIP-86)');
      expect(info.addressPrefix).toBe('bc1p...');
    });

    it('returns correct info for single-sig nested segwit', () => {
      const account = createAccount('single_sig', 'nested_segwit', "m/49'/0'/0'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Nested SegWit (BIP-49)');
      expect(info.addressPrefix).toBe('3...');
    });

    it('returns correct info for single-sig legacy', () => {
      const account = createAccount('single_sig', 'legacy', "m/44'/0'/0'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Legacy (BIP-44)');
      expect(info.addressPrefix).toBe('1...');
    });

    it('returns correct info for multisig native segwit', () => {
      const account = createAccount('multisig', 'native_segwit', "m/48'/0'/0'/2'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Multisig Native SegWit (BIP-48)');
      expect(info.addressPrefix).toBe('bc1q...');
      expect(info.recommended).toBe(true);
    });

    it('returns correct info for multisig nested segwit', () => {
      const account = createAccount('multisig', 'nested_segwit', "m/48'/0'/0'/1'");
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Multisig Nested SegWit (BIP-48)');
      expect(info.addressPrefix).toBe('3...');
    });

    it('returns fallback for unknown account types', () => {
      // Force an unknown type by casting
      const account = {
        id: 'test',
        purpose: 'unknown' as 'single_sig',
        scriptType: 'unknown' as 'native_segwit',
        derivationPath: "m/999'/0'/0'",
        xpub: 'xpub...',
      };
      const info = getAccountTypeInfo(account);

      expect(info.title).toBe('Unknown Format');
      expect(info.description).toBe("m/999'/0'/0'");
      expect(info.addressPrefix).toBe('?');
    });
  });

  // Helper functions from CreateWallet for device filtering
  describe('hasCompatibleAccount', () => {
    /**
     * Check if a device has an account compatible with the wallet type
     * Replicates logic from CreateWallet.tsx
     */
    const hasCompatibleAccount = (device: Device, type: WalletType): boolean => {
      if (!device.accounts || device.accounts.length === 0) {
        // Legacy devices without accounts array - check derivationPath
        // m/48' paths are multisig (BIP-48), m/44'/49'/84'/86' are single-sig
        const path = device.derivationPath || '';
        const isMultisigPath = path.includes("48'");
        return type === WalletType.MULTI_SIG ? isMultisigPath : !isMultisigPath;
      }

      const requiredPurpose = type === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';
      return device.accounts.some(a => a.purpose === requiredPurpose);
    };

    const createDevice = (
      accounts?: DeviceAccount[],
      derivationPath?: string
    ): Device => ({
      id: 'test-device',
      type: 'trezor',
      label: 'Test Device',
      fingerprint: 'abcd1234',
      derivationPath,
      accounts,
    });

    const createAccount = (purpose: 'single_sig' | 'multisig', path: string): DeviceAccount => ({
      id: 'acc-1',
      purpose,
      scriptType: 'native_segwit',
      derivationPath: path,
      xpub: 'xpub...',
    });

    it('returns true for device with single-sig account and SINGLE_SIG wallet type', () => {
      const device = createDevice([createAccount('single_sig', "m/84'/0'/0'")]);
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(true);
    });

    it('returns false for device with only single-sig account and MULTI_SIG wallet type', () => {
      const device = createDevice([createAccount('single_sig', "m/84'/0'/0'")]);
      expect(hasCompatibleAccount(device, WalletType.MULTI_SIG)).toBe(false);
    });

    it('returns true for device with multisig account and MULTI_SIG wallet type', () => {
      const device = createDevice([createAccount('multisig', "m/48'/0'/0'/2'")]);
      expect(hasCompatibleAccount(device, WalletType.MULTI_SIG)).toBe(true);
    });

    it('returns false for device with only multisig account and SINGLE_SIG wallet type', () => {
      const device = createDevice([createAccount('multisig', "m/48'/0'/0'/2'")]);
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(false);
    });

    it('returns true for device with both account types and any wallet type', () => {
      const device = createDevice([
        createAccount('single_sig', "m/84'/0'/0'"),
        createAccount('multisig', "m/48'/0'/0'/2'"),
      ]);
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(true);
      expect(hasCompatibleAccount(device, WalletType.MULTI_SIG)).toBe(true);
    });

    // Legacy device tests (no accounts array)
    it('returns true for legacy device with single-sig path and SINGLE_SIG wallet type', () => {
      const device = createDevice(undefined, "m/84'/0'/0'");
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(true);
    });

    it('returns false for legacy device with single-sig path and MULTI_SIG wallet type', () => {
      const device = createDevice(undefined, "m/84'/0'/0'");
      expect(hasCompatibleAccount(device, WalletType.MULTI_SIG)).toBe(false);
    });

    it('returns true for legacy device with multisig path and MULTI_SIG wallet type', () => {
      const device = createDevice(undefined, "m/48'/0'/0'/2'");
      expect(hasCompatibleAccount(device, WalletType.MULTI_SIG)).toBe(true);
    });

    it('returns false for legacy device with multisig path and SINGLE_SIG wallet type', () => {
      const device = createDevice(undefined, "m/48'/0'/0'/2'");
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(false);
    });

    it('returns true for empty accounts array with SINGLE_SIG (legacy fallback)', () => {
      const device = createDevice([], "m/84'/0'/0'");
      expect(hasCompatibleAccount(device, WalletType.SINGLE_SIG)).toBe(true);
    });
  });

  describe('getDisplayAccount', () => {
    /**
     * Get the appropriate account for display based on wallet type
     * Replicates logic from CreateWallet.tsx
     */
    const getDisplayAccount = (device: Device, type: WalletType): DeviceAccount | null => {
      if (!device.accounts || device.accounts.length === 0) return null;
      const requiredPurpose = type === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';
      return device.accounts.find(a => a.purpose === requiredPurpose) || null;
    };

    const createDevice = (accounts?: DeviceAccount[]): Device => ({
      id: 'test-device',
      type: 'trezor',
      label: 'Test Device',
      fingerprint: 'abcd1234',
      accounts,
    });

    const createAccount = (purpose: 'single_sig' | 'multisig', path: string): DeviceAccount => ({
      id: `acc-${purpose}`,
      purpose,
      scriptType: 'native_segwit',
      derivationPath: path,
      xpub: `xpub-${purpose}`,
    });

    it('returns single-sig account for SINGLE_SIG wallet type', () => {
      const device = createDevice([
        createAccount('single_sig', "m/84'/0'/0'"),
        createAccount('multisig', "m/48'/0'/0'/2'"),
      ]);
      const account = getDisplayAccount(device, WalletType.SINGLE_SIG);
      expect(account?.purpose).toBe('single_sig');
      expect(account?.derivationPath).toBe("m/84'/0'/0'");
    });

    it('returns multisig account for MULTI_SIG wallet type', () => {
      const device = createDevice([
        createAccount('single_sig', "m/84'/0'/0'"),
        createAccount('multisig', "m/48'/0'/0'/2'"),
      ]);
      const account = getDisplayAccount(device, WalletType.MULTI_SIG);
      expect(account?.purpose).toBe('multisig');
      expect(account?.derivationPath).toBe("m/48'/0'/0'/2'");
    });

    it('returns null when no matching account type', () => {
      const device = createDevice([createAccount('single_sig', "m/84'/0'/0'")]);
      const account = getDisplayAccount(device, WalletType.MULTI_SIG);
      expect(account).toBeNull();
    });

    it('returns null for device without accounts', () => {
      const device = createDevice(undefined);
      expect(getDisplayAccount(device, WalletType.SINGLE_SIG)).toBeNull();
    });

    it('returns null for device with empty accounts', () => {
      const device = createDevice([]);
      expect(getDisplayAccount(device, WalletType.SINGLE_SIG)).toBeNull();
    });
  });

  describe('fingerprint validation', () => {
    /**
     * Security: Fingerprint matching must be case-insensitive because different
     * hardware wallets export fingerprints in different formats:
     * - Some devices use uppercase (ABCD1234)
     * - Some devices use lowercase (abcd1234)
     * This prevents false positives when the same device exports data differently.
     */
    const validateFingerprint = (
      deviceFingerprint: string,
      importedFingerprint: string
    ): boolean => {
      if (!importedFingerprint) return true; // No fingerprint to validate
      return (
        deviceFingerprint.toLowerCase() === importedFingerprint.toLowerCase()
      );
    };

    it('matches fingerprints regardless of case', () => {
      expect(validateFingerprint('abcd1234', 'ABCD1234')).toBe(true);
      expect(validateFingerprint('ABCD1234', 'abcd1234')).toBe(true);
      expect(validateFingerprint('AbCd1234', 'aBcD1234')).toBe(true);
    });

    it('rejects mismatched fingerprints', () => {
      expect(validateFingerprint('abcd1234', 'efgh5678')).toBe(false);
    });

    it('accepts empty imported fingerprint (no validation needed)', () => {
      expect(validateFingerprint('abcd1234', '')).toBe(true);
    });
  });

  describe('account conflict detection', () => {
    interface ParsedAccount {
      purpose: 'single_sig' | 'multisig';
      scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
      derivationPath: string;
      xpub: string;
    }

    interface ConflictResult {
      newAccounts: ParsedAccount[];
      matchingAccounts: ParsedAccount[];
      conflictingAccounts: ParsedAccount[];
    }

    /**
     * Categorize imported accounts into:
     * - newAccounts: Don't exist yet, can be added
     * - matchingAccounts: Same path and xpub, already exist
     * - conflictingAccounts: Same path but different xpub (SECURITY ISSUE)
     */
    const categorizeAccounts = (
      existingAccounts: DeviceAccount[],
      incomingAccounts: ParsedAccount[]
    ): ConflictResult => {
      const existingPaths = new Set(existingAccounts.map(a => a.derivationPath));
      const existingXpubs = new Map(existingAccounts.map(a => [a.derivationPath, a.xpub]));

      const newAccounts: ParsedAccount[] = [];
      const matchingAccounts: ParsedAccount[] = [];
      const conflictingAccounts: ParsedAccount[] = [];

      for (const account of incomingAccounts) {
        if (!existingPaths.has(account.derivationPath)) {
          newAccounts.push(account);
        } else {
          const existingXpub = existingXpubs.get(account.derivationPath);
          if (existingXpub === account.xpub) {
            matchingAccounts.push(account);
          } else {
            conflictingAccounts.push(account);
          }
        }
      }

      return { newAccounts, matchingAccounts, conflictingAccounts };
    };

    const createExisting = (path: string, xpub: string): DeviceAccount => ({
      id: 'existing',
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: path,
      xpub,
    });

    const createIncoming = (path: string, xpub: string): ParsedAccount => ({
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: path,
      xpub,
    });

    it('categorizes truly new accounts correctly', () => {
      const existing = [createExisting("m/84'/0'/0'", 'xpub-existing')];
      const incoming = [createIncoming("m/48'/0'/0'/2'", 'xpub-new')];

      const result = categorizeAccounts(existing, incoming);

      expect(result.newAccounts).toHaveLength(1);
      expect(result.matchingAccounts).toHaveLength(0);
      expect(result.conflictingAccounts).toHaveLength(0);
    });

    it('detects matching accounts (same path, same xpub)', () => {
      const existing = [createExisting("m/48'/0'/0'/2'", 'xpub-same')];
      const incoming = [createIncoming("m/48'/0'/0'/2'", 'xpub-same')];

      const result = categorizeAccounts(existing, incoming);

      expect(result.newAccounts).toHaveLength(0);
      expect(result.matchingAccounts).toHaveLength(1);
      expect(result.conflictingAccounts).toHaveLength(0);
    });

    it('detects conflicting accounts (same path, different xpub) - security issue', () => {
      const existing = [createExisting("m/48'/0'/0'/2'", 'xpub-device-A')];
      const incoming = [createIncoming("m/48'/0'/0'/2'", 'xpub-device-B')];

      const result = categorizeAccounts(existing, incoming);

      expect(result.newAccounts).toHaveLength(0);
      expect(result.matchingAccounts).toHaveLength(0);
      expect(result.conflictingAccounts).toHaveLength(1);
    });

    it('handles mixed scenarios correctly', () => {
      const existing = [
        createExisting("m/84'/0'/0'", 'xpub-single'),
        createExisting("m/48'/0'/0'/2'", 'xpub-multi'),
      ];
      const incoming = [
        createIncoming("m/49'/0'/0'", 'xpub-nested'),     // new
        createIncoming("m/84'/0'/0'", 'xpub-single'),     // matching
        createIncoming("m/48'/0'/0'/2'", 'xpub-WRONG'),   // conflict!
      ];

      const result = categorizeAccounts(existing, incoming);

      expect(result.newAccounts).toHaveLength(1);
      expect(result.newAccounts[0].derivationPath).toBe("m/49'/0'/0'");

      expect(result.matchingAccounts).toHaveLength(1);
      expect(result.matchingAccounts[0].derivationPath).toBe("m/84'/0'/0'");

      expect(result.conflictingAccounts).toHaveLength(1);
      expect(result.conflictingAccounts[0].derivationPath).toBe("m/48'/0'/0'/2'");
    });
  });
});
