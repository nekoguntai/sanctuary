/**
 * Trezor Adapter Tests
 *
 * Tests utility functions for Trezor hardware wallet integration including
 * satoshi amount validation and BIP derivation path handling.
 */

import {
  validateSatoshiAmount,
  getTrezorScriptType,
  isNonStandardPath,
  getAccountPathPrefix,
} from '@/services/hardwareWallet/adapters/trezor';

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

describe('getTrezorScriptType', () => {
  describe('Standard BIP paths', () => {
    it('returns SPENDADDRESS for BIP-44 legacy paths', () => {
      expect(getTrezorScriptType("m/44'/0'/0'/0/0")).toBe('SPENDADDRESS');
      expect(getTrezorScriptType("44'/0'/0'/0/0")).toBe('SPENDADDRESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-49 nested segwit paths', () => {
      expect(getTrezorScriptType("m/49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('returns SPENDWITNESS for BIP-84 native segwit paths', () => {
      expect(getTrezorScriptType("m/84'/0'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("84'/0'/0'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDTAPROOT for BIP-86 taproot paths', () => {
      expect(getTrezorScriptType("m/86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
      expect(getTrezorScriptType("86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
    });
  });

  describe('BIP-48 multisig paths', () => {
    it('returns SPENDWITNESS for P2WSH multisig (script type 2)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDP2SHWITNESS for P2SH-P2WSH multisig (script type 1)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-48 without explicit script type', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });
  });

  describe('Testnet paths', () => {
    it('handles testnet coin type correctly', () => {
      expect(getTrezorScriptType("m/84'/1'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("m/48'/1'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });
  });

  describe('Unknown paths', () => {
    it('defaults to SPENDWITNESS for unknown paths', () => {
      expect(getTrezorScriptType("m/0'/0'/0'")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType('unknown')).toBe('SPENDWITNESS');
    });
  });
});

describe('isNonStandardPath', () => {
  describe('BIP-48 multisig paths', () => {
    it('returns true for BIP-48 paths with m/ prefix', () => {
      expect(isNonStandardPath("m/48'/0'/0'/2'")).toBe(true);
      expect(isNonStandardPath("m/48'/0'/0'/1'/0/5")).toBe(true);
      expect(isNonStandardPath("m/48'/1'/0'/2'/0/0")).toBe(true);
    });

    it('returns true for BIP-48 paths without m/ prefix', () => {
      expect(isNonStandardPath("48'/0'/0'/2'")).toBe(true);
      expect(isNonStandardPath("48'/0'/0'/1'/0/5")).toBe(true);
    });
  });

  describe('Standard paths', () => {
    it('returns false for BIP-44 paths', () => {
      expect(isNonStandardPath("m/44'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-49 paths', () => {
      expect(isNonStandardPath("m/49'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-84 paths', () => {
      expect(isNonStandardPath("m/84'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-86 paths', () => {
      expect(isNonStandardPath("m/86'/0'/0'/0/0")).toBe(false);
    });
  });
});

describe('getAccountPathPrefix', () => {
  describe('BIP-48 paths', () => {
    it('extracts account path from full derivation path', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
      expect(getAccountPathPrefix("m/48'/0'/0'/1'/1/10")).toBe("m/48'/0'/0'/1'");
    });

    it('handles testnet paths', () => {
      expect(getAccountPathPrefix("m/48'/1'/0'/2'/0/0")).toBe("m/48'/1'/0'/2'");
    });

    it('handles paths without m/ prefix', () => {
      expect(getAccountPathPrefix("48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
    });
  });

  describe('Edge cases', () => {
    it('handles account-level paths (already 4 segments)', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'")).toBe("m/48'/0'/0'/2'");
    });

    it('handles paths with fewer than 4 segments', () => {
      // Returns whatever segments exist
      expect(getAccountPathPrefix("m/48'/0'")).toBe("m/48'/0'");
    });
  });
});
