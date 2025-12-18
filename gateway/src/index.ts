/**
 * Sanctuary API Gateway
 *
 * Public-facing gateway for mobile app access.
 * Handles authentication, rate limiting, and proxying to the backend.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import { createLogger } from './utils/logger';
import { authRateLimiter } from './middleware/rateLimit';
import proxyRoutes from './routes/proxy';
import { initializePushServices, shutdownPushServices } from './services/push';
import { startBackendEvents, stopBackendEvents } from './services/backendEvents';

const log = createLogger('GATEWAY');

// Validate configuration
validateConfig();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: true, // Allow mobile apps from any origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Gateway info
app.get('/info', (_req, res) => {
  res.json({
    name: 'Sanctuary Gateway',
    version: '0.1.0',
    environment: config.nodeEnv,
  });
});

// Auth routes with stricter rate limiting
app.post('/api/v1/auth/login', authRateLimiter);

// Proxy routes to backend (includes push notification endpoints)
app.use('/', proxyRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Endpoint not available via mobile API',
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
  });
});

// Start server
const server = app.listen(config.port, () => {
  log.info(`Gateway started on port ${config.port}`);
  log.info(`Environment: ${config.nodeEnv}`);
  log.info(`Backend URL: ${config.backendUrl}`);

  // Initialize push notification services
  initializePushServices();

  // Connect to backend for events
  startBackendEvents();
});

// Graceful shutdown
function shutdown(signal: string): void {
  log.info(`Received ${signal}, shutting down...`);

  server.close(() => {
    log.info('HTTP server closed');

    // Cleanup services
    stopBackendEvents();
    shutdownPushServices();

    log.info('Gateway shutdown complete');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
