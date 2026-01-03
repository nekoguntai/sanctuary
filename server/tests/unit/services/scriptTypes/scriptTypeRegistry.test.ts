/**
 * Script Type Registry Tests
 *
 * Tests for the pluggable script type handler system.
 */

import { ScriptTypeRegistry } from '../../../../src/services/scriptTypes/registry';
import type { ScriptTypeHandler, DeviceKeyInfo, DescriptorBuildOptions } from '../../../../src/services/scriptTypes/types';

// Mock the logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Create mock handler for testing
function createMockHandler(overrides: Partial<ScriptTypeHandler> = {}): ScriptTypeHandler {
  return {
    id: 'mock_segwit',
    name: 'Mock SegWit',
    description: 'A mock script type for testing',
    bip: 84,
    supportsMultisig: true,
    aliases: ['mock', 'test_segwit'],
    getDerivationPath: jest.fn().mockReturnValue("m/84'/0'/0'"),
    getMultisigDerivationPath: jest.fn().mockReturnValue("m/48'/0'/0'/2'"),
    buildSingleSigDescriptor: jest.fn().mockReturnValue('wpkh([abcd1234/84h/0h/0h]xpub.../0/*)'),
    buildMultiSigDescriptor: jest.fn().mockReturnValue('wsh(sortedmulti(2,[abcd1234]xpub...,[efgh5678]xpub.../0/*))'),
    ...overrides,
  };
}

