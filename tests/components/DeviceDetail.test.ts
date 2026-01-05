/**
 * DeviceDetail Component Tests
 *
 * Tests for the account type configuration and helper functions
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
});
