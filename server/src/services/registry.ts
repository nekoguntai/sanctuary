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

import type { IServiceRegistry } from './interfaces';
import { createLogger } from '../utils/logger';

const log = createLogger('REGISTRY');

/**
 * Default service registry implementation
 */
class ServiceRegistry implements IServiceRegistry {
  private services = new Map<string, unknown>();
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
   * Get a registered service
   * @throws if service not found
   */
  get<T>(name: string): T {
    const service = this.services.get(name);
    if (service === undefined) {
      throw new Error(`Service '${name}' not found in registry`);
    }
    return service as T;
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get all registered service names
   */
  getNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Try to get a service, returns undefined if not found
   */
  tryGet<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
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
