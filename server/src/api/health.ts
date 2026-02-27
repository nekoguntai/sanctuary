/**
 * Health Check API
 *
 * Provides comprehensive health status for monitoring and alerting.
 * Aggregates status from database, external services, and internal components.
 */

import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { circuitBreakerRegistry } from '../services/circuitBreaker';
import { getSyncService } from '../services/syncService';
import { getWebSocketServer } from '../websocket/server';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { checkRedisHealth } from '../infrastructure/redis';
import { jobQueue } from '../jobs';
import { getCacheInvalidationStatus } from '../services/cacheInvalidation';
import { getStartupStatus } from '../services/startupManager';

const router = Router();
const log = createLogger('HEALTH');

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  latency?: number;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    electrum: ComponentHealth;
    websocket: ComponentHealth;
    sync: ComponentHealth;
    jobQueue: ComponentHealth;
    cacheInvalidation: ComponentHealth;
    startup: ComponentHealth;
    circuitBreakers: ComponentHealth;
    memory: ComponentHealth;
  };
}

const startTime = Date.now();

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      latency: Date.now() - start,
    };
  } catch (error) {
    log.error('Database health check failed', { error });
    return {
      status: 'unhealthy',
      message: getErrorMessage(error, 'Database unreachable'),
      latency: Date.now() - start,
    };
  }
}

/**
 * Check Electrum/blockchain service status
 */
function checkElectrum(): ComponentHealth {
  const breakers = circuitBreakerRegistry.getAllHealth();
  const electrumBreaker = breakers.find(b => b.name.includes('electrum'));

  if (!electrumBreaker) {
    return {
      status: 'healthy',
      message: 'No circuit breaker registered',
    };
  }

  if (electrumBreaker.state === 'open') {
    return {
      status: 'unhealthy',
      message: 'Circuit open - service unavailable',
      details: {
        failures: electrumBreaker.failures,
        lastFailure: electrumBreaker.lastFailure,
      },
    };
  }

  if (electrumBreaker.state === 'half-open') {
    return {
      status: 'degraded',
      message: 'Circuit half-open - recovering',
      details: {
        successes: electrumBreaker.successes,
      },
    };
  }

  return {
    status: 'healthy',
    details: {
      totalRequests: electrumBreaker.totalRequests,
      lastSuccess: electrumBreaker.lastSuccess,
    },
  };
}

/**
 * Check WebSocket server status
 */
function checkWebSocket(): ComponentHealth {
  try {
    const wsServer = getWebSocketServer();
    if (!wsServer) {
      return {
        status: 'degraded',
        message: 'WebSocket server not initialized',
      };
    }

    const stats = wsServer.getStats();
    return {
      status: 'healthy',
      details: {
        connections: stats.clients,
        maxConnections: stats.maxClients,
        subscriptions: stats.subscriptions,
        uniqueUsers: stats.uniqueUsers,
      },
    };
  } catch {
    return {
      status: 'degraded',
      message: 'WebSocket stats unavailable',
    };
  }
}

/**
 * Check sync service status
 */
function checkSync(): ComponentHealth {
  try {
    const syncService = getSyncService();
    const metrics = syncService.getHealthMetrics();

    if (!metrics.isRunning) {
      return {
        status: 'degraded',
        message: 'Sync service not running',
      };
    }

    // Check if there are stalled jobs
    const hasStalled = metrics.queueLength > 10 && metrics.activeSyncs === 0;
    if (hasStalled) {
      return {
        status: 'degraded',
        message: 'Sync queue appears stalled',
        details: metrics,
      };
    }

    return {
      status: 'healthy',
      details: {
        queueLength: metrics.queueLength,
        activeSyncs: metrics.activeSyncs,
        subscribedAddresses: metrics.subscribedAddresses,
        subscriptionsEnabled: metrics.subscriptionsEnabled,
        subscriptionOwnership: metrics.subscriptionOwnership,
      },
    };
  } catch {
    return {
      status: 'degraded',
      message: 'Sync stats unavailable',
    };
  }
}

/**
 * Check Redis status
 */
async function checkRedis(): Promise<ComponentHealth> {
  const redisHealth = await checkRedisHealth();

  if (redisHealth.status === 'healthy') {
    return {
      status: 'healthy',
      latency: redisHealth.latencyMs,
    };
  }

  return {
    status: redisHealth.status === 'degraded' ? 'degraded' : 'unhealthy',
    message: redisHealth.error,
    latency: redisHealth.latencyMs,
  };
}

/**
 * Check job queue status
 */
async function checkJobQueue(): Promise<ComponentHealth> {
  const health = await jobQueue.getHealth();
  const status = health.healthy ? 'healthy' : 'unhealthy';

  return {
    status,
    details: {
      queueName: health.queueName,
      waiting: health.waiting,
      active: health.active,
      completed: health.completed,
      failed: health.failed,
      delayed: health.delayed,
      paused: health.paused,
    },
  };
}

/**
 * Check cache invalidation status
 */
