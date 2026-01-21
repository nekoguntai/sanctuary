/**
 * Sanctuary Wallet API Server
 *
 * Main entry point for the backend API server.
 * Handles Bitcoin wallet management, transactions, and user authentication.
 */

// Initialize OpenTelemetry tracing FIRST (before other imports)
// This must be at the very top to ensure auto-instrumentation works
import { initializeOpenTelemetry } from './utils/tracing/otel';

// Initialize OTEL synchronously at module load if enabled
// (actual async initialization happens in startServer)
const otelPromise = initializeOpenTelemetry();

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import config from './config';
import { registerRoutes } from './routes';
import { initializeWebSocketServer, initializeGatewayWebSocketServer } from './websocket/server';
import { initializeRedisBridge, shutdownRedisBridge } from './websocket/redisBridge';
import { notificationService } from './websocket/notifications';
import { getSyncService } from './services/syncService';
import { createLogger } from './utils/logger';
import { validateEncryptionKey } from './utils/encryption';
import { requestLogger } from './middleware/requestLogger';
import { requestTimeout } from './middleware/requestTimeout';
import { apiVersionMiddleware } from './middleware/apiVersion';
import { migrationService } from './services/migrationService';
import { maintenanceService } from './services/maintenanceService';
import { getStartupStatus, isSystemDegraded } from './services/startupManager';
import { registerService, startRegisteredServices, stopRegisteredServices } from './services/serviceRegistry';
import { initializeRevocationService, shutdownRevocationService } from './services/tokenRevocation';
import { featureFlagService } from './services/featureFlagService';
import { rateLimitService } from './services/rateLimiting';
import { jobQueue, maintenanceJobs } from './jobs';
import { metricsService } from './observability';
import { metricsMiddleware } from './middleware/metrics';
import { i18nMiddleware } from './middleware/i18n';
import { i18nService } from './i18n/i18nService';
import { connectWithRetry, disconnect, startDatabaseHealthCheck, stopDatabaseHealthCheck } from './models/prisma';
import { initializeRedis, shutdownRedis, isRedisConnected, shutdownDistributedLock } from './infrastructure';
import { shutdownElectrumPool } from './services/bitcoin/electrumPool';
import { cache, warmCaches } from './services/cache/cacheService';
import { walletLogBuffer } from './services/walletLogBuffer';
import { deadLetterQueue } from './services/deadLetterQueue';
import { initializeCacheInvalidation, shutdownCacheInvalidation } from './services/cacheInvalidation';

const log = createLogger('SERVER');

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception - process will exit', {
    error: error.message,
    stack: error.stack,
  });
  // Give time for logs to flush
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Don't exit for unhandled rejections, but log them
  // In production, you might want to exit here too
});

// Validate required environment variables at startup
try {
  validateEncryptionKey();
} catch (error) {
  console.error('FATAL: Missing required environment variable');
  console.error((error as Error).message);
  console.error('Please set ENCRYPTION_KEY in your .env file (at least 32 characters)');
  process.exit(1);
}

// Initialize Express app
const app: Express = express();

// Trust first proxy (nginx) for accurate client IP in rate limiting
app.set('trust proxy', 1);

// ========================================
// MIDDLEWARE
// ========================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'], // Required for React patterns + Swagger UI CDN
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Required for some WebUSB hardware wallet integrations
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// CORS configuration
app.use(cors({
  origin: config.nodeEnv === 'development' ? true : config.clientUrl,
  credentials: true,
}));

// Response compression (gzip/deflate) - reduces API response sizes by 60-80%
app.use(compression({
  // Only compress responses > 1KB
  threshold: 1024,
  // Skip compression if client doesn't support it
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

// Body parsing (200MB limit for backup/restore operations with large wallets)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Request logging and correlation IDs
app.use(requestLogger);

// Request timeout protection (prevents hanging requests)
app.use(requestTimeout);

// Prometheus metrics collection
app.use(metricsMiddleware());

// Internationalization (locale detection from Accept-Language header)
app.use(i18nMiddleware());

// API versioning (supports Accept header, X-API-Version header, query param)
app.use('/api', apiVersionMiddleware({
  defaultVersion: 1,
  currentVersion: 1,
  minVersion: 1,
  deprecatedVersions: [],
  sunsetVersions: [],
}));

// ========================================
// ROUTES
// ========================================

registerRoutes(app);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  log.error('Unhandled error', { error: err });
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : 'Something went wrong',
  });
});

