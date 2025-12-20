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
import { initializeWebSocketServer } from './websocket/server';
import { notificationService } from './websocket/notifications';
import { getSyncService } from './services/syncService';
import { createLogger } from './utils/logger';
import { validateEncryptionKey } from './utils/encryption';
import { requestLogger } from './middleware/requestLogger';
import { migrationService } from './services/migrationService';
import { maintenanceService } from './services/maintenanceService';

const log = createLogger('SERVER');

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

// Health check (both paths for compatibility)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

app.get('/api/v1/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

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

// Initialize WebSocket server
const wsServer = initializeWebSocketServer(httpServer);

// Start notification service
notificationService.start().catch((err) => {
  log.error('Failed to start notification service', { error: err });
});

// Start background sync service
const syncService = getSyncService();
syncService.start().catch((err) => {
  log.error('Failed to start sync service', { error: err });
});

// Start maintenance service (cleanup jobs)
maintenanceService.start();

// Run database migrations before starting server
(async () => {
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
    log.info('Notification Service running');
    log.info('Background Sync Service running');
    log.info('Maintenance Service running (cleanup jobs)');

    // Log final migration status
    await migrationService.logMigrationStatus();
  });
})();

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, closing server...');
  wsServer.close();
  notificationService.stop();
  syncService.stop();
  maintenanceService.stop();
  httpServer.close(() => {
    log.info('Server closed');
    process.exit(0);
  });
});

export default app;
