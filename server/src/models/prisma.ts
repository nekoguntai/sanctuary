/**
 * Prisma Client Instance
 *
 * Singleton instance of Prisma Client for database operations.
 *
 * Features:
 * - Connection retry logic for startup resilience
 * - Slow query detection middleware
 * - Graceful shutdown handling
 * - Periodic health check with auto-reconnection
 *
 * Connection pool and timeouts are configured via DATABASE_URL:
 * postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30&connect_timeout=10&statement_timeout=30000
 *
 * Timeout parameters:
 * - connection_limit: Max connections in pool (default: 20)
 * - pool_timeout: Wait time for connection from pool in seconds (default: 30)
 * - connect_timeout: Connection establishment timeout in seconds (default: 10)
 * - statement_timeout: Query execution timeout in milliseconds (default: 30000)
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';
import { dbQueryDuration } from '../observability/metrics';

const log = createLogger('DB');

// Slow query threshold in milliseconds
const SLOW_QUERY_THRESHOLD_MS = 100;

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

// Create Prisma client instance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

/**
 * Map Prisma actions to operation categories for metrics
 * @internal Exported for testing
 */
export function getOperationType(action: string): string {
  if (['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'].includes(action)) {
    return 'select';
  }
  if (['create', 'createMany'].includes(action)) {
    return 'insert';
  }
  if (['update', 'updateMany', 'upsert'].includes(action)) {
    return 'update';
  }
  if (['delete', 'deleteMany'].includes(action)) {
    return 'delete';
  }
  return 'other';
}

// Rolling window for latency tracking (pool health watchdog)
const LATENCY_WINDOW_SIZE = 100;
const latencyWindow: number[] = [];

// Add slow query detection, metrics, and pool health tracking middleware
prisma.$use(async (params, next) => {
  const before = Date.now();
  const result = await next(params);
  const duration = Date.now() - before;

  // Record query duration metric
  const operation = getOperationType(params.action || 'unknown');
  dbQueryDuration.observe({ operation }, duration / 1000);

  // Record for pool health monitoring
  latencyWindow.push(duration);
  if (latencyWindow.length > LATENCY_WINDOW_SIZE) {
    latencyWindow.shift();
  }

  if (duration > SLOW_QUERY_THRESHOLD_MS) {
    log.warn(`Slow query (${duration}ms): ${params.model}.${params.action}`, {
      model: params.model,
      action: params.action,
      duration,
    });
  }

  return result;
});

/**
 * Connect to database with retry logic
 * Implements exponential backoff for resilience during startup
 */
export async function connectWithRetry(): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.info(`Connecting to database (attempt ${attempt}/${MAX_RETRIES})...`);
      await prisma.$connect();
      log.info('Database connection established');
      return;
    } catch (error) {
      lastError = error as Error;
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
        MAX_RETRY_DELAY_MS
      );

      if (attempt < MAX_RETRIES) {
        log.warn(`Database connection failed, retrying in ${delay}ms...`, {
          attempt,
          maxRetries: MAX_RETRIES,
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  log.error('Failed to connect to database after all retries', {
    maxRetries: MAX_RETRIES,
    error: lastError?.message,
  });
  throw lastError;
}

/**
 * Check database health
 * Returns true if database is accessible
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Database health check failed', {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Get database connection info for health endpoints
 */
export async function getDatabaseInfo(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Graceful disconnect
 */
export async function disconnect(): Promise<void> {
  log.info('Disconnecting from database...');
  await prisma.$disconnect();
  log.info('Database disconnected');
}

// Database health check and reconnection
let healthCheckInterval: NodeJS.Timeout | null = null;
let isReconnecting = false;

// =============================================================================
// Pool Health Watchdog
// =============================================================================

/**
 * Pool health metrics for monitoring
 */
export interface PoolHealthMetrics {
  /** Average query latency in ms */
  avgLatencyMs: number;
  /** Max query latency in ms */
  maxLatencyMs: number;
  /** Number of queries in the sample window */
  queryCount: number;
  /** Health status based on latency thresholds */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Warning message if status is not healthy */
  warning?: string;
}

// Pool health thresholds
let poolWarningThresholdMs = 100; // Warn if avg latency exceeds this
let poolCriticalThresholdMs = 500; // Critical if avg latency exceeds this

/**
 * Get pool health metrics
 */
export function getPoolHealthMetrics(): PoolHealthMetrics {
  if (latencyWindow.length === 0) {
    return {
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      queryCount: 0,
      status: 'healthy',
    };
  }

  const avgLatencyMs = latencyWindow.reduce((a, b) => a + b, 0) / latencyWindow.length;
  const maxLatencyMs = Math.max(...latencyWindow);

  let status: PoolHealthMetrics['status'] = 'healthy';
  let warning: string | undefined;

  if (avgLatencyMs > poolCriticalThresholdMs) {
    status = 'unhealthy';
    warning = `Average query latency ${avgLatencyMs.toFixed(0)}ms exceeds critical threshold ${poolCriticalThresholdMs}ms`;
  } else if (avgLatencyMs > poolWarningThresholdMs) {
    status = 'degraded';
    warning = `Average query latency ${avgLatencyMs.toFixed(0)}ms exceeds warning threshold ${poolWarningThresholdMs}ms`;
  }

  return {
    avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
    maxLatencyMs,
    queryCount: latencyWindow.length,
    status,
    warning,
  };
}

/**
 * Configure pool health thresholds
 */
export function configurePoolHealthThresholds(options: {
  warningThresholdMs?: number;
  criticalThresholdMs?: number;
}): void {
  if (options.warningThresholdMs !== undefined) {
    poolWarningThresholdMs = options.warningThresholdMs;
  }
  if (options.criticalThresholdMs !== undefined) {
    poolCriticalThresholdMs = options.criticalThresholdMs;
  }
}

/**
 * Start database health check monitoring
 * Periodically checks connection and reconnects if needed
 */
export function startDatabaseHealthCheck(intervalMs: number = 30000): void {
  if (healthCheckInterval) {
    return; // Already running
  }

  healthCheckInterval = setInterval(async () => {
    const isHealthy = await checkDatabaseHealth();

    if (!isHealthy && !isReconnecting) {
      isReconnecting = true;
      log.warn('Database connection lost, attempting to reconnect...');

      try {
        // Disconnect and reconnect
        await prisma.$disconnect();
        await connectWithRetry();
        log.info('Database reconnection successful');
      } catch (error) {
        log.error('Database reconnection failed', {
          error: (error as Error).message,
        });
      } finally {
        isReconnecting = false;
      }
    }
  }, intervalMs);

  // Prevent interval from keeping process alive during shutdown
  healthCheckInterval.unref();

  log.debug('Database health check monitoring started');
}

/**
 * Stop database health check monitoring
 */
export function stopDatabaseHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    log.debug('Database health check monitoring stopped');
  }
}

// Handle cleanup on shutdown
process.on('beforeExit', async () => {
  stopDatabaseHealthCheck();
  await prisma.$disconnect();
});

export default prisma;
