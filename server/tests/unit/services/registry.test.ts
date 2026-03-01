import { vi } from 'vitest';
/**
 * Service Registry Tests
 *
 * Tests for the dependency injection container.
 */

import {
  serviceRegistry,
  createTestRegistry,
  ServiceNames,
} from '../../../src/services/registry';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ServiceRegistry', () => {
  // Use createTestRegistry for isolated tests to avoid polluting the singleton

  describe('register', () => {
    it('should register a service', () => {
      const registry = createTestRegistry();
      const mockService = { doSomething: vi.fn() };

      registry.register('testService', mockService);

      expect(registry.has('testService')).toBe(true);
    });

    it('should throw when registering duplicate service', () => {
      const registry = createTestRegistry();
      const mockService = { doSomething: vi.fn() };

      registry.register('testService', mockService);

      expect(() => registry.register('testService', mockService)).toThrow(
        "Service 'testService' is already registered"
      );
    });

    it('should throw when registry is frozen', () => {
      const registry = createTestRegistry();
      registry.freeze();

      expect(() => registry.register('testService', {})).toThrow(
        "Cannot register service 'testService': registry is frozen"
      );
    });
  });

  describe('get', () => {
    it('should retrieve a registered service', () => {
      const registry = createTestRegistry();
      const mockService = { id: 'mock-123', doSomething: vi.fn() };

      registry.register('testService', mockService);
      const retrieved = registry.get<typeof mockService>('testService');

      expect(retrieved).toBe(mockService);
      expect(retrieved.id).toBe('mock-123');
    });

    it('should throw when service not found', () => {
      const registry = createTestRegistry();

      expect(() => registry.get('nonExistent')).toThrow(
        "Service 'nonExistent' not found in registry"
      );
    });

    it('should preserve type information', () => {
      const registry = createTestRegistry();

      interface ITestService {
        getValue(): number;
      }

      const mockService: ITestService = { getValue: () => 42 };
      registry.register('typed', mockService);

      const retrieved = registry.get<ITestService>('typed');

      expect(retrieved.getValue()).toBe(42);
    });
  });

  describe('has', () => {
    it('should return true for registered services', () => {
      const registry = createTestRegistry();
      registry.register('existingService', {});

      expect(registry.has('existingService')).toBe(true);
    });

    it('should return false for unregistered services', () => {
      const registry = createTestRegistry();

      expect(registry.has('nonExistent')).toBe(false);
    });
  });

  describe('getNames', () => {
    it('should return empty array when no services registered', () => {
      const registry = createTestRegistry();

      expect(registry.getNames()).toEqual([]);
    });

    it('should return all registered service names', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});
      registry.register('serviceB', {});
      registry.register('serviceC', {});

      const names = registry.getNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('serviceA');
      expect(names).toContain('serviceB');
      expect(names).toContain('serviceC');
    });
  });

  describe('tryGet', () => {
    it('should return service when found', () => {
      const registry = createTestRegistry();
      const mockService = { value: 'test' };
      registry.register('testService', mockService);

      const result = registry.tryGet<typeof mockService>('testService');

      expect(result).toBe(mockService);
    });

    it('should return undefined when not found', () => {
      const registry = createTestRegistry();

      const result = registry.tryGet('nonExistent');

      expect(result).toBeUndefined();
    });

    it('should not throw when service not found', () => {
      const registry = createTestRegistry();

      expect(() => registry.tryGet('nonExistent')).not.toThrow();
    });
  });

  describe('replace', () => {
    it('should replace existing service', () => {
      const registry = createTestRegistry();
      const originalService = { version: 1 };
      const replacementService = { version: 2 };

      registry.register('testService', originalService);
      registry.replace('testService', replacementService);

      const retrieved = registry.get<typeof replacementService>('testService');
      expect(retrieved.version).toBe(2);
    });

    it('should register new service if not exists', () => {
      const registry = createTestRegistry();
      const newService = { name: 'new' };

      registry.replace('newService', newService);

      expect(registry.has('newService')).toBe(true);
      expect(registry.get('newService')).toBe(newService);
    });

    it('should throw when registry is frozen', () => {
      const registry = createTestRegistry();
      registry.register('testService', {});
      registry.freeze();

      expect(() => registry.replace('testService', {})).toThrow(
        "Cannot replace service 'testService': registry is frozen"
      );
    });
  });

  describe('freeze', () => {
    it('should freeze the registry', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});

      registry.freeze();

      expect(registry.isFrozen()).toBe(true);
    });

    it('should prevent new registrations after freeze', () => {
      const registry = createTestRegistry();
      registry.freeze();

      expect(() => registry.register('newService', {})).toThrow();
    });

    it('should prevent replacements after freeze', () => {
      const registry = createTestRegistry();
      registry.register('existingService', {});
      registry.freeze();

      expect(() => registry.replace('existingService', {})).toThrow();
    });

    it('should allow get operations after freeze', () => {
      const registry = createTestRegistry();
      const mockService = { frozen: true };
      registry.register('testService', mockService);
      registry.freeze();

      expect(() => registry.get('testService')).not.toThrow();
      expect(registry.get('testService')).toBe(mockService);
    });
  });

  describe('isFrozen', () => {
    it('should return false initially', () => {
      const registry = createTestRegistry();

      expect(registry.isFrozen()).toBe(false);
    });

    it('should return true after freeze', () => {
      const registry = createTestRegistry();
      registry.freeze();

      expect(registry.isFrozen()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all services', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});
      registry.register('serviceB', {});

      registry.clear();

      expect(registry.has('serviceA')).toBe(false);
      expect(registry.has('serviceB')).toBe(false);
      expect(registry.getNames()).toHaveLength(0);
    });

    it('should unfreeze the registry', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});
      registry.freeze();

      registry.clear();

      expect(registry.isFrozen()).toBe(false);
      expect(() => registry.register('newService', {})).not.toThrow();
    });
  });

  describe('getSummary', () => {
    it('should return correct summary for empty registry', () => {
      const registry = createTestRegistry();

      const summary = registry.getSummary();

      expect(summary).toEqual({
        count: 0,
        services: [],
        frozen: false,
      });
    });

    it('should return correct summary with services', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});
      registry.register('serviceB', {});

      const summary = registry.getSummary();

      expect(summary.count).toBe(2);
      expect(summary.services).toContain('serviceA');
      expect(summary.services).toContain('serviceB');
      expect(summary.frozen).toBe(false);
    });

    it('should reflect frozen state', () => {
      const registry = createTestRegistry();
      registry.register('serviceA', {});
      registry.freeze();

      const summary = registry.getSummary();

      expect(summary.frozen).toBe(true);
    });
  });

  describe('factories and mocks', () => {
    it('lazily instantiates factory services once and reuses singleton instance', () => {
      const registry = createTestRegistry();
      let created = 0;

      registry.registerFactory('lazy', () => {
        created += 1;
        return { id: created };
      });

      expect(registry.has('lazy')).toBe(true);
      expect(registry.getNames()).toContain('lazy');

      const first = registry.get<{ id: number }>('lazy');
      const second = registry.get<{ id: number }>('lazy');
      expect(first).toBe(second);
      expect(created).toBe(1);
    });

    it('enforces factory duplicate and frozen guards', () => {
      const registry = createTestRegistry();

      registry.registerFactory('factoryService', () => ({ ok: true }));
      expect(() => registry.registerFactory('factoryService', () => ({ ok: false }))).toThrow(
        "Service 'factoryService' is already registered"
      );

      registry.freeze();
      expect(() => registry.registerFactory('blockedFactory', () => ({ ok: true }))).toThrow(
        "Cannot register factory 'blockedFactory': registry is frozen"
      );
    });

    it('prioritizes mocks over services and allows unmock/clearMocks', () => {
      const registry = createTestRegistry();
      const real = { source: 'real' };
      const mocked = { source: 'mock' };

      registry.register('service', real);
      registry.mock('service', mocked);
      expect(registry.get<{ source: string }>('service')).toBe(mocked);

      registry.unmock('service');
      expect(registry.get<{ source: string }>('service')).toBe(real);

      registry.mock('tempA', { value: 1 });
      registry.mock('tempB', { value: 2 });
      registry.clearMocks();
      expect(registry.has('tempA')).toBe(false);
      expect(registry.has('tempB')).toBe(false);
    });

    it('reset clears services, factories, mocks, and frozen state', () => {
      const registry = createTestRegistry();
      registry.register('service', { ok: true });
      registry.registerFactory('lazy', () => ({ id: 1 }));
      registry.mock('mockOnly', { id: 'm' });
      registry.freeze();

      registry.reset();

      expect(registry.getNames()).toEqual([]);
      expect(registry.isFrozen()).toBe(false);
      expect(registry.has('service')).toBe(false);
      expect(registry.has('lazy')).toBe(false);
      expect(registry.has('mockOnly')).toBe(false);
      expect(registry.tryGet('service')).toBeUndefined();
    });
  });
});

