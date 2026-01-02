/**
 * Service Registry
 *
 * Simple dependency injection container for services.
 * Enables easy testing by allowing service substitution.
 *
 * ## Usage
 *
 * ### Registration (at startup)
 * ```typescript
 * import { serviceRegistry } from './services/registry';
 * import { syncService } from './services/syncService';
 *
 * serviceRegistry.register('sync', syncService);
 * ```
 *
 * ### Retrieval (in handlers)
 * ```typescript
 * const sync = serviceRegistry.get<ISyncService>('sync');
 * await sync.triggerSync(walletId);
 * ```
 *
 * ### Testing (in tests)
 * ```typescript
 * import { createTestRegistry } from './services/registry';
 *
 * const mockSync: ISyncService = { triggerSync: jest.fn(), ... };
 * const registry = createTestRegistry({ sync: mockSync });
 * ```
 */

import type { IServiceRegistry, ServiceFactory } from './interfaces';
import { createLogger } from '../utils/logger';

const log = createLogger('REGISTRY');

/**
 * Enhanced service registry implementation
 *
 * Supports:
 * - Direct instance registration
 * - Factory registration with lazy instantiation
 * - Mock injection for testing
 * - Singleton vs transient lifecycle
 */
class ServiceRegistry implements IServiceRegistry {
  private services = new Map<string, unknown>();
  private factories = new Map<string, ServiceFactory<unknown>>();
  private mocks = new Map<string, unknown>();
  private frozen = false;

  /**
   * Register a service instance
   * @throws if registry is frozen or service already registered
   */
  register<T>(name: string, instance: T): void {
    if (this.frozen) {
      throw new Error(`Cannot register service '${name}': registry is frozen`);
    }

    if (this.services.has(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }

    this.services.set(name, instance);
    log.debug(`Registered service: ${name}`);
  }

  /**
   * Register a factory for lazy instantiation
   * Service is created on first access
   */
  registerFactory<T>(name: string, factory: ServiceFactory<T>): void {
    if (this.frozen) {
      throw new Error(`Cannot register factory '${name}': registry is frozen`);
    }

    if (this.services.has(name) || this.factories.has(name)) {
      throw new Error(`Service '${name}' is already registered`);
    }

    this.factories.set(name, factory as ServiceFactory<unknown>);
    log.debug(`Registered factory: ${name}`);
  }

  /**
   * Get a registered service
   * Returns mock if one is set, otherwise returns registered instance
   * For factories, creates the instance on first access (singleton)
   * @throws if service not found
   */
  get<T>(name: string): T {
    // Priority 1: Return mock if set (for testing)
    const mock = this.mocks.get(name);
    if (mock !== undefined) {
      return mock as T;
    }

    // Priority 2: Return existing instance
    const service = this.services.get(name);
    if (service !== undefined) {
      return service as T;
    }

    // Priority 3: Create from factory if available
    const factory = this.factories.get(name);
    if (factory) {
      const instance = factory();
      this.services.set(name, instance);
      log.debug(`Created service from factory: ${name}`);
      return instance as T;
    }

    throw new Error(`Service '${name}' not found in registry`);
  }

  /**
   * Check if a service is registered (as instance or factory)
   */
  has(name: string): boolean {
    return this.services.has(name) || this.factories.has(name) || this.mocks.has(name);
  }

  /**
   * Get all registered service names (instances + factories)
   */
  getNames(): string[] {
    const names = new Set([
      ...this.services.keys(),
      ...this.factories.keys(),
    ]);
    return Array.from(names);
  }

  /**
   * Try to get a service, returns undefined if not found
   */
  tryGet<T>(name: string): T | undefined {
    try {
      return this.get<T>(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Set a mock for a service (for testing)
   * Mocks take priority over registered services
   */
  mock<T>(name: string, instance: T): void {
    this.mocks.set(name, instance);
    log.debug(`Mocked service: ${name}`);
  }

  /**
   * Remove a mock
   */
  unmock(name: string): void {
    this.mocks.delete(name);
    log.debug(`Unmocked service: ${name}`);
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    this.mocks.clear();
    log.debug('Cleared all mocks');
  }

  /**
   * Reset registry to initial state (for testing)
   * Clears all services, factories, and mocks
   */
  reset(): void {
    this.services.clear();
    this.factories.clear();
    this.mocks.clear();
    this.frozen = false;
    log.debug('Registry reset');
  }

  /**
   * Register a service, replacing any existing registration
   * Use sparingly - mainly for testing
   */
  replace<T>(name: string, instance: T): void {
    if (this.frozen) {
      throw new Error(`Cannot replace service '${name}': registry is frozen`);
    }

    const existed = this.services.has(name);
    this.services.set(name, instance);
    log.debug(`${existed ? 'Replaced' : 'Registered'} service: ${name}`);
  }

  /**
   * Freeze the registry to prevent further modifications
   * Call after all services are registered
   */
  freeze(): void {
    this.frozen = true;
    log.info(`Registry frozen with ${this.services.size} services`);
  }

  /**
   * Check if registry is frozen
   */
  isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Clear all registrations (for testing only)
   */
  clear(): void {
    this.services.clear();
    this.frozen = false;
  }

  /**
   * Get summary of registered services
   */
  getSummary(): { count: number; services: string[]; frozen: boolean } {
    return {
      count: this.services.size,
      services: this.getNames(),
      frozen: this.frozen,
    };
  }
}

/**
 * Global service registry singleton
 */
export const serviceRegistry = new ServiceRegistry();

/**
 * Create a test registry pre-populated with mock services
 * Each call creates a fresh, isolated registry
 */
export function createTestRegistry(
  mocks: Record<string, unknown> = {}
): ServiceRegistry {
  const registry = new ServiceRegistry();

  for (const [name, mock] of Object.entries(mocks)) {
    registry.register(name, mock);
  }

  return registry;
}

/**
 * Standard service names for type-safe access
 */
export const ServiceNames = {
  SYNC: 'sync',
  MAINTENANCE: 'maintenance',
  AUDIT: 'audit',
  PRICE: 'price',
  NOTIFICATION: 'notification',
  TOKEN_REVOCATION: 'tokenRevocation',
  WALLET: 'wallet',
} as const;

export type ServiceName = (typeof ServiceNames)[keyof typeof ServiceNames];
