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
import { requestLogger } from './middleware/requestLogger';
import { authRateLimiter } from './middleware/rateLimit';
import proxyRoutes from './routes/proxy';
import { initializePushServices, shutdownPushServices } from './services/push';
import { startBackendEvents, stopBackendEvents } from './services/backendEvents';

const log = createLogger('GATEWAY');

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception - process will exit', {
    error: error.message,
    stack: error.stack,
  });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: unknown) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Validate configuration
validateConfig();

const app = express();

// Security middleware
app.use(helmet());

// SEC-004: CORS configuration with configurable allowlist
const corsOptions: cors.CorsOptions = {
  origin: config.corsAllowedOrigins.length > 0
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
          callback(null, true);
          return;
        }
        // Check if origin is in allowlist
        if (config.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true, // Allow all origins if no allowlist configured (for mobile apps)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
};

// Warn if CORS is wide open
if (config.corsAllowedOrigins.length === 0) {
  log.warn('CORS is configured to allow all origins. Set CORS_ALLOWED_ORIGINS to restrict access.');
}

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging - captures all requests for auditing
app.use(requestLogger);

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

// SEC-007: Auth routes with stricter rate limiting for ALL auth endpoints
// Apply rate limiter to the entire /api/v1/auth path, not just login POST
app.use('/api/v1/auth', authRateLimiter);

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
