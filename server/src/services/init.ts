/**
 * Service Initialization
 *
 * Registers all services with the service registry.
 * This should be called early in the application startup.
 *
 * Usage:
 *   import { initializeServices } from './services/init';
 *   await initializeServices();
 *
 * After initialization, services can be accessed via the registry:
 *   import { serviceRegistry, ServiceNames } from './services/registry';
 *   const syncService = serviceRegistry.get<ISyncService>(ServiceNames.SYNC);
 */

import { serviceRegistry, ServiceNames } from './registry';
import { createLogger } from '../utils/logger';
import { getSyncService } from './syncService';
import { maintenanceService } from './maintenanceService';
import { notificationChannelRegistry } from './notifications/channels';
import { getPriceService } from './price';
import * as tokenRevocationService from './tokenRevocation';

const log = createLogger('SERVICES:INIT');

let initialized = false;

/**
 * Initialize and register all services
 */
export async function initializeServices(): Promise<void> {
  if (initialized) {
    log.debug('Services already initialized, skipping');
    return;
  }

  log.info('Initializing services...');

  // Register sync service
  serviceRegistry.registerFactory(ServiceNames.SYNC, () => getSyncService());

  // Register maintenance service
  serviceRegistry.registerFactory(ServiceNames.MAINTENANCE, () => maintenanceService);

  // Register notification service
  serviceRegistry.registerFactory(ServiceNames.NOTIFICATION, () => notificationChannelRegistry);

  // Register price service
  serviceRegistry.registerFactory(ServiceNames.PRICE, () => getPriceService());

  // Register token revocation service
  serviceRegistry.registerFactory(ServiceNames.TOKEN_REVOCATION, () => tokenRevocationService);

  // Freeze registry to prevent accidental modifications
  // Note: Mocks can still be set for testing
  // serviceRegistry.freeze(); // Uncomment in production after testing

  initialized = true;
  log.info('Services initialized', serviceRegistry.getSummary());
}

/**
 * Get service initialization status
 */
export function isServicesInitialized(): boolean {
  return initialized;
}

/**
 * Reset service registry (for testing)
 */
export function resetServices(): void {
  serviceRegistry.reset();
  initialized = false;
  log.debug('Services reset');
}

/**
 * Get a type-safe service accessor helper
 * This provides a cleaner API for common service access patterns
 */
export const services = {
  get sync() {
    return serviceRegistry.get(ServiceNames.SYNC);
  },
  get maintenance() {
    return serviceRegistry.get(ServiceNames.MAINTENANCE);
  },
  get notification() {
    return serviceRegistry.get(ServiceNames.NOTIFICATION);
  },
  get price() {
    return serviceRegistry.get(ServiceNames.PRICE);
  },
  get tokenRevocation() {
    return serviceRegistry.get(ServiceNames.TOKEN_REVOCATION);
  },
};
