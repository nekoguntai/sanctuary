/**
 * Read Replica Support
 *
 * Provides read replica routing for analytics and read-heavy queries.
 * Automatically routes reads to replica and writes to primary.
 *
 * ## Configuration
 *
 * Set READ_REPLICA_URL environment variable to enable read replica:
 * ```
 * DATABASE_URL=postgresql://user:pass@primary:5432/db
 * READ_REPLICA_URL=postgresql://user:pass@replica:5432/db
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { getReadClient, withReadReplica } from './infrastructure/readReplica';
 *
 * // Direct access to read replica client
 * const replica = getReadClient();
 * const results = await replica.transaction.findMany({ where: { walletId } });
 *
 * // Automatic routing based on operation
 * const data = await withReadReplica(
 *   () => prisma.transaction.findMany({ where: { walletId } })
 * );
 * ```
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';
import { db as prisma } from '../repositories/db';

const log = createLogger('ReadReplica');

// =============================================================================
// State
// =============================================================================

let readReplicaClient: PrismaClient | null = null;
let isReplicaEnabled = false;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize read replica if configured
 * Call during server startup
 */
export async function initializeReadReplica(): Promise<void> {
  const replicaUrl = process.env.READ_REPLICA_URL;

  if (!replicaUrl) {
    log.info('Read replica not configured, using primary for all queries');
    return;
  }

  try {
    log.info('Initializing read replica connection');

    readReplicaClient = new PrismaClient({
      datasources: {
        db: {
          url: replicaUrl,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
    });

    // Test connection
    await readReplicaClient.$connect();
    await readReplicaClient.$queryRaw`SELECT 1`;

    isReplicaEnabled = true;
    log.info('Read replica initialized successfully');
  } catch (error) {
    log.error('Failed to initialize read replica, falling back to primary', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    readReplicaClient = null;
    isReplicaEnabled = false;
  }
}

/**
 * Shutdown read replica connection
 */
export async function shutdownReadReplica(): Promise<void> {
  if (readReplicaClient) {
    await readReplicaClient.$disconnect();
    readReplicaClient = null;
    isReplicaEnabled = false;
    log.info('Read replica connection closed');
  }
}

// =============================================================================
// Accessors
// =============================================================================

/**
 * Get read replica client (or primary if replica not available)
 */
export function getReadClient(): PrismaClient {
  if (isReplicaEnabled && readReplicaClient) {
    return readReplicaClient;
  }
  return prisma;
}

/**
 * Get primary client (always returns main Prisma client)
 */
export function getPrimaryClient(): PrismaClient {
  return prisma;
}

/**
 * Check if read replica is enabled and healthy
 */
export function isReadReplicaEnabled(): boolean {
  return isReplicaEnabled;
}

/**
 * Check read replica health
 */
export async function checkReadReplicaHealth(): Promise<{
  enabled: boolean;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  if (!isReplicaEnabled || !readReplicaClient) {
    return { enabled: false, healthy: false };
  }

  try {
    const start = Date.now();
    await readReplicaClient.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    return {
      enabled: true,
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    return {
      enabled: true,
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// Query Routing Helpers
// =============================================================================

/**
 * Execute a query on the read replica
 * Falls back to primary if replica is unavailable
 */
export async function withReadReplica<T>(queryFn: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = getReadClient();
  return queryFn(client);
}

/**
 * Execute a query explicitly on the primary
 * Use for writes or when you need strong consistency
 */
export async function withPrimary<T>(queryFn: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = getPrimaryClient();
  return queryFn(client);
}

/**
 * Execute analytics queries on read replica
 * These are typically expensive aggregate queries
 */
export async function executeAnalyticsQuery<T>(
  queryFn: (client: PrismaClient) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  const client = getReadClient();
  const timeout = options?.timeout || 60000; // 1 minute default for analytics

  // Create timeout with proper cleanup to prevent timer leak
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Analytics query timeout')), timeout);
  });

  try {
    return await Promise.race([queryFn(client), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// =============================================================================
// Replication Lag Monitoring
// =============================================================================

let lastLagCheckMs = 0;
let estimatedLagMs = 0;

/**
 * Estimate replication lag
 * Uses timestamp comparison between primary and replica
 */
export async function estimateReplicationLag(): Promise<number> {
  if (!isReplicaEnabled || !readReplicaClient) {
    return 0;
  }

  try {
    // Get current timestamp from both
    const [primaryResult, replicaResult] = await Promise.all([
      prisma.$queryRaw`SELECT NOW() as ts` as Promise<[{ ts: Date }]>,
      readReplicaClient.$queryRaw`SELECT NOW() as ts` as Promise<[{ ts: Date }]>,
    ]);

    const primaryTs = new Date(primaryResult[0].ts).getTime();
    const replicaTs = new Date(replicaResult[0].ts).getTime();

    estimatedLagMs = Math.max(0, primaryTs - replicaTs);
    lastLagCheckMs = Date.now();

    if (estimatedLagMs > 5000) {
      log.warn('High replication lag detected', { lagMs: estimatedLagMs });
    }

    return estimatedLagMs;
  } catch (error) {
    log.error('Failed to estimate replication lag', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return -1;
  }
}

/**
 * Get last known replication lag
 */
export function getLastKnownLag(): { lagMs: number; checkedAt: number } {
  return {
    lagMs: estimatedLagMs,
    checkedAt: lastLagCheckMs,
  };
}

/**
 * Check if replica is acceptable for a query requiring freshness
 * @param maxLagMs Maximum acceptable lag in milliseconds
 */
export function isReplicaAcceptable(maxLagMs: number = 5000): boolean {
  if (!isReplicaEnabled) return false;
  if (Date.now() - lastLagCheckMs > 60000) return true; // Assume OK if not checked recently
  return estimatedLagMs <= maxLagMs;
}
