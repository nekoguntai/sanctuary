/**
 * Prometheus Metrics Service
 *
 * Centralized metrics collection and exposition for Prometheus.
 * Integrates with existing Grafana monitoring stack.
 *
 * ## Features
 *
 * - Default Node.js metrics (memory, CPU, event loop)
 * - HTTP request metrics (latency, count, errors)
 * - Custom business metrics (wallets, transactions, etc.)
 * - Circuit breaker state tracking
 * - Cache hit/miss ratios
 *
 * ## Usage
 *
 * ```typescript
 * import { metrics, httpRequestDuration } from './observability/metrics';
 *
 * // Record a metric
 * httpRequestDuration.observe({ method: 'GET', path: '/api/wallets', status: '200' }, 0.15);
 *
 * // Get all metrics for /metrics endpoint
 * const metricsOutput = await metrics.getMetrics();
 * ```
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
  register as defaultRegister,
} from 'prom-client';
import { createLogger } from '../utils/logger';

const log = createLogger('Metrics');

// =============================================================================
// Registry
// =============================================================================

// Use default registry for compatibility with prom-client ecosystem
const registry = defaultRegister;

// Collect default Node.js metrics
collectDefaultMetrics({
  register: registry,
  prefix: 'sanctuary_',
  labels: { app: 'sanctuary' },
});

// =============================================================================
// HTTP Metrics
// =============================================================================

/**
 * HTTP request duration histogram
 */
