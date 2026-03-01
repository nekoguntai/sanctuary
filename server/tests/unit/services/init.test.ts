import { vi } from 'vitest';
/**
 * Service Initialization Tests
 *
 * Tests for the service registry initialization.
 */

import { serviceRegistry, ServiceNames } from '../../../src/services/registry';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock dependent services to prevent actual initialization
vi.mock('../../../src/services/syncService', () => ({
  getSyncService: vi.fn().mockReturnValue({ sync: vi.fn() }),
}));

vi.mock('../../../src/services/maintenanceService', () => ({
  maintenanceService: { run: vi.fn() },
}));

vi.mock('../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: { notify: vi.fn() },
}));

vi.mock('../../../src/services/price', () => ({
  getPriceService: vi.fn().mockReturnValue({ getPrice: vi.fn() }),
}));

vi.mock('../../../src/services/tokenRevocation', () => ({
  revokeToken: vi.fn(),
}));

// Import after mocks
import {
  initializeServices,
  isServicesInitialized,
  resetServices,
  services,
} from '../../../src/services/init';

describe('Service Initialization', () => {
  beforeEach(() => {
    // Reset before each test
    resetServices();
  });

  describe('initializeServices', () => {
    it('should register services with the registry', async () => {
      await initializeServices();

      // Check that service factories are registered
      expect(serviceRegistry.has(ServiceNames.SYNC)).toBe(true);
      expect(serviceRegistry.has(ServiceNames.MAINTENANCE)).toBe(true);
      expect(serviceRegistry.has(ServiceNames.NOTIFICATION)).toBe(true);
      expect(serviceRegistry.has(ServiceNames.PRICE)).toBe(true);
      expect(serviceRegistry.has(ServiceNames.TOKEN_REVOCATION)).toBe(true);
    });

    it('should set initialized flag after initialization', async () => {
      expect(isServicesInitialized()).toBe(false);

      await initializeServices();

      expect(isServicesInitialized()).toBe(true);
    });

    it('should be idempotent - second call does nothing', async () => {
      await initializeServices();
      const summary1 = serviceRegistry.getSummary();

      await initializeServices();
      const summary2 = serviceRegistry.getSummary();

      // Service count should be the same
      expect(summary1.count).toBe(summary2.count);
    });

    it('should use lazy loading for services', async () => {
      await initializeServices();

      // Services should be registered as factories, not instances yet
      const summary = serviceRegistry.getSummary();
      expect(summary.count).toBe(0); // No instances created yet

      // Access a service to trigger lazy loading
      const sync = serviceRegistry.get(ServiceNames.SYNC);
      expect(sync).toBeDefined();

      // Now one instance should exist
      const summary2 = serviceRegistry.getSummary();
      expect(summary2.count).toBe(1);
    });
  });

  describe('resetServices', () => {
    it('should clear the registry and reset initialized flag', async () => {
      await initializeServices();
      expect(isServicesInitialized()).toBe(true);

      resetServices();

      expect(isServicesInitialized()).toBe(false);
      expect(serviceRegistry.has(ServiceNames.SYNC)).toBe(false);
    });
  });

  describe('services accessor', () => {
    it('should provide access to registered services', async () => {
      await initializeServices();

      // Access through the services object
      const sync = services.sync;
      expect(sync).toBeDefined();
    });

    it('should expose all registered service accessors', async () => {
      await initializeServices();

      expect(services.sync).toBeDefined();
      expect(services.maintenance).toBeDefined();
      expect(services.notification).toBeDefined();
      expect(services.price).toBeDefined();
      expect(services.tokenRevocation).toBeDefined();
    });

    it('should throw if accessing unregistered service', () => {
      // Don't initialize - services should not be registered
      expect(() => services.sync).toThrow();
    });
  });
});
