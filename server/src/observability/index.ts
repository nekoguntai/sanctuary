/**
 * Observability Module
 *
 * Centralized observability infrastructure.
 *
 * @module observability
 */

export {
  metricsService,
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestSize,
  httpResponseSize,
  websocketConnections,
  websocketMessagesTotal,
  walletSyncsTotal,
  walletSyncDuration,
  transactionBroadcastsTotal,
  activeWallets,
  activeUsers,
  circuitBreakerState,
  rateLimitHitsTotal,
  cacheOperationsTotal,
  jobQueueDepth,
  jobProcessingDuration,
  dbQueryDuration,
  dbConnectionPool,
  normalizePath,
  recordCircuitBreakerState,
  recordCacheOperation,
  updateJobQueueMetrics,
} from './metrics';
