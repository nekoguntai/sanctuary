/**
 * Worker Health Monitoring
 *
 * Tracks dedicated worker availability for worker-required deployments.
 */

import { getConfig } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('WorkerHealth');

export type WorkerAvailability = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface WorkerHealthStatus {
  healthy: boolean;
  availability: WorkerAvailability;
  url: string;
  checkedAt: string | null;
  latencyMs: number | null;
  error?: string;
}

let healthMonitor: NodeJS.Timeout | null = null;
let lastStatus: WorkerHealthStatus = {
  healthy: false,
  availability: 'unknown',
  url: '',
  checkedAt: null,
  latencyMs: null,
};

export function getWorkerHealthStatus(): WorkerHealthStatus {
  return { ...lastStatus };
}

export async function probeWorkerHealth(): Promise<WorkerHealthStatus> {
  const config = getConfig();
  const { healthUrl, healthTimeoutMs } = config.worker;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthTimeoutMs);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null) as { status?: string } | null;
    const workerStatus = payload?.status;

    // Worker /health returns 503 when degraded. That state is still reachable
    // and should not fail API readiness/startup checks.
    if (!response.ok) {
      if (response.status === 503 || workerStatus === 'degraded') {
        lastStatus = {
          healthy: true,
          availability: 'degraded',
          url: healthUrl,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          error: workerStatus
            ? `Worker reachable but reports ${workerStatus}`
            : `Worker reachable but returned HTTP ${response.status}`,
        };
        return { ...lastStatus };
      }
      throw new Error(`Worker health check returned HTTP ${response.status}`);
    }

    if (workerStatus && workerStatus !== 'healthy') {
      lastStatus = {
        healthy: true,
        availability: 'degraded',
        url: healthUrl,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: `Worker reachable but reports ${workerStatus}`,
      };
      return { ...lastStatus };
    }

    lastStatus = {
      healthy: true,
      availability: 'healthy',
      url: healthUrl,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    return { ...lastStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastStatus = {
      healthy: false,
      availability: 'unhealthy',
      url: healthUrl,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: message,
    };
    return { ...lastStatus };
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertWorkerHealthy(): Promise<void> {
  const status = await probeWorkerHealth();
  if (status.availability === 'unhealthy') {
    throw new Error(`Worker is required but unavailable (${status.url}): ${status.error || 'unknown error'}`);
  }
}

export async function startWorkerHealthMonitor(): Promise<void> {
  const config = getConfig();

  // Always probe once to initialize snapshot
  await probeWorkerHealth();

  await assertWorkerHealthy();

  if (healthMonitor) {
    return;
  }

  healthMonitor = setInterval(() => {
    probeWorkerHealth()
      .then((status) => {
        if (status.availability === 'unhealthy') {
          log.warn('Worker health probe failed', {
            error: status.error,
            url: status.url,
          });
        } else if (status.availability === 'degraded') {
          log.warn('Worker health probe degraded', {
            error: status.error,
            url: status.url,
          });
        }
      })
      .catch((error) => {
        log.warn('Worker health monitor probe failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, config.worker.healthCheckIntervalMs);

  healthMonitor.unref?.();
}

export function stopWorkerHealthMonitor(): void {
  if (healthMonitor) {
    clearInterval(healthMonitor);
    healthMonitor = null;
  }
}
