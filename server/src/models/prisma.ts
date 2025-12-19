/**
 * Prisma Client Instance
 *
 * Singleton instance of Prisma Client for database operations.
 *
 * Connection pool is configured via DATABASE_URL:
 * postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';

const log = createLogger('DB');

// Slow query threshold in milliseconds
const SLOW_QUERY_THRESHOLD_MS = 100;

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

// Handle cleanup on shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