describe('createTestRegistry', () => {
  it('should create an empty registry when called with no arguments', () => {
    const registry = createTestRegistry();

    expect(registry.getNames()).toHaveLength(0);
    expect(registry.isFrozen()).toBe(false);
  });

  it('should pre-populate with provided mocks', () => {
    const mockSync = { triggerSync: vi.fn() };
    const mockPrice = { getCurrentPrice: vi.fn() };

    const registry = createTestRegistry({
      sync: mockSync,
      price: mockPrice,
    });

    expect(registry.has('sync')).toBe(true);
    expect(registry.has('price')).toBe(true);
    expect(registry.get('sync')).toBe(mockSync);
    expect(registry.get('price')).toBe(mockPrice);
  });

  it('should create isolated registries', () => {
    const registry1 = createTestRegistry({ service: { v: 1 } });
    const registry2 = createTestRegistry({ service: { v: 2 } });

    expect((registry1.get('service') as any).v).toBe(1);
    expect((registry2.get('service') as any).v).toBe(2);
  });

  it('should not affect global singleton', () => {
    // Clear the global registry first
    serviceRegistry.clear();

    const testRegistry = createTestRegistry({
      testOnlyService: {},
    });

    expect(testRegistry.has('testOnlyService')).toBe(true);
    expect(serviceRegistry.has('testOnlyService')).toBe(false);
  });
});

