/**
 * Import Format Registry Tests
 *
 * Tests for the pluggable import format detection and parsing system.
 */

import { ImportFormatRegistry } from '../../../../src/services/import/registry';
import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../../../../src/services/import/types';

// Mock the logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Create mock handlers for testing
function createMockHandler(overrides: Partial<ImportFormatHandler> = {}): ImportFormatHandler {
  return {
    id: 'mock_handler',
    name: 'Mock Handler',
    description: 'A mock handler for testing',
    priority: 50,
    fileExtensions: ['.txt'],
    canHandle: jest.fn().mockReturnValue({ detected: false, confidence: 0 }),
    parse: jest.fn().mockReturnValue({
      parsed: {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [],
      },
    }),
    ...overrides,
  };
}

describe('ImportFormatRegistry', () => {
  describe('register', () => {
    it('should register a handler', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({ id: 'test_handler' });

      registry.register(handler);

      expect(registry.get('test_handler')).toBe(handler);
    });

    it('should throw when registering duplicate handler ID', () => {
      const registry = new ImportFormatRegistry();
      const handler1 = createMockHandler({ id: 'duplicate' });
      const handler2 = createMockHandler({ id: 'duplicate' });

      registry.register(handler1);

      expect(() => registry.register(handler2)).toThrow(
        "Import format handler 'duplicate' is already registered"
      );
    });

    it('should sort handlers by priority (highest first)', () => {
      const registry = new ImportFormatRegistry();
      const lowPriority = createMockHandler({ id: 'low', priority: 10 });
      const highPriority = createMockHandler({ id: 'high', priority: 90 });
      const medPriority = createMockHandler({ id: 'med', priority: 50 });

      registry.register(lowPriority);
      registry.register(highPriority);
      registry.register(medPriority);

      const all = registry.getAll();
      expect(all[0].id).toBe('high');
      expect(all[1].id).toBe('med');
      expect(all[2].id).toBe('low');
    });
  });

  describe('unregister', () => {
    it('should remove a registered handler', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({ id: 'removable' });

      registry.register(handler);
      expect(registry.get('removable')).toBe(handler);

      const result = registry.unregister('removable');

      expect(result).toBe(true);
      expect(registry.get('removable')).toBeUndefined();
    });

    it('should return false when handler not found', () => {
      const registry = new ImportFormatRegistry();

      const result = registry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('should return handler by ID', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({ id: 'findable' });

      registry.register(handler);

      expect(registry.get('findable')).toBe(handler);
    });

    it('should return undefined for unknown ID', () => {
      const registry = new ImportFormatRegistry();

      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no handlers registered', () => {
      const registry = new ImportFormatRegistry();

      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered handlers', () => {
      const registry = new ImportFormatRegistry();
      const handler1 = createMockHandler({ id: 'handler1', priority: 50 });
      const handler2 = createMockHandler({ id: 'handler2', priority: 60 });

      registry.register(handler1);
      registry.register(handler2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('detect', () => {
    it('should return first handler that detects the format', () => {
      const registry = new ImportFormatRegistry();
      const nonDetecting = createMockHandler({
        id: 'non_detecting',
        priority: 90,
        canHandle: jest.fn().mockReturnValue({ detected: false, confidence: 0 }),
      });
      const detecting = createMockHandler({
        id: 'detecting',
        priority: 50,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
      });

      registry.register(nonDetecting);
      registry.register(detecting);

      const result = registry.detect('some input');

      expect(result).toBe(detecting);
      expect(nonDetecting.canHandle).toHaveBeenCalledWith('some input');
      expect(detecting.canHandle).toHaveBeenCalledWith('some input');
    });

    it('should return null when no handler detects the format', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({
        id: 'non_detecting',
        canHandle: jest.fn().mockReturnValue({ detected: false, confidence: 0 }),
      });

      registry.register(handler);

      const result = registry.detect('unknown format');

      expect(result).toBeNull();
    });

    it('should check handlers in priority order', () => {
      const registry = new ImportFormatRegistry();
      const callOrder: string[] = [];

      const lowPriority = createMockHandler({
        id: 'low',
        priority: 10,
        canHandle: jest.fn().mockImplementation(() => {
          callOrder.push('low');
          return { detected: false, confidence: 0 };
        }),
      });
      const highPriority = createMockHandler({
        id: 'high',
        priority: 90,
        canHandle: jest.fn().mockImplementation(() => {
          callOrder.push('high');
          return { detected: false, confidence: 0 };
        }),
      });

      registry.register(lowPriority);
      registry.register(highPriority);
      registry.detect('test');

      expect(callOrder).toEqual(['high', 'low']);
    });

    it('should handle errors in canHandle gracefully', () => {
      const registry = new ImportFormatRegistry();
      const throwingHandler = createMockHandler({
        id: 'throwing',
        priority: 90,
        canHandle: jest.fn().mockImplementation(() => {
          throw new Error('Handler error');
        }),
      });
      const workingHandler = createMockHandler({
        id: 'working',
        priority: 50,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
      });

      registry.register(throwingHandler);
      registry.register(workingHandler);

      const result = registry.detect('test');

      expect(result).toBe(workingHandler);
    });
  });

  describe('detectAll', () => {
    it('should return detection results from all handlers', () => {
      const registry = new ImportFormatRegistry();
      const handler1 = createMockHandler({
        id: 'handler1',
        priority: 50,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
      });
      const handler2 = createMockHandler({
        id: 'handler2',
        priority: 60,
        canHandle: jest.fn().mockReturnValue({ detected: false, confidence: 20 }),
      });

      registry.register(handler1);
      registry.register(handler2);

      const results = registry.detectAll('test');

      expect(results).toHaveLength(2);
      expect(results[0].result.confidence).toBe(80);
      expect(results[1].result.confidence).toBe(20);
    });

    it('should sort results by confidence (highest first)', () => {
      const registry = new ImportFormatRegistry();
      const lowConfidence = createMockHandler({
        id: 'low',
        priority: 90,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 30 }),
      });
      const highConfidence = createMockHandler({
        id: 'high',
        priority: 10,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 90 }),
      });

      registry.register(lowConfidence);
      registry.register(highConfidence);

      const results = registry.detectAll('test');

      expect(results[0].handler.id).toBe('high');
      expect(results[1].handler.id).toBe('low');
    });
  });

  describe('parse', () => {
    it('should auto-detect and parse input', () => {
      const registry = new ImportFormatRegistry();
      const mockParsed = {
        type: 'single_sig' as const,
        scriptType: 'native_segwit' as const,
        network: 'mainnet' as const,
        devices: [{ fingerprint: 'abcd1234', xpub: 'xpub...', derivationPath: "m/84'/0'/0'" }],
      };
      const handler = createMockHandler({
        id: 'parser',
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
        parse: jest.fn().mockReturnValue({ parsed: mockParsed }),
      });

      registry.register(handler);

      const result = registry.parse('test input');

      expect(result.format).toBe('parser');
      expect(result.parsed).toEqual(mockParsed);
    });

    it('should use specified handler when handlerId provided', () => {
      const registry = new ImportFormatRegistry();
      const handler1 = createMockHandler({
        id: 'handler1',
        priority: 90,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 90 }),
      });
      const handler2 = createMockHandler({
        id: 'handler2',
        priority: 10,
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 10 }),
      });

      registry.register(handler1);
      registry.register(handler2);

      const result = registry.parse('test', 'handler2');

      expect(result.format).toBe('handler2');
      expect(handler2.parse).toHaveBeenCalled();
      expect(handler1.parse).not.toHaveBeenCalled();
    });

    it('should throw when no handler detects format', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({
        id: 'non_detecting',
        canHandle: jest.fn().mockReturnValue({ detected: false, confidence: 0 }),
      });

      registry.register(handler);

      expect(() => registry.parse('unknown format')).toThrow(
        'Unable to detect import format'
      );
    });

    it('should throw when specified handlerId not found', () => {
      const registry = new ImportFormatRegistry();

      expect(() => registry.parse('test', 'nonexistent')).toThrow(
        'Unknown import format handler: nonexistent'
      );
    });

    it('should run validation if handler provides it', () => {
      const registry = new ImportFormatRegistry();
      const handler = createMockHandler({
        id: 'validating',
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
        validate: jest.fn().mockReturnValue({ valid: false, errors: ['Invalid device count'] }),
      });

      registry.register(handler);

      expect(() => registry.parse('test')).toThrow('Validation failed: Invalid device count');
    });

    it('should pass validation when valid', () => {
      const registry = new ImportFormatRegistry();
      const mockParsed = {
        type: 'single_sig' as const,
        scriptType: 'native_segwit' as const,
        network: 'mainnet' as const,
        devices: [],
      };
      const handler = createMockHandler({
        id: 'validating',
        canHandle: jest.fn().mockReturnValue({ detected: true, confidence: 80 }),
        parse: jest.fn().mockReturnValue({ parsed: mockParsed }),
        validate: jest.fn().mockReturnValue({ valid: true }),
      });

      registry.register(handler);

      const result = registry.parse('test');

      expect(result.parsed).toEqual(mockParsed);
    });
  });

  describe('getFileExtensions', () => {
    it('should return unique file extensions from all handlers', () => {
      const registry = new ImportFormatRegistry();
      const handler1 = createMockHandler({
        id: 'handler1',
        fileExtensions: ['.json', '.txt'],
      });
      const handler2 = createMockHandler({
        id: 'handler2',
        fileExtensions: ['.txt', '.cfg'],
      });

      registry.register(handler1);
      registry.register(handler2);

      const extensions = registry.getFileExtensions();

      expect(extensions).toContain('.json');
      expect(extensions).toContain('.txt');
      expect(extensions).toContain('.cfg');
      expect(extensions).toHaveLength(3);
    });
  });

  describe('count', () => {
    it('should return number of registered handlers', () => {
      const registry = new ImportFormatRegistry();

      expect(registry.count).toBe(0);

      registry.register(createMockHandler({ id: 'h1' }));
      expect(registry.count).toBe(1);

      registry.register(createMockHandler({ id: 'h2' }));
      expect(registry.count).toBe(2);
    });
  });
});
