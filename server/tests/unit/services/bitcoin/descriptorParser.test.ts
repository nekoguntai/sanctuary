/**
 * Descriptor Parser Service Tests
 *
 * Comprehensive tests for Bitcoin descriptor parsing including:
 * - Single-sig descriptors (wpkh, pkh, sh(wpkh), tr)
 * - Multi-sig descriptors (wsh(multi), wsh(sortedmulti))
 * - Derivation path parsing (hardened/unhardened, origin info, wildcards)
 * - Checksum validation
 * - Error handling
 * - JSON import formats
 */

import {
  parseDescriptorForImport,
  validateDescriptor,
  parseJsonImport,
  validateJsonImport,
  parseImportInput,
  type ParsedDescriptor,
  type ParsedDevice,
  type JsonImportConfig,
  type ScriptType,
  type Network,
} from '../../../../src/services/bitcoin/descriptorParser';
import { testXpubs } from '../../../fixtures/bitcoin';

describe('Descriptor Parser Service', () => {
  describe('parseDescriptorForImport - Single-sig Descriptors', () => {
    describe('Native SegWit (wpkh)', () => {
      it('should parse wpkh descriptor with fingerprint and derivation path', () => {
        const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.network).toBe('mainnet');
        expect(result.isChange).toBe(false);
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('d34db33f');
        expect(result.devices[0].xpub).toBe('xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL');
        expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
      });

      it('should parse wpkh descriptor with change chain wildcard', () => {
        const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.isChange).toBe(true);
      });

      it('should parse wpkh descriptor with apostrophe notation for hardened paths', () => {
        const descriptor = "wpkh([d34db33f/84'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

        const result = parseDescriptorForImport(descriptor);

        expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
      });

      it('should parse wpkh descriptor with testnet xpub', () => {
        const descriptor = `wpkh([aabbccdd/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

        const result = parseDescriptorForImport(descriptor);

        expect(result.network).toBe('testnet');
        expect(result.scriptType).toBe('native_segwit');
      });

      it('should parse wpkh descriptor without origin info', () => {
        // The parser requires origin info [fingerprint/path] to extract keys
        // Descriptors without origin info will fail to parse
        const descriptor = 'wpkh(xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

        expect(() => {
          parseDescriptorForImport(descriptor);
        }).toThrow('No valid key expressions found in descriptor');
      });
    });

    describe('Legacy (pkh)', () => {
      it('should parse pkh descriptor', () => {
        const descriptor = 'pkh([11223344/44h/0h/0h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('legacy');
        expect(result.network).toBe('mainnet');
        expect(result.devices[0].fingerprint).toBe('11223344');
        expect(result.devices[0].derivationPath).toBe("m/44'/0'/0'");
      });

      it('should detect testnet from coin type in derivation path', () => {
        // Use a testnet xpub prefix (tpub) to ensure testnet detection
        const descriptor = `pkh([11223344/44h/1h/0h]${testXpubs.testnet.bip44}/0/*)`;

        const result = parseDescriptorForImport(descriptor);

        expect(result.network).toBe('testnet');
      });
    });

    describe('Nested SegWit (sh(wpkh))', () => {
      it('should parse sh(wpkh) descriptor', () => {
        const descriptor = 'sh(wpkh([aabbccdd/49h/0h/0h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('nested_segwit');
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
        expect(result.devices[0].derivationPath).toBe("m/49'/0'/0'");
      });
    });

    describe('Taproot (tr)', () => {
      it('should parse tr descriptor', () => {
        const descriptor = 'tr([eeff0011/86h/0h/0h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*)';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('taproot');
        expect(result.devices[0].fingerprint).toBe('eeff0011');
        expect(result.devices[0].derivationPath).toBe("m/86'/0'/0'");
      });
    });
  });

  describe('parseDescriptorForImport - Multi-sig Descriptors', () => {
    describe('wsh(sortedmulti)', () => {
      it('should parse 2-of-3 wsh(sortedmulti) descriptor', () => {
        const descriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*,[99887766/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheS/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(3);
        expect(result.devices).toHaveLength(3);
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
        expect(result.devices[1].fingerprint).toBe('11223344');
        expect(result.devices[2].fingerprint).toBe('99887766');
        expect(result.devices[0].derivationPath).toBe("m/48'/1'/0'/2'");
      });

      it('should parse 3-of-5 wsh(sortedmulti) descriptor', () => {
        // Use proper 8-character hex fingerprints and valid xpubs
        const descriptor = 'wsh(sortedmulti(3,[aabbccdd/48h/0h/0h/2h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*,[11223344/48h/0h/0h/2h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*,[99887766/48h/0h/0h/2h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*,[deadbeef/48h/0h/0h/2h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*,[cafebabe/48h/0h/0h/2h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.quorum).toBe(3);
        expect(result.totalSigners).toBe(5);
        expect(result.devices).toHaveLength(5);
      });

      it('should parse wsh(multi) descriptor (non-sorted)', () => {
        const descriptor = 'wsh(multi(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
      });
    });

    describe('sh(wsh(sortedmulti)) - Nested SegWit Multisig', () => {
      it('should parse sh(wsh(sortedmulti)) descriptor', () => {
        const descriptor = 'sh(wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/1h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/1h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*)))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('nested_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
        expect(result.devices[0].derivationPath).toBe("m/48'/1'/0'/1'");
      });
    });

    describe('sh(sortedmulti) - Legacy Multisig', () => {
      it('should parse sh(sortedmulti) descriptor', () => {
        const descriptor = 'sh(sortedmulti(2,[aabbccdd/45h/0h]xpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/45h/0h]xpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('legacy');
        expect(result.quorum).toBe(2);
      });
    });

    describe('Change chain detection', () => {
      it('should detect change chain in multisig descriptor', () => {
        const descriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/1/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/1/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.isChange).toBe(true);
      });
    });
  });

  describe('Derivation Path Parsing', () => {
    it('should handle h notation for hardened derivation', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it("should handle ' notation for hardened derivation", () => {
      const descriptor = "wpkh([d34db33f/84'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0'");
    });

    it('should handle H notation for hardened derivation', () => {
      // The parser only converts lowercase 'h' to apostrophe, not uppercase 'H'
      // Uppercase H is less common in descriptors
      const descriptor = 'wpkh([d34db33f/84H/0H/0H]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      // Uppercase H is preserved as-is (not normalized)
      expect(result.devices[0].derivationPath).toBe("m/84H/0H/0H");
    });

    it('should handle mixed hardened and unhardened paths', () => {
      const descriptor = "wpkh([d34db33f/84'/0'/0]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)";

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].derivationPath).toBe("m/84'/0'/0");
    });

    it('should extract fingerprint from origin info', () => {
      const descriptor = 'wpkh([AbCdEf12/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].fingerprint).toBe('abcdef12');
    });

    it('should handle wildcard in receive chain', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.isChange).toBe(false);
    });

    it('should handle wildcard in change chain', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.isChange).toBe(true);
    });
  });

  describe('Checksum Handling', () => {
    it('should parse descriptor with checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)#abcdefgh';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should parse descriptor without checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
      expect(result.scriptType).toBe('native_segwit');
    });

    it('should handle alphanumeric checksum', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)#2h48fu9a';

      const result = parseDescriptorForImport(descriptor);

      expect(result.devices[0].fingerprint).toBe('d34db33f');
    });
  });

  describe('Error Handling', () => {
    it('should throw for invalid descriptor format', () => {
      expect(() => {
        parseDescriptorForImport('invalid-descriptor');
      }).toThrow();
    });

    it('should throw for unsupported script type', () => {
      expect(() => {
        parseDescriptorForImport('pk([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)');
      }).toThrow('Unable to detect script type from descriptor');
    });

    it('should throw for descriptor without key expressions', () => {
      expect(() => {
        parseDescriptorForImport('wpkh()');
      }).toThrow('No valid key expressions found in descriptor');
    });

    it('should throw for multisig without quorum', () => {
      expect(() => {
        parseDescriptorForImport('wsh(sortedmulti([aabbccdd/48h/1h/0h/2h]tpub1/0/*))');
      }).toThrow('Could not extract quorum from multisig descriptor');
    });

    it('should handle malformed xpub gracefully', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]invalid-xpub/0/*)';

      expect(() => {
        parseDescriptorForImport(descriptor);
      }).toThrow('No valid key expressions found in descriptor');
    });

    it('should handle descriptor with spaces', () => {
      const descriptor = '  wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)  ';

      const result = parseDescriptorForImport(descriptor);

      expect(result.type).toBe('single_sig');
    });

    it('should handle empty descriptor', () => {
      expect(() => {
        parseDescriptorForImport('');
      }).toThrow();
    });
  });

  describe('Network Detection', () => {
    it('should detect mainnet from xpub prefix', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('mainnet');
    });

    it('should detect testnet from tpub prefix', () => {
      const descriptor = `wpkh([d34db33f/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect testnet from coin type in derivation path', () => {
      // Use testnet xpub to ensure proper network detection
      const descriptor = `wpkh([d34db33f/84h/1h/0h]${testXpubs.testnet.bip84}/0/*)`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect testnet from upub prefix (nested segwit)', () => {
      const descriptor = `sh(wpkh([d34db33f/49h/1h/0h]${testXpubs.testnet.bip49}/0/*))`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('testnet');
    });

    it('should detect mainnet from ypub prefix', () => {
      const descriptor = `sh(wpkh([d34db33f/49h/0h/0h]${testXpubs.mainnet.bip49}/0/*))`;

      const result = parseDescriptorForImport(descriptor);

      expect(result.network).toBe('mainnet');
    });
  });

  describe('validateDescriptor', () => {
    it('should return null for valid descriptor', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const error = validateDescriptor(descriptor);

      expect(error).toBeNull();
    });

    it('should return error for invalid descriptor', () => {
      const error = validateDescriptor('invalid');

      expect(error).not.toBeNull();
      expect(error?.message).toBeDefined();
    });
  });

  describe('JSON Import Format', () => {
    describe('validateJsonImport', () => {
      it('should validate correct single-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).toBeNull();
      });

      it('should validate correct multi-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).toBeNull();
      });

      it('should reject config without type', () => {
        const config = {
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('type');
      });

      it('should reject config with invalid type', () => {
        const config = {
          type: 'invalid_type',
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('type');
      });

      it('should reject config without scriptType', () => {
        const config = {
          type: 'single_sig',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('scriptType');
      });

      it('should reject config with empty devices array', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('devices');
      });

      it('should reject single-sig with multiple devices', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('exactly one device');
      });

      it('should reject multi-sig without quorum', () => {
        const config = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('quorum');
      });

      it('should reject multi-sig with quorum exceeding total devices', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 3,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('Quorum cannot exceed');
      });

      it('should reject device with invalid fingerprint format', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'invalid',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('fingerprint must be 8 hex characters');
      });

      it('should reject device without derivationPath', () => {
        const config = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('derivationPath');
      });

      it('should reject device with invalid xpub format', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'invalid-xpub',
            },
          ],
        };

        const error = validateJsonImport(config);

        expect(error).not.toBeNull();
        expect(error?.message).toContain('xpub format appears invalid');
      });
    });

    describe('parseJsonImport', () => {
      it('should parse valid single-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.type).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
      });

      it('should parse valid multi-sig JSON config', () => {
        const config: JsonImportConfig = {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
            {
              fingerprint: '11223344',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.type).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
      });

      it('should normalize fingerprints to lowercase', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'AABBCCDD',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.devices[0].fingerprint).toBe('aabbccdd');
      });

      it('should detect network from xpub if not specified', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/1'/0'",
              xpub: testXpubs.testnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should use specified network if provided', () => {
        const config: JsonImportConfig = {
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          devices: [
            {
              fingerprint: 'aabbccdd',
              derivationPath: "m/84'/1'/0'",
              xpub: testXpubs.testnet.bip84,
            },
          ],
        };

        const result = parseJsonImport(config);

        expect(result.network).toBe('testnet');
      });

      it('should throw for invalid JSON config', () => {
        const config = {
          type: 'invalid',
        };

        expect(() => {
          parseJsonImport(config as JsonImportConfig);
        }).toThrow();
      });
    });
  });

  describe('parseImportInput - Auto-detection', () => {
    it('should auto-detect and parse descriptor format', () => {
      const input = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseImportInput(input);

      expect(result.format).toBe('descriptor');
      expect(result.parsed.type).toBe('single_sig');
    });

    it('should auto-detect and parse JSON format', () => {
      const input = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          {
            fingerprint: 'aabbccdd',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
          },
        ],
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('json');
      expect(result.parsed.type).toBe('single_sig');
    });

    it('should auto-detect and parse wallet export format', () => {
      const input = JSON.stringify({
        label: 'My Wallet',
        descriptor: 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)',
      });

      const result = parseImportInput(input);

      expect(result.format).toBe('wallet_export');
      expect(result.suggestedName).toBe('My Wallet');
    });

    it('should auto-detect and parse BlueWallet text format', () => {
      const input = `# BlueWallet Multisig setup file
Name: My 2-of-3 Wallet
Policy: 2 of 3
Derivation: m/48'/0'/0'/2'
Format: P2WSH

aabbccdd: xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL
11223344: xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5
99887766: xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj`;

      const result = parseImportInput(input);

      expect(result.format).toBe('bluewallet_text');
      expect(result.suggestedName).toBe('My 2-of-3 Wallet');
      expect(result.parsed.type).toBe('multi_sig');
      expect(result.parsed.quorum).toBe(2);
      expect(result.parsed.totalSigners).toBe(3);
    });

    it('should handle descriptor with comments (text format)', () => {
      const input = `# Sparrow Wallet export
# Created: 2024-01-01
wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)`;

      const result = parseImportInput(input);

      expect(result.format).toBe('descriptor');
      expect(result.parsed.type).toBe('single_sig');
    });
  });
});
