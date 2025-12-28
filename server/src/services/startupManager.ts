/**
 * Startup Manager
 *
 * Manages service initialization with resilience patterns.
 * Provides consistent error handling, retry logic, and health reporting
 * for all background services.
 *
 * Features:
 * - Retry with exponential backoff for transient failures
 * - Critical vs non-critical service distinction
 * - Startup health reporting
 * - Graceful degradation for failed services
 */

import { executeWithRecovery, createRecoveryPolicy } from './recoveryPolicy';
import { createLogger } from '../utils/logger';

const log = createLogger('STARTUP');

/**
 * Service startup result
 */
export interface ServiceStartupResult {
  name: string;
  started: boolean;
  attempts: number;
  duration: number;
  error?: string;
  degraded?: boolean;
}

/**
 * Service definition for startup manager
 */
export interface ServiceDefinition {
  /** Unique service name */
  name: string;
  /** Function to start the service */
  start: () => Promise<void>;
  /** If true, server exits on failure. If false, continues in degraded mode */
  critical: boolean;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Backoff delays in ms (default: [1000, 3000, 5000]) */
  backoffMs?: number[];
  /** Optional dependencies - will wait for these services to start first */
  dependsOn?: string[];
}

/**
 * Startup manager state
 */
interface StartupState {
  services: Map<string, ServiceStartupResult>;
  startedAt: Date | null;
  completedAt: Date | null;
  overallSuccess: boolean;
}

const state: StartupState = {
  services: new Map(),
  startedAt: null,
  completedAt: null,
  overallSuccess: false,
};

/**
 * Default recovery policy for service startup
 */
const defaultStartupPolicy = createRecoveryPolicy('service:startup', {
  maxRetries: 3,
  backoffMs: [1000, 3000, 5000],
  onExhausted: 'continue',
  jitter: true,
});

/**
 * Start a single service with retry logic
 */
async function startService(service: ServiceDefinition): Promise<ServiceStartupResult> {
  const startTime = Date.now();
  const policy = createRecoveryPolicy(`service:${service.name}`, {
    maxRetries: service.maxRetries ?? defaultStartupPolicy.maxRetries,
    backoffMs: service.backoffMs ?? defaultStartupPolicy.backoffMs,
    onExhausted: service.critical ? 'notify' : 'continue',
    jitter: true,
  });

  log.info(`Starting service: ${service.name}`, {
    critical: service.critical,
    maxRetries: policy.maxRetries,
  });

  const result = await executeWithRecovery(
    policy,
    service.start,
    {
      onRetry: (attempt, error, delayMs) => {
        log.warn(`Service ${service.name} start attempt ${attempt} failed, retrying in ${delayMs}ms`, {
          error: error.message,
        });
      },
      onExhausted: (action, error) => {
        if (service.critical) {
          log.error(`Critical service ${service.name} failed to start after all retries`, {
            error: error.message,
            action,
          });
        } else {
          log.warn(`Non-critical service ${service.name} failed to start, continuing in degraded mode`, {
            error: error.message,
          });
        }
      },
    }
  );

  const startupResult: ServiceStartupResult = {
    name: service.name,
    started: result.success,
    attempts: result.attempts,
    duration: Date.now() - startTime,
    error: result.finalError?.message,
    degraded: !result.success && !service.critical,
  };

  state.services.set(service.name, startupResult);

  if (result.success) {
    log.info(`Service ${service.name} started successfully`, {
      attempts: result.attempts,
      duration: startupResult.duration,
    });
  }

  return startupResult;
}

/**
 * Start all services with dependency ordering
 */
export async function startAllServices(
  services: ServiceDefinition[]
): Promise<ServiceStartupResult[]> {
  state.startedAt = new Date();
  state.services.clear();

  const results: ServiceStartupResult[] = [];
  const started = new Set<string>();

  // Sort services by dependencies
  const sortedServices = topologicalSort(services);

  for (const service of sortedServices) {
    // Check dependencies are started
    if (service.dependsOn) {
      const missingDeps = service.dependsOn.filter(dep => !started.has(dep));
      if (missingDeps.length > 0) {
        log.warn(`Service ${service.name} has unmet dependencies`, { missing: missingDeps });
        // Skip if dependencies failed
        const failedDeps = missingDeps.filter(dep => {
          const depResult = state.services.get(dep);
          return depResult && !depResult.started;
        });
        if (failedDeps.length > 0) {
          const result: ServiceStartupResult = {
            name: service.name,
            started: false,
            attempts: 0,
            duration: 0,
            error: `Dependencies failed: ${failedDeps.join(', ')}`,
            degraded: !service.critical,
          };
          results.push(result);
          state.services.set(service.name, result);
          continue;
        }
      }
    }

    const result = await startService(service);
    results.push(result);

    if (result.started) {
      started.add(service.name);
    }

    // Exit if critical service failed
    if (!result.started && service.critical) {
      log.error(`Critical service ${service.name} failed, aborting startup`);
      state.completedAt = new Date();
      state.overallSuccess = false;
      throw new Error(`Critical service ${service.name} failed to start: ${result.error}`);
    }
  }

  state.completedAt = new Date();
  state.overallSuccess = results.every(r => r.started || r.degraded);

  const summary = {
    total: results.length,
    started: results.filter(r => r.started).length,
    failed: results.filter(r => !r.started && !r.degraded).length,
    degraded: results.filter(r => r.degraded).length,
    duration: state.completedAt.getTime() - state.startedAt.getTime(),
  };

  log.info('Service startup complete', summary);

  return results;
}

/**
 * Topological sort for dependency ordering
 */
function topologicalSort(services: ServiceDefinition[]): ServiceDefinition[] {
  const result: ServiceDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const serviceMap = new Map(services.map(s => [s.name, s]));

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }

    const service = serviceMap.get(name);
    if (!service) return;

    visiting.add(name);

    for (const dep of service.dependsOn ?? []) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    result.push(service);
  }

  for (const service of services) {
    visit(service.name);
  }

  return result;
}

/**
 * Get startup status for health endpoint
 */
export function getStartupStatus(): {
  started: boolean;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  overallSuccess: boolean;
  services: ServiceStartupResult[];
} {
  return {
    started: state.startedAt !== null,
    startedAt: state.startedAt?.toISOString() ?? null,
    completedAt: state.completedAt?.toISOString() ?? null,
    duration: state.startedAt && state.completedAt
      ? state.completedAt.getTime() - state.startedAt.getTime()
      : null,
    overallSuccess: state.overallSuccess,
    services: Array.from(state.services.values()),
  };
}

/**
 * Check if a specific service is running
 */
export function isServiceRunning(name: string): boolean {
  const result = state.services.get(name);
  return result?.started ?? false;
}

/**
 * Check if system is in degraded mode
 */
export function isSystemDegraded(): boolean {
  return Array.from(state.services.values()).some(s => s.degraded);
}

/**
 * Get list of degraded services
 */
export function getDegradedServices(): string[] {
  return Array.from(state.services.values())
    .filter(s => s.degraded)
    .map(s => s.name);
}