// ========================================
// SERVER START
// ========================================

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket servers
const wsServer = initializeWebSocketServer();
const gatewayWsServer = initializeGatewayWebSocketServer();

// Handle WebSocket upgrades - route to correct server based on path
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = request.url || '';

  if (pathname === '/ws' || pathname.startsWith('/ws?')) {
    wsServer.handleUpgrade(request, socket, head);
  } else if (pathname === '/gateway' || pathname.startsWith('/gateway?')) {
    gatewayWsServer.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// Define background services with startup manager
const syncService = getSyncService();

registerService({
  name: 'notifications',
  start: () => notificationService.start(),
  stop: () => notificationService.stop(),
  critical: false,
  maxRetries: 2,
  backoffMs: [1000, 3000],
});
registerService({
  name: 'sync',
  start: () => syncService.start(),
  stop: () => syncService.stop(),
  critical: false,
  maxRetries: 3,
  backoffMs: [2000, 5000, 10000],
});
registerService({
  name: 'maintenance',
  start: async () => { maintenanceService.start(); },
  stop: () => maintenanceService.stop(),
  critical: false,
  maxRetries: 2,
  backoffMs: [1000, 2000],
});

// Run database connection and migrations before starting server
(async () => {
  try {
    const startupTimer = Date.now();

    // Wait for OpenTelemetry initialization (if enabled)
    await otelPromise;

    // Connect to database with retry logic (required first)
    await connectWithRetry();

    // Phase 1: Initialize services that only need database (parallel)
    log.info('Initializing core services...');
    await Promise.all([
      // These run in parallel - no interdependencies
      (async () => { startDatabaseHealthCheck(); })(),
      (async () => { initializeRevocationService(); })(),
      (async () => { metricsService.initialize(); })(),
      initializeRedis(), // Redis init
    ]);

    // Phase 2: Initialize services that need Redis (parallel)
    log.info('Initializing Redis-dependent services...');
    await Promise.all([
      initializeRedisBridge(),
      (async () => { initializeCacheInvalidation(); })(),
      (async () => { rateLimitService.initialize(); })(),
      (async () => { deadLetterQueue.start(); })(),
      jobQueue.initialize(),
    ]);

    // Register maintenance jobs
    for (const job of maintenanceJobs) {
      jobQueue.register(job);
    }

    // Phase 3: Schedule jobs + initialize remaining services (parallel)
    log.info('Scheduling jobs and finalizing services...');
    await Promise.all([
      // Job scheduling (only if queue available)
      (async () => {
        if (jobQueue.isAvailable()) {
          // Hourly cleanups
          await jobQueue.schedule('cleanup:expired-drafts', {}, { cron: '0 * * * *' });
          await jobQueue.schedule('cleanup:expired-transfers', {}, { cron: '30 * * * *' });

          // Daily cleanups
          await jobQueue.schedule('cleanup:audit-logs', { retentionDays: 90 }, { cron: '0 2 * * *' });
          await jobQueue.schedule('cleanup:price-data', { retentionDays: 30 }, { cron: '0 3 * * *' });
          await jobQueue.schedule('cleanup:fee-estimates', { retentionDays: 7 }, { cron: '0 4 * * *' });
          await jobQueue.schedule('cleanup:expired-tokens', {}, { cron: '0 5 * * *' });

          // Weekly maintenance (Sunday at 3 AM)
          await jobQueue.schedule('maintenance:weekly-vacuum', {}, { cron: '0 3 * * 0' });

          // Monthly cleanup (1st of month at 4 AM)
          await jobQueue.schedule('maintenance:monthly-cleanup', {}, { cron: '0 4 1 * *' });

          log.info('Scheduled recurring maintenance jobs');
        }
      })(),
      i18nService.initialize(),
      featureFlagService.initialize(),
    ]);

    log.info(`Service initialization completed in ${Date.now() - startupTimer}ms`);

    log.info('Checking database migrations...');
    const migrationResult = await migrationService.runMigrations();

    // Warm caches after all services are initialized (reduces cold-start latency)
    // This runs before server starts accepting requests
    await warmCaches();

    if (!migrationResult.success) {
      log.error('Database migration failed - server may not function correctly', {
        error: migrationResult.error,
      });
      // Continue anyway - some functionality may still work
    }

    // Start listening
    httpServer.listen(config.port, async () => {
      log.info('Sanctuary Wallet API Server starting');
      log.info(`Environment: ${config.nodeEnv}`);
      log.info(`Server: ${config.apiUrl}`);
      log.info(`Client: ${config.clientUrl}`);
      log.info(`Network: ${config.bitcoin.network}`);
      log.info(`Redis: ${isRedisConnected() ? 'connected' : 'in-memory fallback'}`);
      log.info(`HTTP Server running on port ${config.port}`);
      log.info(`WebSocket Server running on ws://localhost:${config.port}/ws`);

      // Start background services with resilient startup manager
      try {
        const startupResults = await startRegisteredServices();
        const startupStatus = getStartupStatus();

        for (const result of startupResults) {
          if (result.started) {
            log.info(`Service ${result.name} running`);
          } else if (result.degraded) {
            log.warn(`Service ${result.name} failed (degraded mode)`, { error: result.error });
          }
        }

        if (isSystemDegraded()) {
          log.warn('System running in degraded mode - some services failed to start');
        }

        log.info('All background services initialization complete', {
          duration: startupStatus.duration,
          started: startupResults.filter(r => r.started).length,
          degraded: startupResults.filter(r => r.degraded).length,
        });
      } catch (err) {
        log.error('Critical service startup failure', { error: (err as Error).message });
        // Critical service failed - this would have thrown, but handle gracefully
      }

      // Log final migration status
      await migrationService.logMigrationStatus();
    });
  } catch (error) {
    log.error('Failed to start server', {
      error: (error as Error).message,
    });
    process.exit(1);
  }
})();

// Graceful shutdown configuration
const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds to drain connections
let isShuttingDown = false;

// Graceful shutdown handler with connection draining
const handleShutdown = async (signal: string) => {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    log.warn(`${signal} received again, already shutting down...`);
    return;
  }
  isShuttingDown = true;

  log.info(`${signal} received, starting graceful shutdown (${SHUTDOWN_TIMEOUT_MS / 1000}s timeout)...`);

  // Set a hard timeout - force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Don't let this timeout keep the process alive if everything else closes
  forceExitTimeout.unref();

  // Close WebSocket servers first (stop accepting new connections)
  wsServer.close();
  gatewayWsServer.close();

  // Stop background services
  await stopRegisteredServices();
  stopDatabaseHealthCheck();
  shutdownRevocationService();
  rateLimitService.shutdown();

  // Stop memory caches and buffers
  cache.stop();
  walletLogBuffer.stop();
  deadLetterQueue.stop();

  // Close Electrum connection pool
  try {
    await shutdownElectrumPool();
    log.info('Electrum pool closed');
  } catch (error) {
    log.error('Error closing Electrum pool', {
      error: (error as Error).message,
    });
  }

  // Shutdown job queue
  await jobQueue.shutdown();

  // Shutdown distributed lock infrastructure
  shutdownDistributedLock();

  // Shutdown cache invalidation (before Redis shutdown)
  shutdownCacheInvalidation();

  // Shutdown Redis WebSocket bridge
  await shutdownRedisBridge();

  // Shutdown Redis infrastructure
  await shutdownRedis();

  // Close database connection
  try {
    await disconnect();
  } catch (error) {
    log.error('Error disconnecting from database', {
      error: (error as Error).message,
    });
  }

  // Close HTTP server and wait for active connections to drain
  httpServer.close(() => {
    clearTimeout(forceExitTimeout);
    log.info('Server closed gracefully');
    process.exit(0);
  });
};

// Graceful shutdown on SIGTERM and SIGINT
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default app;
