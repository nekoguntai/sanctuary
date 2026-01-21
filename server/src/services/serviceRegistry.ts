/**
 * Service Registry
 *
 * Centralized registration for start/stop lifecycle of background services.
 */

import { startAllServices, type ServiceDefinition, type ServiceStartupResult } from './startupManager';
import { createLogger } from '../utils/logger';

export interface ManagedService extends ServiceDefinition {
  stop?: () => Promise<void> | void;
}

const log = createLogger('ServiceRegistry');
const services = new Map<string, ManagedService>();

export function registerService(service: ManagedService): void {
  if (services.has(service.name)) {
    log.warn('Overwriting registered service', { name: service.name });
  }
  services.set(service.name, service);
}

export function getRegisteredServices(): ManagedService[] {
  return Array.from(services.values());
}

export async function startRegisteredServices(): Promise<ServiceStartupResult[]> {
  return startAllServices(getRegisteredServices());
}

export async function stopRegisteredServices(): Promise<void> {
  const registered = getRegisteredServices().slice().reverse();

  for (const service of registered) {
    if (!service.stop) continue;
    try {
      await service.stop();
    } catch (error) {
      log.warn('Failed to stop service', {
        name: service.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

