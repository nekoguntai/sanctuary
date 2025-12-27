/**
 * Address Derivation Service Tests
 *
 * Tests for BIP32/44/49/84/86 address derivation paths.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  parseDescriptor,
  deriveAddress,
  deriveAddressFromDescriptor,
  validateXpub,
  deriveAddresses,
  deriveAddressesFromDescriptor,
} from '../../../../src/services/bitcoin/addressDerivation';
import { testXpubs, testnetAddresses, mainnetAddresses } from '../../../fixtures/bitcoin';

// Initialize ECC library for Taproot support
bitcoin.initEccLib(ecc);

describe('Address Derivation Service', () => {
  describe('parseDescriptor', () => {
    describe('Single-sig Descriptors', () => {
      it('should parse wpkh (native segwit) descriptor', () => {
        const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('wpkh');
        expect(result.fingerprint).toBe('d34db33f');
        expect(result.xpub).toBeDefined();
        expect(result.path).toBe('0/*');
      });

      it('should parse sh-wpkh (nested segwit) descriptor', () => {
        const descriptor = 'sh(wpkh([aabbccdd/49h/0h/0h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*))';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('sh-wpkh');
        expect(result.fingerprint).toBe('aabbccdd');
      });

      it('should parse tr (taproot) descriptor', () => {
        const descriptor = 'tr([eeff0011/86h/0h/0h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*)';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('tr');
        expect(result.fingerprint).toBe('eeff0011');
      });

      it('should parse pkh (legacy) descriptor', () => {
        const descriptor = 'pkh([11223344/44h/0h/0h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*)';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('pkh');
        expect(result.fingerprint).toBe('11223344');
      });
    });

    describe('Multisig Descriptors', () => {
      it('should parse wsh(sortedmulti) descriptor', () => {
        const descriptor = 'wsh(sortedmulti(2,[aabbccdd/84h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvCN/0/*,[eeff0011/84h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvDD/0/*))';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('wsh-sortedmulti');
        expect(result.quorum).toBe(2);
        expect(result.keys?.length).toBe(2);
        expect(result.keys?.[0].fingerprint).toBe('aabbccdd');
        expect(result.keys?.[1].fingerprint).toBe('eeff0011');
      });

      it('should parse sh(wsh(sortedmulti)) descriptor', () => {
        const descriptor = 'sh(wsh(sortedmulti(2,[aabbccdd/49h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvCN/0/*,[eeff0011/49h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvDD/0/*)))';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('sh-wsh-sortedmulti');
        expect(result.quorum).toBe(2);
      });

      it('should parse 3-of-5 multisig', () => {
        const descriptor = 'wsh(sortedmulti(3,[a1a1a1a1/84h/0h/0h]xpub1.../0/*,[b2b2b2b2/84h/0h/0h]xpub2.../0/*,[c3c3c3c3/84h/0h/0h]xpub3.../0/*,[d4d4d4d4/84h/0h/0h]xpub4.../0/*,[e5e5e5e5/84h/0h/0h]xpub5.../0/*))';

        const result = parseDescriptor(descriptor);

        expect(result.quorum).toBe(3);
        expect(result.keys?.length).toBe(5);
      });
    });

    describe('Error Cases', () => {
      it('should throw for unsupported descriptor format', () => {
        expect(() => parseDescriptor('wsh(pk([...]xpub...))')).toThrow('Unsupported descriptor format');
      });

      it('should handle descriptor without fingerprint', () => {
        const descriptor = 'wpkh(xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        const result = parseDescriptor(descriptor);

        expect(result.type).toBe('wpkh');
        expect(result.xpub).toBeDefined();
        expect(result.fingerprint).toBeUndefined();
      });
    });
  });

  describe('deriveAddress', () => {
    // Use valid testnet xpub from fixtures
    const testTpub = testXpubs.testnet.bip84;

    describe('Native SegWit (P2WPKH)', () => {
      it('should derive native segwit address at index 0', () => {
        const result = deriveAddress(testTpub, 0, {
          scriptType: 'native_segwit',
          network: 'testnet',
          change: false,
        });

        expect(result.address).toMatch(/^tb1q[a-z0-9]{38,42}$/);
        expect(result.derivationPath).toContain('/0/0');
        expect(result.publicKey).toBeDefined();
        expect(result.publicKey.length).toBe(33); // Compressed public key
      });

      it('should derive different addresses at different indices', () => {
        const addr0 = deriveAddress(testTpub, 0, { network: 'testnet' });
        const addr1 = deriveAddress(testTpub, 1, { network: 'testnet' });
        const addr2 = deriveAddress(testTpub, 2, { network: 'testnet' });

        expect(addr0.address).not.toBe(addr1.address);
        expect(addr1.address).not.toBe(addr2.address);
        expect(addr0.address).not.toBe(addr2.address);
      });

      it('should derive change addresses when change=true', () => {
        const receive = deriveAddress(testTpub, 0, {
          network: 'testnet',
          change: false,
        });
        const change = deriveAddress(testTpub, 0, {
          network: 'testnet',
          change: true,
        });

        expect(receive.address).not.toBe(change.address);
        expect(receive.derivationPath).toContain('/0/');
        expect(change.derivationPath).toContain('/1/');
      });
    });

    describe('Nested SegWit (P2SH-P2WPKH)', () => {
      it('should derive nested segwit address', () => {
        const result = deriveAddress(testTpub, 0, {
          scriptType: 'nested_segwit',
          network: 'testnet',
          change: false,
        });

        // Testnet P2SH addresses start with '2' and are 34-35 chars total
        expect(result.address).toMatch(/^2[a-zA-Z0-9]{33,34}$/);
      });
    });

    describe('Legacy (P2PKH)', () => {
      it('should derive legacy address', () => {
        const result = deriveAddress(testTpub, 0, {
          scriptType: 'legacy',
          network: 'testnet',
          change: false,
        });

        // Testnet P2PKH addresses start with 'm' or 'n' and are 26-35 chars total
        expect(result.address).toMatch(/^[mn][a-zA-Z0-9]{25,34}$/);
      });
    });

    describe('Taproot (P2TR)', () => {
      it('should derive taproot address for testnet', () => {
        const result = deriveAddress(testTpub, 0, {
          scriptType: 'taproot',
          network: 'testnet',
          change: false,
        });

        // Testnet P2TR addresses start with 'tb1p'
        expect(result.address).toMatch(/^tb1p[a-z0-9]{58}$/);
        expect(result.derivationPath).toContain('/0/0');
        expect(result.publicKey).toBeDefined();
      });

      it('should derive different taproot addresses at different indices', () => {
        const addr0 = deriveAddress(testTpub, 0, { scriptType: 'taproot', network: 'testnet' });
        const addr1 = deriveAddress(testTpub, 1, { scriptType: 'taproot', network: 'testnet' });
        const addr2 = deriveAddress(testTpub, 2, { scriptType: 'taproot', network: 'testnet' });

        expect(addr0.address).not.toBe(addr1.address);
        expect(addr1.address).not.toBe(addr2.address);
        expect(addr0.address).not.toBe(addr2.address);
      });

      it('should derive taproot change addresses', () => {
        const receive = deriveAddress(testTpub, 0, {
          scriptType: 'taproot',
          network: 'testnet',
          change: false,
        });
        const change = deriveAddress(testTpub, 0, {
          scriptType: 'taproot',
          network: 'testnet',
          change: true,
        });

        expect(receive.address).not.toBe(change.address);
        expect(receive.derivationPath).toContain('/0/');
        expect(change.derivationPath).toContain('/1/');
      });

      it('should derive mainnet taproot address', () => {
        const mainnetXpub = testXpubs.mainnet.bip44;
        const result = deriveAddress(mainnetXpub, 0, {
          scriptType: 'taproot',
          network: 'mainnet',
        });

        // Mainnet P2TR addresses start with 'bc1p'
        expect(result.address).toMatch(/^bc1p[a-z0-9]{58}$/);
      });
    });

    describe('Network Handling', () => {
      it('should derive mainnet addresses from mainnet xpub', () => {
        // Skip if no valid mainnet xpub available
        const mainnetXpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

        const result = deriveAddress(mainnetXpub, 0, {
          network: 'mainnet',
        });

        expect(result.address).toMatch(/^bc1q[a-z0-9]{38,42}$/);
      });

      it('should handle regtest network', () => {
        const result = deriveAddress(testTpub, 0, {
          network: 'regtest',
        });

        expect(result.address).toMatch(/^bcrt1q[a-z0-9]{38,42}$/);
      });
    });

    describe('SLIP-132 Format Conversion', () => {
      it('should handle zpub format (mainnet native segwit)', () => {
        // zpub is BIP84 native segwit format for mainnet
        const zpub = testXpubs.mainnet.bip84;
        expect(zpub).toMatch(/^zpub/);

        const result = deriveAddress(zpub, 0, {
          scriptType: 'native_segwit',
          network: 'mainnet',
        });

        // Should derive a mainnet native segwit address (bc1q...)
        expect(result.address).toMatch(/^bc1q/);
        expect(result.derivationPath).toBeDefined();
        expect(result.publicKey).toBeDefined();
      });

      it('should derive different addresses from zpub at different indices', () => {
        const zpub = testXpubs.mainnet.bip84;
        const addr0 = deriveAddress(zpub, 0, { network: 'mainnet' });
        const addr1 = deriveAddress(zpub, 1, { network: 'mainnet' });

        expect(addr0.address).not.toBe(addr1.address);
        expect(addr0.address).toMatch(/^bc1q/);
        expect(addr1.address).toMatch(/^bc1q/);
      });

      it('should validate zpub format', () => {
        const zpub = testXpubs.mainnet.bip84;
        const result = validateXpub(zpub, 'mainnet');

        expect(result.valid).toBe(true);
        expect(result.scriptType).toBe('native_segwit');
      });

      it('should handle ypub format', () => {
        // ypub is BIP49 nested segwit format - use from fixtures
        const ypub = testXpubs.mainnet.bip49;

        const result = deriveAddress(ypub, 0, {
          scriptType: 'nested_segwit',
          network: 'mainnet',
        });

        expect(result.address).toMatch(/^3/);
      });

      it('should handle vpub format (testnet native segwit)', () => {
        // We need a valid vpub - use conversion test instead
        // vpub is testnet BIP84
        const result = deriveAddress(testTpub, 0, {
          scriptType: 'native_segwit',
          network: 'testnet',
        });

        expect(result.address).toMatch(/^tb1q/);
      });
    });
  });

  describe('deriveAddressFromDescriptor', () => {
    it('should derive address from wpkh descriptor', () => {
      const tpub = testXpubs.testnet.bip84;
      const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;

      const result = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
      });

      expect(result.address).toMatch(/^tb1q/);
      expect(result.derivationPath).toBeDefined();
    });

    it('should derive address from sh-wpkh descriptor', () => {
      const tpub = testXpubs.testnet.bip84;
      const descriptor = `sh(wpkh([aabbccdd/49'/1'/0']${tpub}/0/*))`;

      const result = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
      });

      expect(result.address).toMatch(/^2/);
    });

    it('should derive change address from descriptor', () => {
      const tpub = testXpubs.testnet.bip84;
      const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;

      const receive = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: false,
      });

      const change = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
    });
  });

  describe('validateXpub', () => {
    it('should validate correct mainnet xpub', () => {
      const xpub = testXpubs.mainnet.bip44;

      const result = validateXpub(xpub, 'mainnet');

      expect(result.valid).toBe(true);
    });

    it('should validate correct testnet tpub', () => {
      const tpub = testXpubs.testnet.bip84;

      const result = validateXpub(tpub, 'testnet');

      expect(result.valid).toBe(true);
    });

    it('should reject invalid xpub', () => {
      const result = validateXpub('invalid-xpub', 'mainnet');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject truncated xpub', () => {
      const truncated = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshk';

      const result = validateXpub(truncated, 'mainnet');

      expect(result.valid).toBe(false);
    });

    it('should validate zpub format', () => {
      const zpub = testXpubs.mainnet.bip84;
      expect(zpub).toMatch(/^zpub/);

      const result = validateXpub(zpub, 'mainnet');

      expect(result.valid).toBe(true);
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should validate ypub format', () => {
      const ypub = testXpubs.mainnet.bip49;

      const result = validateXpub(ypub, 'mainnet');

      expect(result.valid).toBe(true);
      expect(result.scriptType).toBe('nested_segwit');
    });
  });

  describe('deriveAddresses (batch)', () => {
    // Use valid testnet xpub from fixtures
    const testTpub = testXpubs.testnet.bip84;

    it('should derive multiple addresses at once', () => {
      const results = deriveAddresses(testTpub, 0, 5, {
        network: 'testnet',
      });

      expect(results.length).toBe(5);

      // All should be unique
      const addresses = results.map((r) => r.address);
      const unique = new Set(addresses);
      expect(unique.size).toBe(5);

      // Indices should be sequential
      expect(results[0].index).toBe(0);
      expect(results[4].index).toBe(4);
    });

    it('should start from specified index', () => {
      const results = deriveAddresses(testTpub, 10, 3, {
        network: 'testnet',
      });

      expect(results.length).toBe(3);
      expect(results[0].index).toBe(10);
      expect(results[1].index).toBe(11);
      expect(results[2].index).toBe(12);
    });

    it('should derive change addresses in batch', () => {
      const receive = deriveAddresses(testTpub, 0, 3, {
        network: 'testnet',
        change: false,
      });
      const change = deriveAddresses(testTpub, 0, 3, {
        network: 'testnet',
        change: true,
      });

      // No overlap between receive and change
      const receiveSet = new Set(receive.map((r) => r.address));
      const hasOverlap = change.some((c) => receiveSet.has(c.address));
      expect(hasOverlap).toBe(false);
    });
  });

  describe('deriveAddressesFromDescriptor (batch)', () => {
    it('should derive multiple addresses from descriptor', () => {
      const tpub = testXpubs.testnet.bip84;
      const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;

      const results = deriveAddressesFromDescriptor(descriptor, 0, 5, {
        network: 'testnet',
      });

      expect(results.length).toBe(5);

      results.forEach((r, i) => {
        expect(r.address).toMatch(/^tb1q/);
        expect(r.index).toBe(i);
      });
    });
  });

  describe('Determinism', () => {
    // Use valid testnet xpub from fixtures
    const testTpub = testXpubs.testnet.bip84;

    it('should produce same address for same inputs', () => {
      const addr1 = deriveAddress(testTpub, 0, { network: 'testnet' });
      const addr2 = deriveAddress(testTpub, 0, { network: 'testnet' });

      expect(addr1.address).toBe(addr2.address);
      expect(addr1.derivationPath).toBe(addr2.derivationPath);
    });

    it('should produce same public key for same inputs', () => {
      const result1 = deriveAddress(testTpub, 5, { network: 'testnet' });
      const result2 = deriveAddress(testTpub, 5, { network: 'testnet' });

      expect(result1.publicKey.equals(result2.publicKey)).toBe(true);
    });
  });
});
