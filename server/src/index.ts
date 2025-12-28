/**
 * Sanctuary Wallet API Server
 *
 * Main entry point for the backend API server.
 * Handles Bitcoin wallet management, transactions, and user authentication.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import config from './config';
import authRoutes from './api/auth';
import walletRoutes from './api/wallets';
import deviceRoutes from './api/devices';
import transactionRoutes from './api/transactions';
import labelRoutes from './api/labels';
import bitcoinRoutes from './api/bitcoin';
import priceRoutes from './api/price';
import nodeRoutes from './api/node';
import adminRoutes from './api/admin';
import syncRoutes from './api/sync';
import pushRoutes from './api/push';
import draftRoutes from './api/drafts';
import payjoinRoutes from './api/payjoin';
import aiRoutes from './api/ai';
import aiInternalRoutes from './api/ai-internal';
import healthRoutes from './api/health';
import { initializeWebSocketServer, initializeGatewayWebSocketServer } from './websocket/server';
import { notificationService } from './websocket/notifications';
import { getSyncService } from './services/syncService';
import { createLogger } from './utils/logger';
import { validateEncryptionKey } from './utils/encryption';
import { requestLogger } from './middleware/requestLogger';
import { migrationService } from './services/migrationService';
import { maintenanceService } from './services/maintenanceService';
import { startAllServices, getStartupStatus, isSystemDegraded, type ServiceDefinition } from './services/startupManager';
import { initializeRevocationService, shutdownRevocationService } from './services/tokenRevocation';
import { connectWithRetry, disconnect, startDatabaseHealthCheck, stopDatabaseHealthCheck } from './models/prisma';

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
      scriptSrc: ["'self'", "'unsafe-inline'"], // Required for some React patterns
      styleSrc: ["'self'", "'unsafe-inline'"],
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

// Body parsing (200MB limit for backup/restore operations with large wallets)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Request logging and correlation IDs
app.use(requestLogger);

// ========================================
// ROUTES
// ========================================

// Health check routes (comprehensive health monitoring)
// Simple /health for basic liveness, /api/v1/health for detailed status
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// Comprehensive health check with component status
app.use('/api/v1/health', healthRoutes);

// API v1 routes
// Note: Routes with specific paths must come BEFORE catch-all routes mounted at /api/v1
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/wallets', walletRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/bitcoin', bitcoinRoutes);
app.use('/api/v1/price', priceRoutes);  // Public route - no auth required
app.use('/api/v1/node', nodeRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/push', pushRoutes);
app.use('/api/v1/ai', aiRoutes);  // AI-powered features (optional)
app.use('/internal/ai', aiInternalRoutes);  // Internal AI endpoints (AI container only)
// These routes are mounted at /api/v1 without a specific path - must come LAST
app.use('/api/v1', transactionRoutes);  // Transaction routes include wallet prefix
app.use('/api/v1', labelRoutes);  // Label routes include various prefixes
app.use('/api/v1', draftRoutes);  // Draft routes include wallet prefix
app.use('/api/v1/payjoin', payjoinRoutes);  // Payjoin (BIP78) routes

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

const backgroundServices: ServiceDefinition[] = [
  {
    name: 'notifications',
    start: () => notificationService.start(),
    critical: false,
    maxRetries: 2,
    backoffMs: [1000, 3000],
  },
  {
    name: 'sync',
    start: () => syncService.start(),
    critical: false,
    maxRetries: 3,
    backoffMs: [2000, 5000, 10000],
  },
  {
    name: 'maintenance',
    start: async () => { maintenanceService.start(); },
    critical: false,
    maxRetries: 2,
    backoffMs: [1000, 2000],
  },
];

// Run database connection and migrations before starting server
(async () => {
  try {
    // Connect to database with retry logic
    await connectWithRetry();

    // Start database health check and auto-reconnection
    startDatabaseHealthCheck();

    // Initialize token revocation service
    initializeRevocationService();

    log.info('Checking database migrations...');
    const migrationResult = await migrationService.runMigrations();

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
      log.info(`HTTP Server running on port ${config.port}`);
      log.info(`WebSocket Server running on ws://localhost:${config.port}/ws`);

      // Start background services with resilient startup manager
      try {
        const startupResults = await startAllServices(backgroundServices);
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
  notificationService.stop();
  syncService.stop();
  maintenanceService.stop();
  stopDatabaseHealthCheck();
  shutdownRevocationService();

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