export const httpRequestDuration = new Histogram({
  name: 'sanctuary_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * HTTP requests total counter
 */
export const httpRequestsTotal = new Counter({
  name: 'sanctuary_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

/**
 * HTTP request size histogram
 */
export const httpRequestSize = new Histogram({
  name: 'sanctuary_http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['method', 'path'],
  buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
  registers: [registry],
});

/**
 * HTTP response size histogram
 */
export const httpResponseSize = new Histogram({
  name: 'sanctuary_http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'path', 'status'],
  buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
  registers: [registry],
});

// =============================================================================
// WebSocket Metrics
// =============================================================================

/**
 * Active WebSocket connections gauge
 */
export const websocketConnections = new Gauge({
  name: 'sanctuary_websocket_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['type'], // 'main' or 'gateway'
  registers: [registry],
});

/**
 * WebSocket messages total
 */
export const websocketMessagesTotal = new Counter({
  name: 'sanctuary_websocket_messages_total',
  help: 'Total WebSocket messages',
  labelNames: ['type', 'direction'], // direction: 'in' or 'out'
  registers: [registry],
});

/**
 * WebSocket rate limit hits counter
 */
export const websocketRateLimitHits = new Counter({
  name: 'sanctuary_websocket_rate_limit_hits_total',
  help: 'Total WebSocket rate limit hits',
  labelNames: ['reason'], // 'grace_period_exceeded', 'per_second_exceeded', 'subscription_limit'
  registers: [registry],
});

/**
 * WebSocket subscriptions gauge
 */
export const websocketSubscriptions = new Gauge({
  name: 'sanctuary_websocket_subscriptions',
  help: 'Number of active WebSocket subscriptions',
  registers: [registry],
});

/**
 * WebSocket connection duration histogram
 */
export const websocketConnectionDuration = new Histogram({
  name: 'sanctuary_websocket_connection_duration_seconds',
  help: 'Duration of WebSocket connections in seconds',
  labelNames: ['close_reason'], // 'normal', 'rate_limit', 'auth_timeout', 'error'
  buckets: [1, 5, 30, 60, 300, 600, 1800, 3600, 7200],
  registers: [registry],
});

// =============================================================================
// Business Metrics
// =============================================================================

/**
 * Wallet sync operations counter
 */
export const walletSyncsTotal = new Counter({
  name: 'sanctuary_wallet_syncs_total',
  help: 'Total wallet synchronization operations',
  labelNames: ['status'], // 'success', 'failure'
  registers: [registry],
});

/**
 * Wallet sync duration histogram
 */
export const walletSyncDuration = new Histogram({
  name: 'sanctuary_wallet_sync_duration_seconds',
  help: 'Duration of wallet sync operations in seconds',
  labelNames: ['walletType'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

/**
 * Transaction broadcast counter
 */
export const transactionBroadcastsTotal = new Counter({
  name: 'sanctuary_transaction_broadcasts_total',
  help: 'Total transaction broadcast attempts',
  labelNames: ['status'], // 'success', 'failure'
  registers: [registry],
});

/**
 * Active wallets gauge
 */
export const activeWallets = new Gauge({
  name: 'sanctuary_active_wallets',
  help: 'Number of active wallets in the system',
  registers: [registry],
});

/**
 * Active users gauge
 */
export const activeUsers = new Gauge({
  name: 'sanctuary_active_users',
  help: 'Number of active user sessions',
  registers: [registry],
});

// =============================================================================
// Infrastructure Metrics
// =============================================================================

/**
 * Circuit breaker state gauge
 * 0 = closed (healthy), 1 = half-open, 2 = open (failing)
 */
export const circuitBreakerState = new Gauge({
  name: 'sanctuary_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service'],
  registers: [registry],
});

/**
 * Rate limit hits counter
 */
export const rateLimitHitsTotal = new Counter({
  name: 'sanctuary_rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['policy'],
  registers: [registry],
});

/**
 * Cache operations counter
 */
export const cacheOperationsTotal = new Counter({
  name: 'sanctuary_cache_operations_total',
  help: 'Total cache operations',
  labelNames: ['type', 'result'], // type: 'get'|'set'|'delete', result: 'hit'|'miss'|'success'
  registers: [registry],
});

/**
 * Job queue depth gauge
 */
export const jobQueueDepth = new Gauge({
  name: 'sanctuary_job_queue_depth',
  help: 'Number of jobs in queue',
  labelNames: ['queue', 'state'], // state: 'waiting'|'active'|'delayed'|'failed'
  registers: [registry],
});

/**
 * Job processing duration histogram
 */
export const jobProcessingDuration = new Histogram({
  name: 'sanctuary_job_processing_duration_seconds',
  help: 'Duration of job processing in seconds',
  labelNames: ['job_name', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
  registers: [registry],
});

// =============================================================================
// Electrum Pool Metrics
// =============================================================================

/**
 * Electrum pool connections gauge
 */
export const electrumPoolConnections = new Gauge({
  name: 'sanctuary_electrum_pool_connections',
  help: 'Number of Electrum pool connections',
  labelNames: ['state', 'network'], // state: 'total', 'active', 'idle'
  registers: [registry],
});

/**
 * Electrum pool waiting requests gauge
 */
export const electrumPoolWaitingRequests = new Gauge({
  name: 'sanctuary_electrum_pool_waiting_requests',
  help: 'Number of waiting requests in Electrum pool queue',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum pool acquisitions counter
 */
export const electrumPoolAcquisitionsTotal = new Counter({
  name: 'sanctuary_electrum_pool_acquisitions_total',
  help: 'Total connection acquisitions from Electrum pool',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum pool acquisition duration histogram
 */
export const electrumPoolAcquisitionDuration = new Histogram({
  name: 'sanctuary_electrum_pool_acquisition_duration_seconds',
  help: 'Duration of Electrum pool connection acquisition in seconds',
  labelNames: ['network'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/**
 * Electrum pool health check failures counter
 */
export const electrumPoolHealthCheckFailures = new Counter({
  name: 'sanctuary_electrum_pool_health_check_failures_total',
  help: 'Total health check failures in Electrum pool',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum server health gauge (per-server)
 */
export const electrumServerHealth = new Gauge({
  name: 'sanctuary_electrum_server_healthy',
  help: 'Electrum server health status (1=healthy, 0=unhealthy)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server connections gauge (per-server)
 */
export const electrumServerConnections = new Gauge({
  name: 'sanctuary_electrum_server_connections',
  help: 'Number of connections to Electrum server',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server backoff level gauge (per-server)
 */
export const electrumServerBackoffLevel = new Gauge({
  name: 'sanctuary_electrum_server_backoff_level',
  help: 'Electrum server backoff level (0=healthy, higher=more degraded)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server weight gauge (per-server)
 */
export const electrumServerWeight = new Gauge({
  name: 'sanctuary_electrum_server_weight',
  help: 'Electrum server selection weight (0-1)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum pool circuit breaker state
 */
export const electrumCircuitBreakerState = new Gauge({
  name: 'sanctuary_electrum_circuit_breaker_state',
  help: 'Electrum pool circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['network'],
  registers: [registry],
});

// =============================================================================
// Database Metrics
// =============================================================================

/**
 * Database query duration histogram
 */
export const dbQueryDuration = new Histogram({
  name: 'sanctuary_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'], // 'select', 'insert', 'update', 'delete'
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/**
 * Database connection pool gauge
 */
export const dbConnectionPool = new Gauge({
  name: 'sanctuary_db_connection_pool',
  help: 'Database connection pool status',
  labelNames: ['state'], // 'active', 'idle', 'waiting'
  registers: [registry],
});

/**
 * Database pool health status gauge
 * Values: 0 = healthy, 1 = degraded, 2 = unhealthy
 */
export const dbPoolHealth = new Gauge({
  name: 'sanctuary_db_pool_health',
  help: 'Database pool health status (0=healthy, 1=degraded, 2=unhealthy)',
  registers: [registry],
});

/**
 * Database query latency summary for pool health watchdog
 */
export const dbPoolLatency = new Gauge({
  name: 'sanctuary_db_pool_latency_ms',
  help: 'Database pool average query latency in milliseconds',
  labelNames: ['type'], // 'avg', 'max'
  registers: [registry],
});

/**
 * Database slow query counter
 */
export const dbSlowQueriesTotal = new Counter({
  name: 'sanctuary_db_slow_queries_total',
  help: 'Total number of slow database queries',
  registers: [registry],
});

// =============================================================================
// Metrics Service
// =============================================================================

class MetricsService {
  private initialized = false;

  /**
   * Initialize metrics service
   */
  initialize(): void {
    if (this.initialized) return;

    log.info('Metrics service initialized');
    this.initialized = true;
  }

  /**
   * Get all metrics in Prometheus text format
   */
  async getMetrics(): Promise<string> {
    return registry.metrics();
  }

  /**
   * Get metrics content type header
   */
  getContentType(): string {
    return registry.contentType;
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    registry.resetMetrics();
  }

  /**
   * Get registry for custom metric registration
   */
  getRegistry(): Registry {
    return registry;
  }
}

// Singleton instance
export const metricsService = new MetricsService();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize path for metrics labels
 * Replaces dynamic path segments with placeholders
 */
export function normalizePath(path: string): string {
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace numeric IDs
    .replace(/\/\d+/g, '/:id')
    // Replace Bitcoin addresses (P2PKH, P2SH, Bech32)
    .replace(/\/(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}/g, '/:address')
    // Replace transaction hashes
    .replace(/\/[a-f0-9]{64}/gi, '/:txid');
}

/**
 * Record circuit breaker state change
 */
export function recordCircuitBreakerState(
  service: string,
  state: 'closed' | 'half-open' | 'open'
): void {
  const stateValue = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
  circuitBreakerState.set({ service }, stateValue);
}

/**
 * Record cache operation
 */
export function recordCacheOperation(
  type: 'get' | 'set' | 'delete',
  result: 'hit' | 'miss' | 'success' | 'error'
): void {
  cacheOperationsTotal.inc({ type, result });
}

/**
 * Update job queue metrics
 */
export function updateJobQueueMetrics(
  queue: string,
  waiting: number,
  active: number,
  delayed: number,
  failed: number
): void {
  jobQueueDepth.set({ queue, state: 'waiting' }, waiting);
  jobQueueDepth.set({ queue, state: 'active' }, active);
  jobQueueDepth.set({ queue, state: 'delayed' }, delayed);
  jobQueueDepth.set({ queue, state: 'failed' }, failed);
}

/**
 * Update Electrum pool metrics from pool stats
 * Call this periodically to keep metrics current
 */
export function updateElectrumPoolMetrics(
  network: string,
  stats: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
    totalAcquisitions: number;
    averageAcquisitionTimeMs: number;
    healthCheckFailures: number;
    servers: Array<{
      label: string;
      isHealthy: boolean;
      connectionCount: number;
      backoffLevel: number;
      weight: number;
    }>;
  },
  circuitState?: 'closed' | 'half-open' | 'open'
): void {
  // Pool-level metrics
  electrumPoolConnections.set({ state: 'total', network }, stats.totalConnections);
  electrumPoolConnections.set({ state: 'active', network }, stats.activeConnections);
  electrumPoolConnections.set({ state: 'idle', network }, stats.idleConnections);
  electrumPoolWaitingRequests.set({ network }, stats.waitingRequests);

  // Circuit breaker state
  if (circuitState) {
    const stateValue = circuitState === 'closed' ? 0 : circuitState === 'half-open' ? 1 : 2;
    electrumCircuitBreakerState.set({ network }, stateValue);
  }

  // Per-server metrics
  for (const server of stats.servers) {
    electrumServerHealth.set({ server: server.label, network }, server.isHealthy ? 1 : 0);
    electrumServerConnections.set({ server: server.label, network }, server.connectionCount);
    electrumServerBackoffLevel.set({ server: server.label, network }, server.backoffLevel);
    electrumServerWeight.set({ server: server.label, network }, server.weight);
  }
}

export default metricsService;