describe('ScriptTypeRegistry', () => {
  describe('register', () => {
    it('should register a handler', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);

      expect(registry.get('native_segwit')).toBe(handler);
    });

    it('should throw when registering duplicate handler ID', () => {
      const registry = new ScriptTypeRegistry();
      const handler1 = createMockHandler({ id: 'duplicate' });
      const handler2 = createMockHandler({ id: 'duplicate' });

      registry.register(handler1);

      expect(() => registry.register(handler2)).toThrow(
        "Script type handler 'duplicate' is already registered"
      );
    });

    it('should register aliases', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({
        id: 'native_segwit',
        aliases: ['p2wpkh', 'bech32'],
      });

      registry.register(handler);

      expect(registry.get('p2wpkh')).toBe(handler);
      expect(registry.get('bech32')).toBe(handler);
    });
  });

  describe('unregister', () => {
    it('should remove a handler and its aliases', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({
        id: 'removable',
        aliases: ['alias1', 'alias2'],
      });

      registry.register(handler);
      const result = registry.unregister('removable');

      expect(result).toBe(true);
      expect(registry.get('removable')).toBeUndefined();
      expect(registry.get('alias1')).toBeUndefined();
      expect(registry.get('alias2')).toBeUndefined();
    });

    it('should return false for unknown ID', () => {
      const registry = new ScriptTypeRegistry();

      const result = registry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('should return handler by ID', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);

      expect(registry.get('native_segwit')).toBe(handler);
    });

    it('should return handler by alias (case insensitive)', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({
        id: 'native_segwit',
        aliases: ['P2WPKH'],
      });

      registry.register(handler);

      expect(registry.get('p2wpkh')).toBe(handler);
      expect(registry.get('P2WPKH')).toBe(handler);
    });

    it('should return undefined for unknown ID or alias', () => {
      const registry = new ScriptTypeRegistry();

      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered handlers', () => {
      const registry = new ScriptTypeRegistry();
      registry.register(createMockHandler({ id: 'type1' }));
      registry.register(createMockHandler({ id: 'type2' }));

      const all = registry.getAll();

      expect(all).toHaveLength(2);
    });
  });

  describe('getIds', () => {
    it('should return all script type IDs', () => {
      const registry = new ScriptTypeRegistry();
      registry.register(createMockHandler({ id: 'native_segwit' }));
      registry.register(createMockHandler({ id: 'taproot' }));

      const ids = registry.getIds();

      expect(ids).toContain('native_segwit');
      expect(ids).toContain('taproot');
    });
  });

  describe('has', () => {
    it('should return true for registered ID', () => {
      const registry = new ScriptTypeRegistry();
      registry.register(createMockHandler({ id: 'native_segwit', aliases: ['p2wpkh'] }));

      expect(registry.has('native_segwit')).toBe(true);
      expect(registry.has('p2wpkh')).toBe(true);
    });

    it('should return false for unregistered ID', () => {
      const registry = new ScriptTypeRegistry();

      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('resolveAlias', () => {
    it('should resolve alias to canonical ID', () => {
      const registry = new ScriptTypeRegistry();
      registry.register(createMockHandler({
        id: 'native_segwit',
        aliases: ['p2wpkh', 'bech32'],
      }));

      expect(registry.resolveAlias('p2wpkh')).toBe('native_segwit');
      expect(registry.resolveAlias('bech32')).toBe('native_segwit');
      expect(registry.resolveAlias('native_segwit')).toBe('native_segwit');
    });

    it('should return undefined for unknown alias', () => {
      const registry = new ScriptTypeRegistry();

      expect(registry.resolveAlias('unknown')).toBeUndefined();
    });
  });

  describe('getDerivationPath', () => {
    it('should call handler getDerivationPath', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);
      registry.getDerivationPath('native_segwit', 'mainnet', 0);

      expect(handler.getDerivationPath).toHaveBeenCalledWith('mainnet', 0);
    });

    it('should throw for unknown script type', () => {
      const registry = new ScriptTypeRegistry();

      expect(() => registry.getDerivationPath('unknown', 'mainnet')).toThrow(
        'Unknown script type: unknown'
      );
    });

    it('should use default values', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);
      registry.getDerivationPath('native_segwit');

      expect(handler.getDerivationPath).toHaveBeenCalledWith('mainnet', 0);
    });
  });

  describe('getMultisigDerivationPath', () => {
    it('should call handler getMultisigDerivationPath', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);
      registry.getMultisigDerivationPath('native_segwit', 'testnet', 1);

      expect(handler.getMultisigDerivationPath).toHaveBeenCalledWith('testnet', 1);
    });

    it('should throw for script type that does not support multisig', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({
        id: 'taproot',
        supportsMultisig: false,
      });

      registry.register(handler);

      expect(() => registry.getMultisigDerivationPath('taproot', 'mainnet')).toThrow(
        "Script type 'taproot' does not support multisig"
      );
    });
  });

  describe('buildSingleSigDescriptor', () => {
    it('should call handler buildSingleSigDescriptor', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);

      const device: DeviceKeyInfo = {
        fingerprint: 'abcd1234',
        xpub: 'xpub...',
        derivationPath: "m/84'/0'/0'",
      };
      const options: DescriptorBuildOptions = { network: 'mainnet' };

      registry.buildSingleSigDescriptor('native_segwit', device, options);

      expect(handler.buildSingleSigDescriptor).toHaveBeenCalledWith(device, options);
    });

    it('should throw for unknown script type', () => {
      const registry = new ScriptTypeRegistry();

      expect(() => registry.buildSingleSigDescriptor('unknown', {
        fingerprint: 'abcd1234',
        xpub: 'xpub...',
      }, { network: 'mainnet' })).toThrow('Unknown script type: unknown');
    });
  });

  describe('buildMultiSigDescriptor', () => {
    it('should call handler buildMultiSigDescriptor', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({ id: 'native_segwit' });

      registry.register(handler);

      const devices: DeviceKeyInfo[] = [
        { fingerprint: 'abcd1234', xpub: 'xpub1...' },
        { fingerprint: 'efgh5678', xpub: 'xpub2...' },
      ];
      const options = { network: 'mainnet' as const, quorum: 2 };

      registry.buildMultiSigDescriptor('native_segwit', devices, options);

      expect(handler.buildMultiSigDescriptor).toHaveBeenCalledWith(devices, options);
    });

    it('should throw for script type that does not support multisig', () => {
      const registry = new ScriptTypeRegistry();
      const handler = createMockHandler({
        id: 'taproot',
        supportsMultisig: false,
        buildMultiSigDescriptor: undefined,
      });

      registry.register(handler);

      expect(() => registry.buildMultiSigDescriptor('taproot', [], {
        network: 'mainnet',
        quorum: 2,
      })).toThrow("Script type 'taproot' does not support multisig");
    });
  });

  describe('getMultisigCapable', () => {
    it('should return only handlers that support multisig', () => {
      const registry = new ScriptTypeRegistry();

      registry.register(createMockHandler({ id: 'native_segwit', supportsMultisig: true }));
      registry.register(createMockHandler({ id: 'taproot', supportsMultisig: false }));
      registry.register(createMockHandler({ id: 'nested_segwit', supportsMultisig: true }));

      const capable = registry.getMultisigCapable();

      expect(capable).toHaveLength(2);
      expect(capable.map(h => h.id)).toContain('native_segwit');
      expect(capable.map(h => h.id)).toContain('nested_segwit');
      expect(capable.map(h => h.id)).not.toContain('taproot');
    });
  });

  describe('count', () => {
    it('should return number of registered handlers', () => {
      const registry = new ScriptTypeRegistry();

      expect(registry.count).toBe(0);

      registry.register(createMockHandler({ id: 'type1' }));
      expect(registry.count).toBe(1);

      registry.register(createMockHandler({ id: 'type2' }));
      expect(registry.count).toBe(2);
    });
  });
});