describe('ServiceNames', () => {
  it('should have SYNC constant', () => {
    expect(ServiceNames.SYNC).toBe('sync');
  });

  it('should have MAINTENANCE constant', () => {
    expect(ServiceNames.MAINTENANCE).toBe('maintenance');
  });

  it('should have AUDIT constant', () => {
    expect(ServiceNames.AUDIT).toBe('audit');
  });

  it('should have PRICE constant', () => {
    expect(ServiceNames.PRICE).toBe('price');
  });

  it('should have NOTIFICATION constant', () => {
    expect(ServiceNames.NOTIFICATION).toBe('notification');
  });

  it('should have TOKEN_REVOCATION constant', () => {
    expect(ServiceNames.TOKEN_REVOCATION).toBe('tokenRevocation');
  });

  it('should have WALLET constant', () => {
    expect(ServiceNames.WALLET).toBe('wallet');
  });
});

describe('serviceRegistry (singleton)', () => {
  beforeEach(() => {
    // Reset global singleton for each test
    serviceRegistry.clear();
  });

  it('should be a global singleton', () => {
    serviceRegistry.register('globalService', { id: 'global' });

    expect(serviceRegistry.has('globalService')).toBe(true);
  });

  it('should persist across multiple access points', () => {
    serviceRegistry.register('persistentService', { persisted: true });

    // Simulate accessing from another module
    const retrievedService = serviceRegistry.get('persistentService');

    expect(retrievedService).toEqual({ persisted: true });
  });
});