function checkCacheInvalidation(): ComponentHealth {
  const status = getCacheInvalidationStatus();

  if (!status.initialized) {
    return {
      status: 'degraded',
      message: 'Cache invalidation not initialized',
      details: status,
    };
  }

  return {
    status: 'healthy',
    details: status,
  };
}

/**
 * Check startup manager status
 */
function checkStartup(): ComponentHealth {
  const status = getStartupStatus();

  if (!status.started) {
    return {
      status: 'degraded',
      message: 'Startup not initiated',
      details: status,
    };
  }

  if (!status.overallSuccess) {
    return {
      status: 'unhealthy',
      message: 'Startup failed for one or more services',
      details: status,
    };
  }

  const hasDegraded = status.services.some(service => service.degraded);
  if (hasDegraded) {
    return {
      status: 'degraded',
      message: 'One or more services running in degraded mode',
      details: status,
    };
  }

  return {
    status: 'healthy',
    details: status,
  };
}

/**
 * Check all circuit breakers
 */
function checkCircuitBreakers(): ComponentHealth {
  const breakers = circuitBreakerRegistry.getAllHealth();

  if (breakers.length === 0) {
    return {
      status: 'healthy',
      message: 'No circuit breakers registered',
    };
  }

  const openBreakers = breakers.filter(b => b.state === 'open');
  const halfOpenBreakers = breakers.filter(b => b.state === 'half-open');

  if (openBreakers.length === breakers.length) {
    return {
      status: 'unhealthy',
      message: `All ${breakers.length} circuits open`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  if (openBreakers.length > 0) {
    return {
      status: 'degraded',
      message: `${openBreakers.length}/${breakers.length} circuits open`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  if (halfOpenBreakers.length > 0) {
    return {
      status: 'degraded',
      message: `${halfOpenBreakers.length}/${breakers.length} circuits recovering`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  return {
    status: 'healthy',
    details: {
      total: breakers.length,
      healthy: breakers.filter(b => b.state === 'closed').length,
    },
  };
}

// Memory threshold for degraded status (500MB heap usage)
const MEMORY_THRESHOLD_DEGRADED = 500 * 1024 * 1024; // 500MB
// Memory threshold for unhealthy status (1GB heap usage)
const MEMORY_THRESHOLD_UNHEALTHY = 1024 * 1024 * 1024; // 1GB

/**
 * Check memory usage
 */
function checkMemory(): ComponentHealth {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);

  let status: HealthStatus = 'healthy';
  let message: string | undefined;

  if (mem.heapUsed >= MEMORY_THRESHOLD_UNHEALTHY) {
    status = 'unhealthy';
    message = `High memory usage: ${heapUsedMB}MB heap`;
  } else if (mem.heapUsed >= MEMORY_THRESHOLD_DEGRADED) {
    status = 'degraded';
    message = `Elevated memory usage: ${heapUsedMB}MB heap`;
  }

  return {
    status,
    message,
    details: {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      rss: `${rssMB}MB`,
      external: `${externalMB}MB`,
      heapPercent: `${Math.round((mem.heapUsed / mem.heapTotal) * 100)}%`,
    },
  };
}

/**
 * Determine overall status from component statuses
 */
function determineOverallStatus(components: Record<string, ComponentHealth>): HealthStatus {
  const statuses = Object.values(components).map(c => c.status);

  // Database unhealthy = overall unhealthy
  if (components.database?.status === 'unhealthy') {
    return 'unhealthy';
  }

  if (components.redis?.status === 'unhealthy') {
    return 'unhealthy';
  }

  // Any unhealthy = overall degraded (unless database)
  if (statuses.includes('unhealthy')) {
    return 'degraded';
  }

  // Any degraded = overall degraded
  if (statuses.includes('degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * GET /api/v1/health
 * Comprehensive health check
 */
router.get('/', async (req: Request, res: Response) => {
  const components = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    electrum: checkElectrum(),
    websocket: checkWebSocket(),
    sync: checkSync(),
    jobQueue: await checkJobQueue(),
    cacheInvalidation: checkCacheInvalidation(),
    startup: checkStartup(),
    circuitBreakers: checkCircuitBreakers(),
    memory: checkMemory(),
  };

  const status = determineOverallStatus(components);

  const response: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '0.0.0',
    components,
  };

  // Return 503 for unhealthy, 200 for healthy/degraded
  const httpStatus = status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json(response);
});

/**
 * GET /api/v1/health/live
 * Kubernetes liveness probe - just checks if server is responding
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /api/v1/health/ready
 * Kubernetes readiness probe - checks if ready to accept traffic
 */
router.get('/ready', async (req: Request, res: Response) => {
  const dbHealth = await checkDatabase();

  if (dbHealth.status === 'unhealthy') {
    return res.status(503).json({
      status: 'not ready',
      reason: 'Database unavailable',
    });
  }

  res.status(200).json({ status: 'ready' });
});

/**
 * GET /api/v1/health/circuits
 * Detailed circuit breaker status
 */
router.get('/circuits', (req: Request, res: Response) => {
  const breakers = circuitBreakerRegistry.getAllHealth();
  res.json({
    overall: circuitBreakerRegistry.getOverallStatus(),
    circuits: breakers,
  });
});

export default router;