describe('Script Type Handler Integration', () => {
  // Test with actual handlers to verify derivation paths
  const { nativeSegwitHandler } = require('../../../../src/services/scriptTypes/handlers/nativeSegwit');
  const { legacyHandler } = require('../../../../src/services/scriptTypes/handlers/legacy');
  const { taprootHandler } = require('../../../../src/services/scriptTypes/handlers/taproot');

  describe('Native SegWit Handler', () => {
    it('should return correct BIP-84 derivation path', () => {
      expect(nativeSegwitHandler.getDerivationPath('mainnet', 0)).toBe("m/84'/0'/0'");
      expect(nativeSegwitHandler.getDerivationPath('testnet', 0)).toBe("m/84'/1'/0'");
    });

    it('should return correct multisig derivation path', () => {
      expect(nativeSegwitHandler.getMultisigDerivationPath('mainnet', 0)).toBe("m/48'/0'/0'/2'");
    });

    it('should build correct single-sig descriptor', () => {
      const descriptor = nativeSegwitHandler.buildSingleSigDescriptor(
        { fingerprint: 'abcd1234', xpub: 'xpub6...', derivationPath: "m/84'/0'/0'" },
        { network: 'mainnet' }
      );

      expect(descriptor).toMatch(/^wpkh\(\[abcd1234/);
      expect(descriptor).toContain('/0/*)');
    });
  });

  describe('Legacy Handler', () => {
    it('should return correct BIP-44 derivation path', () => {
      expect(legacyHandler.getDerivationPath('mainnet', 0)).toBe("m/44'/0'/0'");
      expect(legacyHandler.getDerivationPath('testnet', 0)).toBe("m/44'/1'/0'");
    });

    it('should build correct single-sig descriptor', () => {
      const descriptor = legacyHandler.buildSingleSigDescriptor(
        { fingerprint: 'abcd1234', xpub: 'xpub6...', derivationPath: "m/44'/0'/0'" },
        { network: 'mainnet' }
      );

      expect(descriptor).toMatch(/^pkh\(\[abcd1234/);
    });
  });

  describe('Taproot Handler', () => {
    it('should return correct BIP-86 derivation path', () => {
      expect(taprootHandler.getDerivationPath('mainnet', 0)).toBe("m/86'/0'/0'");
    });

    it('should not support multisig', () => {
      expect(taprootHandler.supportsMultisig).toBe(false);
    });

    it('should build correct single-sig descriptor', () => {
      const descriptor = taprootHandler.buildSingleSigDescriptor(
        { fingerprint: 'abcd1234', xpub: 'xpub6...', derivationPath: "m/86'/0'/0'" },
        { network: 'mainnet' }
      );

      expect(descriptor).toMatch(/^tr\(\[abcd1234/);
    });
  });
});
