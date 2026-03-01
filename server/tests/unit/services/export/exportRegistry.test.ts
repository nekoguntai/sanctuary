import { vi } from 'vitest';
/**
 * Export Format Registry Tests
 *
 * Tests for the pluggable wallet export format system.
 */

import { ExportFormatRegistry } from '../../../../src/services/export/registry';
import type { ExportFormatHandler, WalletExportData, ExportResult } from '../../../../src/services/export/types';

// Mock the logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Create mock wallet data for testing
function createMockWallet(overrides: Partial<WalletExportData> = {}): WalletExportData {
  return {
    id: 'wallet-123',
    name: 'Test Wallet',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub.../0/*)',
    devices: [
      {
        label: 'Test Device',
        type: 'coldcard',
        fingerprint: 'abcd1234',
        xpub: 'xpub...',
        derivationPath: "m/84'/0'/0'",
      },
    ],
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// Create mock handler for testing
function createMockHandler(overrides: Partial<ExportFormatHandler> = {}): ExportFormatHandler {
  return {
    id: 'mock_format',
    name: 'Mock Format',
    description: 'A mock format for testing',
    fileExtension: '.mock',
    mimeType: 'application/mock',
    export: vi.fn().mockReturnValue({
      content: '{"mock": true}',
      mimeType: 'application/mock',
      filename: 'test.mock',
      encoding: 'utf-8',
    }),
    ...overrides,
  };
}

describe('ExportFormatRegistry', () => {
  describe('register', () => {
    it('should register a handler', () => {
      const registry = new ExportFormatRegistry();
      const handler = createMockHandler({ id: 'test_format' });

      registry.register(handler);

      expect(registry.get('test_format')).toBe(handler);
    });

    it('should throw when registering duplicate handler ID', () => {
      const registry = new ExportFormatRegistry();
      const handler1 = createMockHandler({ id: 'duplicate' });
      const handler2 = createMockHandler({ id: 'duplicate' });

      registry.register(handler1);

      expect(() => registry.register(handler2)).toThrow(
        "Export format handler 'duplicate' is already registered"
      );
    });

    it('emits debug registration logging when debug mode is enabled', () => {
      const registry = new ExportFormatRegistry({ debug: true });
      const handler = createMockHandler({ id: 'debug_format' });

      registry.register(handler);

      expect(registry.has('debug_format')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should remove a registered handler', () => {
      const registry = new ExportFormatRegistry();
      const handler = createMockHandler({ id: 'removable' });

      registry.register(handler);
      const result = registry.unregister('removable');

      expect(result).toBe(true);
      expect(registry.get('removable')).toBeUndefined();
    });

    it('should return false when handler not found', () => {
      const registry = new ExportFormatRegistry();

      const result = registry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('should return handler by ID', () => {
      const registry = new ExportFormatRegistry();
      const handler = createMockHandler({ id: 'findable' });

      registry.register(handler);

      expect(registry.get('findable')).toBe(handler);
    });

    it('should return undefined for unknown ID', () => {
      const registry = new ExportFormatRegistry();

      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no handlers registered', () => {
      const registry = new ExportFormatRegistry();

      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered handlers', () => {
      const registry = new ExportFormatRegistry();
      registry.register(createMockHandler({ id: 'format1' }));
      registry.register(createMockHandler({ id: 'format2' }));

      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('getIds', () => {
    it('should return all format IDs', () => {
      const registry = new ExportFormatRegistry();
      registry.register(createMockHandler({ id: 'sparrow' }));
      registry.register(createMockHandler({ id: 'descriptor' }));

      const ids = registry.getIds();

      expect(ids).toContain('sparrow');
      expect(ids).toContain('descriptor');
    });
  });

  describe('has', () => {
    it('should return true for registered format', () => {
      const registry = new ExportFormatRegistry();
      registry.register(createMockHandler({ id: 'existing' }));

      expect(registry.has('existing')).toBe(true);
    });

    it('should return false for unregistered format', () => {
      const registry = new ExportFormatRegistry();

      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getAvailableFormats', () => {
    it('should return all formats when no canExport defined', () => {
      const registry = new ExportFormatRegistry();
      registry.register(createMockHandler({ id: 'format1' }));
      registry.register(createMockHandler({ id: 'format2' }));

      const wallet = createMockWallet();
      const available = registry.getAvailableFormats(wallet);

      expect(available).toHaveLength(2);
    });

    it('should filter formats based on canExport', () => {
      const registry = new ExportFormatRegistry();
      const singleSigOnly = createMockHandler({
        id: 'single_only',
        canExport: (w) => w.type === 'single_sig',
      });
      const multiSigOnly = createMockHandler({
        id: 'multi_only',
        canExport: (w) => w.type === 'multi_sig',
      });

      registry.register(singleSigOnly);
      registry.register(multiSigOnly);

      const singleSigWallet = createMockWallet({ type: 'single_sig' });
      const available = registry.getAvailableFormats(singleSigWallet);

      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('single_only');
    });
  });

  describe('export', () => {
    it('should export wallet in specified format', () => {
      const registry = new ExportFormatRegistry();
      const mockResult: ExportResult = {
        content: '{"wallet": "data"}',
        mimeType: 'application/json',
        filename: 'wallet.json',
        encoding: 'utf-8',
      };
      const handler = createMockHandler({
        id: 'json',
        export: vi.fn().mockReturnValue(mockResult),
      });

      registry.register(handler);

      const wallet = createMockWallet();
      const result = registry.export('json', wallet);

      expect(result).toEqual(mockResult);
      expect(handler.export).toHaveBeenCalledWith(wallet, undefined);
    });

    it('should pass options to handler', () => {
      const registry = new ExportFormatRegistry();
      const handler = createMockHandler({ id: 'json' });

      registry.register(handler);

      const wallet = createMockWallet();
      const options = { includeDevices: true, filename: 'custom' };
      registry.export('json', wallet, options);

      expect(handler.export).toHaveBeenCalledWith(wallet, options);
    });

    it('should throw when format not found', () => {
      const registry = new ExportFormatRegistry();

      const wallet = createMockWallet();

      expect(() => registry.export('nonexistent', wallet)).toThrow(
        'Unknown export format: nonexistent'
      );
    });

    it('should throw when format cannot export wallet type', () => {
      const registry = new ExportFormatRegistry();
      const handler = createMockHandler({
        id: 'single_only',
        canExport: (w) => w.type === 'single_sig',
      });

      registry.register(handler);

      const multiSigWallet = createMockWallet({ type: 'multi_sig', quorum: 2, totalSigners: 3 });

      expect(() => registry.export('single_only', multiSigWallet)).toThrow(
        "Export format 'single_only' cannot export this wallet type"
      );
    });

    it('emits debug export logging when debug mode is enabled', () => {
      const registry = new ExportFormatRegistry({ debug: true });
      const handler = createMockHandler({ id: 'debug_export' });
      registry.register(handler);

      const wallet = createMockWallet();
      const result = registry.export('debug_export', wallet);

      expect(result).toEqual(
        expect.objectContaining({
          filename: 'test.mock',
        })
      );
    });
  });

  describe('getFormatInfo', () => {
    it('should return format info for UI display', () => {
      const registry = new ExportFormatRegistry();
      registry.register(createMockHandler({
        id: 'sparrow',
        name: 'Sparrow Wallet',
        description: 'Sparrow-compatible JSON',
        fileExtension: '.json',
        mimeType: 'application/json',
      }));

      const info = registry.getFormatInfo();

      expect(info).toHaveLength(1);
      expect(info[0]).toEqual({
        id: 'sparrow',
        name: 'Sparrow Wallet',
        description: 'Sparrow-compatible JSON',
        extension: '.json',
        mimeType: 'application/json',
      });
    });
  });

  describe('count', () => {
    it('should return number of registered handlers', () => {
      const registry = new ExportFormatRegistry();

      expect(registry.count).toBe(0);

      registry.register(createMockHandler({ id: 'f1' }));
      expect(registry.count).toBe(1);

      registry.register(createMockHandler({ id: 'f2' }));
      expect(registry.count).toBe(2);
    });
  });
});
