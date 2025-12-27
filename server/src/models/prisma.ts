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

// Add slow query detection middleware
prisma.$use(async (params, next) => {
  const before = Date.now();
  const result = await next(params);
  const duration = Date.now() - before;

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
