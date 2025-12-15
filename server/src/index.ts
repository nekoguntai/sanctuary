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
import { initializeWebSocketServer } from './websocket/server';
import { notificationService } from './websocket/notifications';
import { getSyncService } from './services/syncService';

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

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ========================================
// ROUTES
// ========================================

// Health check
app.get('/health', (req: Request, res: Response) => {
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

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[ERROR]', err);
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
  console.error('Failed to start notification service:', err);
});

// Start background sync service
const syncService = getSyncService();
syncService.start().catch((err) => {
  console.error('Failed to start sync service:', err);
});

// Start listening
httpServer.listen(config.port, () => {
  console.log('');
  console.log('🏛️  Sanctuary Wallet API Server');
  console.log('=====================================');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Server:      ${config.apiUrl}`);
  console.log(`Client:      ${config.clientUrl}`);
  console.log(`Network:     ${config.bitcoin.network}`);
  console.log('=====================================');
  console.log('');
  console.log(`✅ HTTP Server running on port ${config.port}`);
  console.log(`✅ WebSocket Server running on ws://localhost:${config.port}/ws`);
  console.log(`✅ Notification Service running`);
  console.log(`✅ Background Sync Service running`);
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wsServer.close();
  notificationService.stop();
  syncService.stop();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
