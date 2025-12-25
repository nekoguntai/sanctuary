import { describe, it, expect } from 'vitest';
import {
  validateAddress,
  getAddressType,
  isMainnetAddress,
  isTestnetAddress,
} from '../../utils/validateAddress';

describe('validateAddress', () => {
  describe('Valid mainnet addresses', () => {
    it('should accept valid legacy (P2PKH) addresses starting with 1', () => {
      expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
      expect(validateAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
    });

    it('should accept valid P2SH addresses starting with 3', () => {
      expect(validateAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
      expect(validateAddress('3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC')).toBe(true);
    });

    it('should accept valid native SegWit (bech32) addresses starting with bc1q', () => {
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
      expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
    });

    it('should accept valid Taproot (bech32m) addresses starting with bc1p', () => {
      expect(validateAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
      // Taproot addresses are 62 characters (bc1p + 58 chars)
      expect(validateAddress('bc1pqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wf0qm')).toBe(true);
    });
  });

  describe('Valid testnet addresses', () => {
    it('should accept valid testnet legacy addresses starting with m or n', () => {
      expect(validateAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
      expect(validateAddress('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
    });

    it('should accept valid testnet P2SH addresses starting with 2', () => {
      expect(validateAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
      expect(validateAddress('2N8hwP1WmJrFF5QWABn38y63uYLhnJYJYTF')).toBe(true);
    });

    it('should accept valid testnet SegWit addresses starting with tb1', () => {
      expect(validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
      expect(validateAddress('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7')).toBe(true);
    });
  });

  describe('Invalid addresses', () => {
    it('should reject empty string', () => {
      expect(validateAddress('')).toBe(false);
    });

    it('should reject whitespace-only string', () => {
      expect(validateAddress('   ')).toBe(false);
    });

    it('should reject addresses that are too short', () => {
      expect(validateAddress('1A1zP1')).toBe(false);
      expect(validateAddress('bc1q')).toBe(false);
    });

    it('should reject addresses with invalid characters', () => {
      // Note: Our regex-based validation is permissive for quick UI feedback
      // Full bech32/base58 checksum validation happens on the server
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t!')).toBe(false); // Contains !
      expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7Div@Na')).toBe(false); // Contains @
    });

    it('should reject addresses with wrong prefix', () => {
      expect(validateAddress('5A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
      expect(validateAddress('xc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    });

    it('should reject addresses with wrong length for type', () => {
      expect(validateAddress('bc1qw508')).toBe(false);
      expect(validateAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg32')).toBe(false); // Too short for taproot
    });

    it('should reject completely invalid strings', () => {
      expect(validateAddress('not-a-bitcoin-address')).toBe(false);
      expect(validateAddress('1234567890')).toBe(false);
      expect(validateAddress('hello@world.com')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should trim whitespace before validation', () => {
      expect(validateAddress('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe(true);
      expect(validateAddress('\n1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\n')).toBe(true);
    });

    it('should handle null or undefined inputs gracefully', () => {
      expect(validateAddress(null as any)).toBe(false);
      expect(validateAddress(undefined as any)).toBe(false);
    });

    it('should handle minimum valid length addresses', () => {
      // Legacy addresses can be 26-35 characters
      expect(validateAddress('17VZNX1SN5NtKa8UQFxwQbFeFc3iqRYhem')).toBe(true); // 34 chars
    });

    it('should handle maximum valid length addresses', () => {
      // Bech32 addresses can be up to 90 characters
      expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    });
  });
});

describe('getAddressType', () => {
  it('should identify legacy addresses', () => {
    expect(getAddressType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('legacy');
  });

  it('should identify P2SH addresses', () => {
    expect(getAddressType('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe('p2sh');
  });

  it('should identify native SegWit addresses', () => {
    expect(getAddressType('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('native_segwit');
  });

  it('should identify Taproot addresses', () => {
    expect(getAddressType('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe('taproot');
  });

  it('should identify testnet legacy addresses', () => {
    expect(getAddressType('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('testnet_legacy');
    expect(getAddressType('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe('testnet_legacy');
  });

  it('should identify testnet P2SH addresses', () => {
    expect(getAddressType('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('testnet_p2sh');
  });

  it('should identify testnet SegWit addresses', () => {
    expect(getAddressType('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('testnet_segwit');
  });

  it('should return null for invalid addresses', () => {
    expect(getAddressType('invalid-address')).toBeNull();
    expect(getAddressType('')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(getAddressType('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe('native_segwit');
  });
});

describe('isMainnetAddress', () => {
  it('should return true for mainnet legacy addresses', () => {
    expect(isMainnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
  });

  it('should return true for mainnet P2SH addresses', () => {
    expect(isMainnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
  });

  it('should return true for mainnet native SegWit addresses', () => {
    expect(isMainnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
  });

  it('should return true for mainnet Taproot addresses', () => {
    expect(isMainnetAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
  });

  it('should return false for testnet addresses', () => {
    expect(isMainnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(false);
    expect(isMainnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(false);
    expect(isMainnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
  });

  it('should return false for invalid addresses', () => {
    expect(isMainnetAddress('invalid-address')).toBe(false);
    expect(isMainnetAddress('')).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(isMainnetAddress('  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa  ')).toBe(true);
  });
});

describe('isTestnetAddress', () => {
  it('should return true for testnet legacy addresses', () => {
    expect(isTestnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
    expect(isTestnetAddress('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
  });

  it('should return true for testnet P2SH addresses', () => {
    expect(isTestnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
  });

  it('should return true for testnet SegWit addresses', () => {
    expect(isTestnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
  });

  it('should return false for mainnet addresses', () => {
    expect(isTestnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
    expect(isTestnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(false);
    expect(isTestnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    expect(isTestnetAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(false);
  });

  it('should return false for invalid addresses', () => {
    expect(isTestnetAddress('invalid-address')).toBe(false);
    expect(isTestnetAddress('')).toBe(false);
  });

  it('should trim whitespace', () => {
    expect(isTestnetAddress('  tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx  ')).toBe(true);
  });
});
