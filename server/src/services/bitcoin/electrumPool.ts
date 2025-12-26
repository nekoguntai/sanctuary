/**
 * Electrum Connection Pool
 *
 * Manages a pool of Electrum server connections for improved
 * performance and resilience. Provides:
 * - Multi-server support with load balancing
 * - Connection pooling with min/max limits
 * - Health checks and automatic reconnection
 * - Per-server health tracking and failover
 * - Dedicated subscription connection for real-time events
 * - Acquisition queue when pool is exhausted
 *
 * ## Connection Scaling
 *
 * The pool automatically adjusts connection limits based on server count:
 *
 * - **Effective Min** = max(configured_min, server_count)
 *   Ensures at least 1 connection per server at startup for even distribution.
 *
 * - **Effective Max** = max(configured_max, server_count)
 *   Ensures the pool can maintain at least 1 connection per server.
 *
 * Example with 3 servers:
 * - Configured: min=1, max=5
 * - Effective:  min=3, max=5 (min raised to match server count)
 *
 * Example with 10 servers:
 * - Configured: min=1, max=5
 * - Effective:  min=10, max=10 (both raised to match server count)
 *
 * ## Load Balancing Strategies
 *
 * - **round_robin**: Distributes connections evenly across all healthy servers
 * - **least_connections**: Prefers servers with fewer active connections
 * - **failover_only**: Uses primary server, fails over to others only when unhealthy
 */

import { EventEmitter } from 'events';
import { ElectrumClient } from './electrum';
import { createLogger } from '../../utils/logger';
import prisma from '../../models/prisma';

const log = createLogger('ELECTRUM_POOL');

/**
 * Load balancing strategies
 */
export type LoadBalancingStrategy = 'round_robin' | 'least_connections' | 'failover_only';

/**
 * SOCKS5 proxy configuration (for Tor support)
 */
interface ProxyConfig {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
}

/**
 * Per-server statistics
 */
export interface ServerStats {
  serverId: string;
  label: string;
  host: string;
  port: number;
  connectionCount: number;
  healthyConnections: number;
  totalRequests: number;
  failedRequests: number;
  isHealthy: boolean;
  lastHealthCheck: Date | null;
  // Backoff state
  consecutiveFailures: number;
  backoffLevel: number;
  cooldownUntil: Date | null;
  weight: number;
  // Health check history (most recent first)
  healthHistory: HealthCheckResult[];
}

/**
 * Health check result for history tracking
 */
export interface HealthCheckResult {
  timestamp: Date;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Maximum number of health check results to keep per server
 */
const MAX_HEALTH_HISTORY = 20;

/**
 * Backoff configuration
 */
export interface BackoffConfig {
  // Initial cooldown duration after first failure (ms)
  baseDelayMs: number;
  // Maximum cooldown duration (ms)
  maxDelayMs: number;
  // Number of consecutive failures before triggering backoff
  failureThreshold: number;
  // Number of consecutive successes needed to fully recover
  recoveryThreshold: number;
  // Weight reduction per backoff level (0.0 - 1.0)
  weightPenalty: number;
  // Minimum weight for a server (prevents complete exclusion)
  minWeight: number;
}

/**
 * Default backoff configuration
 */
const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 30000,        // 30 seconds initial backoff
  maxDelayMs: 300000,        // 5 minutes max backoff
  failureThreshold: 2,       // 2 failures triggers backoff
  recoveryThreshold: 3,      // 3 successes for full recovery
  weightPenalty: 0.3,        // 30% weight reduction per level
  minWeight: 0.1,            // Never go below 10% weight
};

/**
 * Pool configuration options
 */
export interface ElectrumPoolConfig {
  // Pool mode
  enabled: boolean; // If false, acts as single connection (legacy mode)

  // Pool sizing
  minConnections: number;
  maxConnections: number;

  // Load balancing
  loadBalancing: LoadBalancingStrategy;

  // Connection lifecycle
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;

  // Acquisition
  acquisitionTimeoutMs: number;
  maxWaitingRequests: number;

  // Resilience
  maxReconnectAttempts: number;
  reconnectDelayMs: number;

  // Keepalive (to prevent servers from dropping idle connections)
  keepaliveIntervalMs: number;
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG: ElectrumPoolConfig = {
  enabled: true, // Set to false for single-connection mode
  minConnections: 1,
  maxConnections: 5,
  loadBalancing: 'round_robin',
  connectionTimeoutMs: 10000,
  idleTimeoutMs: 300000,
  healthCheckIntervalMs: 30000,
  acquisitionTimeoutMs: 5000,
  maxWaitingRequests: 100,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  keepaliveIntervalMs: 15000, // Ping idle connections every 15 seconds
};

/**
 * Connection states
 */
type ConnectionState = 'idle' | 'active' | 'reconnecting' | 'closed';

/**
 * Pooled connection wrapper
 */
interface PooledConnection {
  id: string;
  client: ElectrumClient;
  state: ConnectionState;
  createdAt: Date;
  lastUsedAt: Date;
  lastHealthCheck: Date;
  useCount: number;
  isDedicated: boolean;
  // Multi-server support
  serverId: string;
  serverLabel: string;
  serverHost: string;
  serverPort: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquisitions: number;
  averageAcquisitionTimeMs: number;
  healthCheckFailures: number;
  // Multi-server stats
  serverCount: number;
  servers: ServerStats[];
}

/**
 * Acquisition options
 */
export interface AcquireOptions {
  purpose?: string;
  timeoutMs?: number;
  network?: NetworkType;
}

/**
 * Connection handle returned to consumers
 */
export interface PooledConnectionHandle {
  client: ElectrumClient;
  release(): void;
  withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T>;
}

/**
 * Waiting request in queue
 */
interface WaitingRequest {
  resolve: (handle: PooledConnectionHandle) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  purpose?: string;
  startTime: number;
}

/**
 * Electrum Connection Pool
 *
 * Manages a pool of connections to multiple Electrum servers for improved
 * concurrency, resilience, and failover.
 */
export class ElectrumPool extends EventEmitter {
  private config: ElectrumPoolConfig;
  private connections: Map<string, PooledConnection> = new Map();
  private waitingQueue: WaitingRequest[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private isInitialized = false;
  private subscriptionConnectionId: string | null = null;
  // Lock to prevent concurrent initialization
  private initializePromise: Promise<void> | null = null;

  // Multi-server support
  private servers: ServerConfig[] = [];
  private serverStats: Map<string, {
    totalRequests: number;
    failedRequests: number;
    lastHealthCheck: Date | null;
    isHealthy: boolean;
    // Backoff state
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    backoffLevel: number;
    cooldownUntil: Date | null;
    weight: number;
    // Health check history
    healthHistory: HealthCheckResult[];
  }> = new Map();
  private roundRobinIndex = 0;

  // Backoff configuration
  private backoffConfig: BackoffConfig = DEFAULT_BACKOFF_CONFIG;

  // Proxy configuration (for Tor support)
  private proxyConfig: ProxyConfig | null = null;

  // Statistics
  private stats = {
    totalAcquisitions: 0,
    totalAcquisitionTimeMs: 0,
    healthCheckFailures: 0,
  };

  constructor(poolConfig?: Partial<ElectrumPoolConfig>) {
    super();
    this.config = { ...DEFAULT_POOL_CONFIG, ...poolConfig };
  }

  /**
   * Set the server list for the pool
   */
  setServers(servers: ServerConfig[]): void {
    const oldServerIds = new Set(this.servers.map(s => s.id));
    this.servers = servers.filter(s => s.enabled).sort((a, b) => a.priority - b.priority);
    const newServerIds = new Set(this.servers.map(s => s.id));

    // Initialize stats for each server
    for (const server of this.servers) {
      if (!this.serverStats.has(server.id)) {
        this.serverStats.set(server.id, {
          totalRequests: 0,
          failedRequests: 0,
          lastHealthCheck: null,
          isHealthy: true,
          // Backoff state
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          backoffLevel: 0,
          cooldownUntil: null,
          weight: 1.0,
          // Health history
          healthHistory: [],
        });
      }
    }

    // Disconnect connections to servers that were removed or disabled
    const removedServerIds = [...oldServerIds].filter(id => !newServerIds.has(id));
    if (removedServerIds.length > 0) {
      log.info(`Disconnecting connections to ${removedServerIds.length} removed/disabled servers`);
      for (const serverId of removedServerIds) {
        this.disconnectServerConnections(serverId);
        this.serverStats.delete(serverId);
      }
    }

    log.info(`Pool configured with ${this.servers.length} servers`, {
      effectiveMin: this.getEffectiveMinConnections(),
      effectiveMax: this.getEffectiveMaxConnections(),
      configuredMin: this.config.minConnections,
      configuredMax: this.config.maxConnections,
    });
  }

  /**
   * Disconnect all connections to a specific server
   * Used when a server is disabled or removed from the pool
   */
  disconnectServerConnections(serverId: string): void {
    const serverConnections = [...this.connections.entries()]
      .filter(([_, conn]) => conn.serverId === serverId);

    if (serverConnections.length === 0) {
      log.debug(`No connections to disconnect for server ${serverId}`);
      return;
    }

    log.info(`Disconnecting ${serverConnections.length} connections to server ${serverId}`);

    for (const [connId, conn] of serverConnections) {
      try {
        conn.client.disconnect();
        this.connections.delete(connId);

        // If this was the subscription connection, clear it
        if (this.subscriptionConnectionId === connId) {
          this.subscriptionConnectionId = null;
          log.info('Subscription connection was disconnected, will be reassigned');
        }
      } catch (error) {
        log.warn(`Error disconnecting connection ${connId}`, { error: String(error) });
      }
    }

    log.info(`Disconnected all connections to server ${serverId}`);
  }

  /**
   * Set proxy configuration for all pool connections
   * When proxy is enabled, all connections will route through it (for Tor support)
   */
  setProxyConfig(proxy: ProxyConfig | null): void {
    this.proxyConfig = proxy;
    if (proxy?.enabled) {
      log.info(`Pool proxy configured: ${proxy.host}:${proxy.port}`);
    } else {
      log.info('Pool proxy disabled');
    }
  }

  /**
   * Get current proxy configuration
   */
  getProxyConfig(): ProxyConfig | null {
    return this.proxyConfig;
  }

  /**
   * Check if proxy (Tor) is enabled
   */
  isProxyEnabled(): boolean {
    return this.proxyConfig?.enabled ?? false;
  }

  /**
   * Get effective minimum connections (at least 1 per server)
   * This ensures even distribution across all configured servers at startup.
   */
  getEffectiveMinConnections(): number {
    const serverCount = this.servers.length;
    if (serverCount === 0) return this.config.minConnections;
    return Math.max(this.config.minConnections, serverCount);
  }

  /**
   * Get effective maximum connections (at least 1 per server)
   * This ensures the pool can maintain at least 1 connection per server.
   */
  getEffectiveMaxConnections(): number {
    const serverCount = this.servers.length;
    if (serverCount === 0) return this.config.maxConnections;
    return Math.max(this.config.maxConnections, serverCount);
  }

  /**
   * Get the list of configured servers
   */
  getServers(): ServerConfig[] {
    return [...this.servers];
  }

  /**
   * Reload servers and proxy config from database (can be called to pick up config changes)
   */
  async reloadServers(): Promise<void> {
    try {
      const nodeConfig = await prisma.nodeConfig.findFirst({
        where: { isDefault: true, type: 'electrum' },
        include: {
          servers: {
            where: { enabled: true },
            orderBy: { priority: 'asc' },
          },
        },
      });

      if (nodeConfig) {
        const servers: ServerConfig[] = nodeConfig.servers.map(s => ({
          id: s.id,
          label: s.label,
          host: s.host,
          port: s.port,
          useSsl: s.useSsl,
          priority: s.priority,
          enabled: s.enabled,
        }));

        this.setServers(servers);

        // Update load balancing strategy
        if (nodeConfig.poolLoadBalancing) {
          this.config.loadBalancing = nodeConfig.poolLoadBalancing as LoadBalancingStrategy;
        }

        // Update proxy config
        if (nodeConfig.proxyEnabled && nodeConfig.proxyHost && nodeConfig.proxyPort) {
          this.setProxyConfig({
            enabled: true,
            host: nodeConfig.proxyHost,
            port: nodeConfig.proxyPort,
            username: nodeConfig.proxyUsername ?? undefined,
            password: nodeConfig.proxyPassword ?? undefined,
          });
        } else {
          this.setProxyConfig(null);
        }

        log.info(`Reloaded ${servers.length} servers from database`, {
          proxyEnabled: this.proxyConfig?.enabled ?? false,
        });

        // Ensure new servers have connections
        if (this.isInitialized) {
          await this.ensureMinimumConnections();
        }
      }
    } catch (error) {
      log.error('Failed to reload servers from database', { error: String(error) });
    }
  }

  /**
   * Mark a server as healthy or unhealthy in the database
   */
  private async updateServerHealthInDb(serverId: string, isHealthy: boolean, failCount?: number, errorMessage?: string): Promise<void> {
    try {
      await prisma.electrumServer.update({
        where: { id: serverId },
        data: {
          isHealthy,
          lastHealthCheck: new Date(),
          lastHealthCheckError: isHealthy ? null : (errorMessage || null),
          ...(failCount !== undefined ? { healthCheckFails: failCount } : {}),
        },
      });
    } catch (error) {
      // Don't log loudly - this is a background operation
      log.debug(`Failed to update server health in db: ${error}`);
    }
  }

  /**
   * Initialize the pool by creating minimum connections
   */
  async initialize(): Promise<void> {
    // Fast path: already initialized
    if (this.isInitialized) {
      log.debug('Pool already initialized');
      return;
    }

    // Another caller is already initializing - wait for their result
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // We're the first caller - create and store the init promise
    this.initializePromise = this.doInitialize();

    try {
      await this.initializePromise;
    } finally {
      // Clear the promise after completion
      this.initializePromise = null;
    }
  }

  /**
   * Internal initialization logic (called only once via lock)
   */
  private async doInitialize(): Promise<void> {
    // Double-check in case of race
    if (this.isInitialized) {
      return;
    }

    // Single-connection mode
    if (!this.config.enabled) {
      log.info('Initializing Electrum in single-connection mode (pool disabled)');
      await this.createConnection();
      this.isInitialized = true;

      // Still run health checks in single mode
      this.healthCheckInterval = setInterval(
        () => this.performHealthChecks(),
        this.config.healthCheckIntervalMs
      );

      log.info('Electrum single connection initialized');
      return;
    }

    const effectiveMin = this.getEffectiveMinConnections();
    const effectiveMax = this.getEffectiveMaxConnections();

    log.info(
      `Initializing Electrum pool (min: ${effectiveMin}, max: ${effectiveMax})`,
      {
        serverCount: this.servers.length,
        configuredMin: this.config.minConnections,
        configuredMax: this.config.maxConnections,
      }
    );

    // Create minimum connections (at least 1 per server)
    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < effectiveMin; i++) {
      initPromises.push(
        this.createConnection().then(() => {}).catch((err) => {
          log.error(`Failed to create initial connection ${i + 1}`, { error: String(err) });
        })
      );
    }

    await Promise.all(initPromises);

    // Start health check interval
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckIntervalMs
    );

    // Start idle connection cleanup (only in pool mode)
    this.idleCheckInterval = setInterval(
      () => this.cleanupIdleConnections(),
      this.config.idleTimeoutMs / 2
    );

    // Start keepalive interval (ping idle connections to prevent server-side timeouts)
    this.keepaliveInterval = setInterval(
      () => this.sendKeepalives(),
      this.config.keepaliveIntervalMs
    );

    this.isInitialized = true;
    log.info(`Electrum pool initialized with ${this.connections.size} connections`);
  }

  /**
   * Shutdown the pool and close all connections
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Electrum pool...');
    this.isShuttingDown = true;
    this.initializePromise = null;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    // Reject all waiting requests
    for (const req of this.waitingQueue) {
      clearTimeout(req.timeoutId);
      req.reject(new Error('Pool is shutting down'));
    }
    this.waitingQueue = [];

    // Close all connections
    for (const [id, conn] of this.connections) {
      try {
        conn.client.disconnect();
        conn.state = 'closed';
      } catch (error) {
        log.warn(`Error closing connection ${id}`, { error: String(error) });
      }
    }
    this.connections.clear();
    this.subscriptionConnectionId = null;
    this.isInitialized = false;

    log.info('Electrum pool shut down');
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(options: AcquireOptions = {}): Promise<PooledConnectionHandle> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // Single-connection mode - always return the one connection
    if (!this.config.enabled) {
      let conn = this.connections.values().next().value as PooledConnection | undefined;
      if (!conn || !conn.client.isConnected()) {
        // Reconnect if needed
        if (conn) {
          await this.reconnectConnection(conn);
        } else {
          await this.createConnection();
        }
        conn = this.connections.values().next().value as PooledConnection;
      }
      return this.activateConnectionSingleMode(conn, startTime);
    }

    const timeoutMs = options.timeoutMs ?? this.config.acquisitionTimeoutMs;

    // Try to get an idle connection
    const conn = this.findIdleConnection();
    if (conn) {
      return this.activateConnection(conn, options.purpose, startTime);
    }

    // Try to create a new connection if under limit
    if (this.connections.size < this.getEffectiveMaxConnections()) {
      try {
        const newConn = await this.createConnection();
        return this.activateConnection(newConn, options.purpose, startTime);
      } catch (error) {
        log.warn('Failed to create new connection', { error: String(error) });
        // Fall through to queue
      }
    }

    // Queue the request
    if (this.waitingQueue.length >= this.config.maxWaitingRequests) {
      throw new Error('Pool request queue is full');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.waitingQueue.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
        }
        reject(new Error(`Connection acquisition timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this.waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: options.purpose,
        startTime,
      });
    });
  }

  /**
   * Activate connection in single-mode (no state tracking, no-op release)
   */
  private activateConnectionSingleMode(
    conn: PooledConnection,
    startTime: number
  ): PooledConnectionHandle {
    conn.lastUsedAt = new Date();
    conn.useCount++;

    const acquisitionTime = Date.now() - startTime;
    this.stats.totalAcquisitions++;
    this.stats.totalAcquisitionTimeMs += acquisitionTime;

    // In single mode, release is a no-op since we always use the same connection
    const release = () => {};

    return {
      client: conn.client,
      release,
      async withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T> {
        return await fn(conn.client);
      },
    };
  }

  /**
   * Get the dedicated subscription connection
   * This connection is reserved for real-time subscriptions and events
   */
  async getSubscriptionConnection(): Promise<ElectrumClient> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Single-connection mode - use the one connection for everything
    if (!this.config.enabled) {
      let conn = this.connections.values().next().value as PooledConnection | undefined;
      if (!conn || !conn.client.isConnected()) {
        if (conn) {
          await this.reconnectConnection(conn);
        } else {
          await this.createConnection();
        }
        conn = this.connections.values().next().value as PooledConnection;
      }
      return conn.client;
    }

    // Return existing subscription connection if available
    if (this.subscriptionConnectionId) {
      const conn = this.connections.get(this.subscriptionConnectionId);
      if (conn && conn.state !== 'closed' && conn.client.isConnected()) {
        return conn.client;
      }
      // Subscription connection is dead, clear it
      this.subscriptionConnectionId = null;
    }

    // Create or designate a subscription connection
    let conn = this.findIdleConnection();
    if (!conn && this.connections.size < this.getEffectiveMaxConnections()) {
      conn = await this.createConnection();
    }

    if (!conn) {
      // All connections are active, create one even if over limit for subscriptions
      log.warn('Creating extra connection for subscriptions (pool at capacity)');
      conn = await this.createConnection();
    }

    conn.isDedicated = true;
    conn.state = 'active';
    this.subscriptionConnectionId = conn.id;

    log.info(`Designated connection ${conn.id} for subscriptions`);
    return conn.client;
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): PoolStats {
    const connections = Array.from(this.connections.values());
    const activeCount = connections.filter((c) => c.state === 'active').length;
    const idleCount = connections.filter((c) => c.state === 'idle').length;

    // Build per-server stats
    const now = Date.now();
    const serverStatsArray: ServerStats[] = this.servers.map(server => {
      const serverConnections = connections.filter(c => c.serverId === server.id);
      const healthyConns = serverConnections.filter(c => c.state !== 'closed' && c.client.isConnected()).length;
      const stats = this.serverStats.get(server.id);

      // Check if currently in cooldown
      const inCooldown = stats?.cooldownUntil ? stats.cooldownUntil.getTime() > now : false;

      return {
        serverId: server.id,
        label: server.label,
        host: server.host,
        port: server.port,
        connectionCount: serverConnections.length,
        healthyConnections: healthyConns,
        totalRequests: stats?.totalRequests || 0,
        failedRequests: stats?.failedRequests || 0,
        isHealthy: stats?.isHealthy ?? true,
        lastHealthCheck: stats?.lastHealthCheck || null,
        // Backoff state
        consecutiveFailures: stats?.consecutiveFailures || 0,
        backoffLevel: stats?.backoffLevel || 0,
        cooldownUntil: inCooldown ? stats?.cooldownUntil || null : null,
        weight: stats?.weight ?? 1.0,
        // Health history (most recent first)
        healthHistory: stats?.healthHistory || [],
      };
    });

    return {
      totalConnections: connections.length,
      activeConnections: activeCount,
      idleConnections: idleCount,
      waitingRequests: this.waitingQueue.length,
      totalAcquisitions: this.stats.totalAcquisitions,
      averageAcquisitionTimeMs:
        this.stats.totalAcquisitions > 0
          ? Math.round(this.stats.totalAcquisitionTimeMs / this.stats.totalAcquisitions)
          : 0,
      healthCheckFailures: this.stats.healthCheckFailures,
      serverCount: this.servers.length,
      servers: serverStatsArray,
    };
  }

  /**
   * Check if the pool is healthy (has available capacity)
   */
  isHealthy(): boolean {
    if (!this.isInitialized) return false;
    const stats = this.getPoolStats();
    return stats.idleConnections > 0 || stats.totalConnections < this.getEffectiveMaxConnections();
  }

  /**
   * Check if the pool is initialized
   */
  isPoolInitialized(): boolean {
    return this.isInitialized;
  }

  // Private methods

  /**
   * Select a server based on load balancing strategy with backoff awareness
   */
  private selectServer(): ServerConfig | null {
    const now = Date.now();

    // Filter servers: healthy, not in cooldown
    const availableServers = this.servers.filter(s => {
      const stats = this.serverStats.get(s.id);
      if (!s.enabled) return false;
      if (!stats) return true;
      if (!stats.isHealthy) return false;

      // Check if server is in cooldown
      if (stats.cooldownUntil && stats.cooldownUntil.getTime() > now) {
        return false;
      }

      return true;
    });

    if (availableServers.length === 0) {
      // If no available servers, check if any are just in cooldown (not unhealthy)
      // We can use cooldown servers as last resort
      const cooldownServers = this.servers.filter(s => {
        const stats = this.serverStats.get(s.id);
        return s.enabled && stats?.isHealthy && stats?.cooldownUntil && stats.cooldownUntil.getTime() > now;
      });

      if (cooldownServers.length > 0) {
        // Use the one with shortest remaining cooldown
        log.warn('All available servers in cooldown, using server with shortest cooldown');
        cooldownServers.sort((a, b) => {
          const statsA = this.serverStats.get(a.id);
          const statsB = this.serverStats.get(b.id);
          return (statsA?.cooldownUntil?.getTime() || 0) - (statsB?.cooldownUntil?.getTime() || 0);
        });
        return cooldownServers[0];
      }

      // Fall back to any enabled server
      const enabledServers = this.servers.filter(s => s.enabled);
      if (enabledServers.length === 0) return null;
      return enabledServers[0];
    }

    switch (this.config.loadBalancing) {
      case 'failover_only':
        // Always use highest priority (lowest number) available server
        return availableServers[0];

      case 'least_connections':
        // Select server with fewest active connections, weighted by reliability
        let bestScore = -Infinity;
        let selectedServer = availableServers[0];
        for (const server of availableServers) {
          const stats = this.serverStats.get(server.id);
          const weight = stats?.weight ?? 1.0;
          const serverConnections = Array.from(this.connections.values())
            .filter(c => c.serverId === server.id && c.state === 'active').length;
          // Higher weight = better, fewer connections = better
          // Score combines both factors
          const score = weight * 10 - serverConnections;
          if (score > bestScore) {
            bestScore = score;
            selectedServer = server;
          }
        }
        return selectedServer;

      case 'round_robin':
      default:
        // Weighted round robin - servers with higher weight are selected more often
        return this.selectWeightedRoundRobin(availableServers);
    }
  }

  /**
   * Weighted round-robin selection
   * Servers with higher weights are selected more frequently
   */
  private selectWeightedRoundRobin(servers: ServerConfig[]): ServerConfig {
    // Calculate total weight
    let totalWeight = 0;
    const weights: number[] = [];
    for (const server of servers) {
      const stats = this.serverStats.get(server.id);
      const weight = stats?.weight ?? 1.0;
      weights.push(weight);
      totalWeight += weight;
    }

    // Generate a random point in the weight space
    // Use round robin index as seed for deterministic but varied selection
    this.roundRobinIndex++;
    const point = (this.roundRobinIndex * 0.618033988749895) % 1 * totalWeight; // Golden ratio for good distribution

    // Find which server this point falls into
    let cumulative = 0;
    for (let i = 0; i < servers.length; i++) {
      cumulative += weights[i];
      if (point < cumulative) {
        return servers[i];
      }
    }

    // Fallback to last server
    return servers[servers.length - 1];
  }

  /**
   * Record a failure for a server (call this when requests fail)
   */
  recordServerFailure(serverId: string, errorType: 'timeout' | 'error' | 'disconnect' = 'error'): void {
    const stats = this.serverStats.get(serverId);
    if (!stats) return;

    stats.failedRequests++;
    stats.consecutiveFailures++;
    stats.consecutiveSuccesses = 0;

    // Apply extra penalty for timeouts (they waste more time)
    const failureWeight = errorType === 'timeout' ? 2 : 1;
    const effectiveFailures = stats.consecutiveFailures * failureWeight;

    // Check if we've hit the threshold for backoff
    if (effectiveFailures >= this.backoffConfig.failureThreshold) {
      stats.backoffLevel = Math.min(stats.backoffLevel + 1, 5); // Max 5 levels

      // Calculate cooldown with exponential backoff + jitter
      const delay = this.calculateBackoffDelay(stats.backoffLevel);
      stats.cooldownUntil = new Date(Date.now() + delay);

      // Reduce weight
      const newWeight = Math.max(
        this.backoffConfig.minWeight,
        1.0 - (stats.backoffLevel * this.backoffConfig.weightPenalty)
      );
      stats.weight = newWeight;

      const server = this.servers.find(s => s.id === serverId);
      log.warn(`Server ${server?.label || serverId} entered backoff level ${stats.backoffLevel}`, {
        cooldownMs: delay,
        cooldownUntil: stats.cooldownUntil.toISOString(),
        weight: stats.weight,
        consecutiveFailures: stats.consecutiveFailures,
        errorType,
      });

      // Update database (fire and forget)
      this.updateServerHealthInDb(serverId, stats.isHealthy, stats.consecutiveFailures);
    }
  }

  /**
   * Record a success for a server (call this when requests succeed)
   */
  recordServerSuccess(serverId: string): void {
    const stats = this.serverStats.get(serverId);
    if (!stats) return;

    stats.totalRequests++;
    stats.consecutiveSuccesses++;

    // Clear cooldown immediately on success
    if (stats.cooldownUntil) {
      stats.cooldownUntil = null;
    }

    // Gradual recovery
    if (stats.consecutiveSuccesses >= this.backoffConfig.recoveryThreshold) {
      if (stats.backoffLevel > 0) {
        stats.backoffLevel = Math.max(0, stats.backoffLevel - 1);
        stats.weight = Math.min(1.0, stats.weight + this.backoffConfig.weightPenalty);
        stats.consecutiveFailures = 0;

        const server = this.servers.find(s => s.id === serverId);
        if (stats.backoffLevel === 0) {
          log.info(`Server ${server?.label || serverId} fully recovered from backoff`, {
            weight: stats.weight,
          });
        } else {
          log.info(`Server ${server?.label || serverId} recovered one backoff level`, {
            newLevel: stats.backoffLevel,
            weight: stats.weight,
          });
        }

        // Update database
        this.updateServerHealthInDb(serverId, true, stats.consecutiveFailures);
      }
      stats.consecutiveSuccesses = 0; // Reset for next recovery cycle
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(level: number): number {
    // Exponential: baseDelay * 2^(level-1)
    const exponentialDelay = this.backoffConfig.baseDelayMs * Math.pow(2, level - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.backoffConfig.maxDelayMs);

    // Add jitter (±20%) to prevent thundering herd
    const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);

    return Math.round(cappedDelay + jitter);
  }

  /**
   * Check if a server is currently in cooldown
   */
  isServerInCooldown(serverId: string): boolean {
    const stats = this.serverStats.get(serverId);
    if (!stats || !stats.cooldownUntil) return false;
    return stats.cooldownUntil.getTime() > Date.now();
  }

  /**
   * Get current backoff state for a server
   */
  getServerBackoffState(serverId: string): {
    level: number;
    weight: number;
    inCooldown: boolean;
    cooldownRemaining: number;
    consecutiveFailures: number;
  } | null {
    const stats = this.serverStats.get(serverId);
    if (!stats) return null;

    const now = Date.now();
    const inCooldown = stats.cooldownUntil ? stats.cooldownUntil.getTime() > now : false;
    const cooldownRemaining = inCooldown && stats.cooldownUntil
      ? stats.cooldownUntil.getTime() - now
      : 0;

    return {
      level: stats.backoffLevel,
      weight: stats.weight,
      inCooldown,
      cooldownRemaining,
      consecutiveFailures: stats.consecutiveFailures,
    };
  }

  /**
   * Manually reset backoff state for a server (e.g., after manual health check)
   */
  resetServerBackoff(serverId: string): void {
    const stats = this.serverStats.get(serverId);
    if (!stats) return;

    const server = this.servers.find(s => s.id === serverId);
    log.info(`Manually resetting backoff for server ${server?.label || serverId}`);

    stats.consecutiveFailures = 0;
    stats.consecutiveSuccesses = 0;
    stats.backoffLevel = 0;
    stats.cooldownUntil = null;
    stats.weight = 1.0;
    stats.isHealthy = true;

    this.updateServerHealthInDb(serverId, true, 0);
  }

  /**
   * Record a health check result to history
   * @param serverId Server ID
   * @param success Whether the health check succeeded
   * @param latencyMs Response time in milliseconds
   * @param error Error message if failed
   */
  private recordHealthCheckResult(serverId: string, success: boolean, latencyMs?: number, error?: string): void {
    const stats = this.serverStats.get(serverId);
    if (!stats) return;

    const result: HealthCheckResult = {
      timestamp: new Date(),
      success,
      latencyMs,
      error: error ? error.substring(0, 200) : undefined, // Limit error message length
    };

    // Add to front of array (most recent first)
    stats.healthHistory.unshift(result);

    // Trim to max length
    if (stats.healthHistory.length > MAX_HEALTH_HISTORY) {
      stats.healthHistory = stats.healthHistory.slice(0, MAX_HEALTH_HISTORY);
    }
  }

  /**
   * Create a new connection to a specific server or auto-select
   */
  private async createConnection(server?: ServerConfig): Promise<PooledConnection> {
    // Select server if not provided
    const targetServer = server || this.selectServer();

    const id = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Determine connection timeout - increase significantly for Tor
    // Tor adds ~2-5 seconds latency for circuit establishment
    const baseTimeout = this.config.connectionTimeoutMs;
    const connectionTimeout = this.proxyConfig?.enabled ? baseTimeout * 3 : baseTimeout;

    // Create client with specific server config if available
    // Include proxy config so connections route through Tor when enabled
    const client = targetServer
      ? new ElectrumClient({
          host: targetServer.host,
          port: targetServer.port,
          protocol: targetServer.useSsl ? 'ssl' : 'tcp',
          connectionTimeoutMs: connectionTimeout,
          proxy: this.proxyConfig ?? undefined,
        })
      : new ElectrumClient();

    const serverLabel = targetServer?.label || 'default';
    log.debug(`Creating connection ${id} to ${serverLabel}...`);

    await client.connect();

    // Negotiate protocol version
    await client.getServerVersion();

    const conn: PooledConnection = {
      id,
      client,
      state: 'idle',
      createdAt: new Date(),
      lastUsedAt: new Date(),
      lastHealthCheck: new Date(),
      useCount: 0,
      isDedicated: false,
      serverId: targetServer?.id || 'default',
      serverLabel: targetServer?.label || 'default',
      serverHost: targetServer?.host || 'unknown',
      serverPort: targetServer?.port || 0,
    };

    // Set up error handling
    client.on('error', (error) => {
      log.error(`Connection ${id} error (${conn.serverLabel})`, { error: String(error) });
      this.handleConnectionError(conn);
    });

    this.connections.set(id, conn);
    log.debug(`Created connection ${id} to ${conn.serverLabel} (${conn.serverHost}:${conn.serverPort})`);

    return conn;
  }

  /**
   * Find an idle non-dedicated connection
   */
  private findIdleConnection(): PooledConnection | null {
    for (const conn of this.connections.values()) {
      if (conn.state === 'idle' && !conn.isDedicated && conn.client.isConnected()) {
        return conn;
      }
    }
    return null;
  }

  /**
   * Activate a connection for use
   */
  private activateConnection(
    conn: PooledConnection,
    purpose: string | undefined,
    startTime: number
  ): PooledConnectionHandle {
    conn.state = 'active';
    conn.lastUsedAt = new Date();
    conn.useCount++;

    const acquisitionTime = Date.now() - startTime;
    this.stats.totalAcquisitions++;
    this.stats.totalAcquisitionTimeMs += acquisitionTime;

    const release = () => {
      if (conn.state === 'active' && !conn.isDedicated) {
        conn.state = 'idle';
        conn.lastUsedAt = new Date();
        this.processWaitingQueue();
      }
    };

    return {
      client: conn.client,
      release,
      async withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T> {
        try {
          return await fn(conn.client);
        } finally {
          release();
        }
      },
    };
  }

  /**
   * Process the waiting queue when a connection becomes available
   */
  private processWaitingQueue(): void {
    if (this.waitingQueue.length === 0) return;

    const conn = this.findIdleConnection();
    if (!conn) return;

    const request = this.waitingQueue.shift();
    if (!request) return;

    clearTimeout(request.timeoutId);

    const handle = this.activateConnection(conn, request.purpose, request.startTime);
    request.resolve(handle);
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    // Track health status per server during this check cycle
    const serverHealthResults: Map<string, { success: number; fail: number; latencyMs?: number }> = new Map();

    for (const [id, conn] of this.connections) {
      if (conn.state === 'idle' || (conn.state === 'active' && conn.isDedicated)) {
        // Initialize server tracking
        if (!serverHealthResults.has(conn.serverId)) {
          serverHealthResults.set(conn.serverId, { success: 0, fail: 0 });
        }

        const startTime = Date.now();
        try {
          if (!conn.client.isConnected()) {
            throw new Error('Connection not connected');
          }
          // Lightweight health check
          await conn.client.getBlockHeight();
          const latencyMs = Date.now() - startTime;
          conn.lastHealthCheck = new Date();

          // Track success for this server
          const serverResult = serverHealthResults.get(conn.serverId)!;
          serverResult.success++;
          serverResult.latencyMs = latencyMs;

          // Record success for backoff recovery
          this.recordServerSuccess(conn.serverId);

          // Record to health history (only record once per server per cycle)
          if (serverResult.success === 1) {
            this.recordHealthCheckResult(conn.serverId, true, latencyMs);
          }
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          this.stats.healthCheckFailures++;
          const errorStr = String(error);
          log.warn(`Health check failed for connection ${id} (${conn.serverLabel})`, { error: errorStr });

          // Track failure for this server
          const serverResult = serverHealthResults.get(conn.serverId)!;
          serverResult.fail++;

          // Determine error type for backoff
          const errorType: 'timeout' | 'error' | 'disconnect' =
            errorStr.includes('timeout') || errorStr.includes('Timeout') ? 'timeout' :
            errorStr.includes('not connected') || errorStr.includes('disconnect') ? 'disconnect' :
            'error';

          // Record failure for backoff
          this.recordServerFailure(conn.serverId, errorType);

          // Record to health history (only record once per server per cycle - on first failure)
          if (serverResult.fail === 1) {
            this.recordHealthCheckResult(conn.serverId, false, latencyMs, errorStr);
          }

          if (conn.isDedicated) {
            // For dedicated connection, try to reconnect
            await this.reconnectConnection(conn);
          } else {
            this.handleConnectionError(conn);
          }
        }
      }
    }

    // Update per-server health stats and database
    for (const [serverId, results] of serverHealthResults) {
      const stats = this.serverStats.get(serverId);
      if (stats) {
        stats.lastHealthCheck = new Date();

        // If all connections to this server failed, mark unhealthy
        if (results.fail > 0 && results.success === 0) {
          stats.isHealthy = false;
          // Update database (fire and forget)
          this.updateServerHealthInDb(serverId, false, stats.consecutiveFailures);
          log.warn(`Server ${serverId} marked unhealthy after all connections failed health check`);
        } else if (results.success > 0) {
          // At least one success - mark healthy
          stats.isHealthy = true;
          this.updateServerHealthInDb(serverId, true, 0);
        }
      }
    }

    // After checking existing connections, ensure each server has at least one connection
    await this.ensureMinimumConnections();
  }

  /**
   * Send keepalive pings to idle connections to prevent server-side timeouts.
   * Some servers (like BlueWallet) drop idle TCP connections after ~30 seconds.
   */
  private async sendKeepalives(): Promise<void> {
    if (this.isShuttingDown) return;

    for (const [id, conn] of this.connections) {
      // Only ping idle, non-dedicated connections
      if (conn.state === 'idle' && !conn.isDedicated) {
        try {
          if (conn.client.isConnected()) {
            await conn.client.ping();
            log.debug(`Keepalive ping sent to ${conn.serverLabel}`);
          }
        } catch (error) {
          log.debug(`Keepalive ping failed for ${id} (${conn.serverLabel}): ${error}`);
          // Don't handle errors here - the health check will catch dead connections
        }
      }
    }
  }

  /**
   * Ensure each configured server has at least one connection.
   * This is called after health checks and after reloading servers.
   */
  private async ensureMinimumConnections(): Promise<void> {
    if (this.isShuttingDown || !this.config.enabled) return;

    // Count connections per server
    const serverConnectionCounts = new Map<string, number>();
    for (const server of this.servers) {
      serverConnectionCounts.set(server.id, 0);
    }
    for (const conn of this.connections.values()) {
      if (conn.state !== 'closed') {
        const count = serverConnectionCounts.get(conn.serverId) || 0;
        serverConnectionCounts.set(conn.serverId, count + 1);
      }
    }

    // Create connections for servers with zero connections
    for (const server of this.servers) {
      const count = serverConnectionCounts.get(server.id) || 0;
      if (count === 0) {
        log.info(`Server ${server.label} has no connections, creating one...`);
        try {
          await this.createConnection(server);
          log.info(`Created connection to ${server.label}`);
        } catch (error) {
          log.warn(`Failed to create connection to ${server.label}`, { error: String(error) });
        }
      }
    }
  }

  /**
   * Handle a connection error
   */
  private async handleConnectionError(conn: PooledConnection): Promise<void> {
    if (conn.isDedicated) {
      await this.reconnectConnection(conn);
    } else {
      // For non-dedicated, remove and create replacement if needed
      conn.state = 'closed';
      try {
        conn.client.disconnect();
      } catch {}
      this.connections.delete(conn.id);

      // Ensure minimum connections (at least 1 per server)
      if (this.connections.size < this.getEffectiveMinConnections() && !this.isShuttingDown) {
        this.createConnection().catch((err) => {
          log.error('Failed to create replacement connection', { error: String(err) });
        });
      }
    }
  }

  /**
   * Attempt to reconnect a connection
   */
  private async reconnectConnection(conn: PooledConnection): Promise<void> {
    conn.state = 'reconnecting';

    for (let attempt = 1; attempt <= this.config.maxReconnectAttempts; attempt++) {
      try {
        log.info(
          `Reconnecting ${conn.id} (attempt ${attempt}/${this.config.maxReconnectAttempts})`
        );

        // Disconnect old socket
        try {
          conn.client.disconnect();
        } catch {}

        // Reconnect
        await conn.client.connect();
        await conn.client.getServerVersion();

        conn.state = 'idle';
        conn.lastHealthCheck = new Date();
        log.info(`Reconnected ${conn.id}`);

        // Emit event for subscription re-establishment
        if (conn.isDedicated) {
          this.emit('subscriptionReconnected', conn.client);
        }

        return;
      } catch (error) {
        log.warn(`Reconnect attempt ${attempt} failed for ${conn.id}`, {
          error: String(error),
        });

        if (attempt < this.config.maxReconnectAttempts) {
          const delay = this.config.reconnectDelayMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All attempts failed
    conn.state = 'closed';
    this.connections.delete(conn.id);

    if (conn.id === this.subscriptionConnectionId) {
      this.subscriptionConnectionId = null;
      log.error('Subscription connection lost and could not be recovered');
    }

    log.error(
      `Failed to reconnect ${conn.id} after ${this.config.maxReconnectAttempts} attempts`
    );
  }

  /**
   * Clean up idle connections that have exceeded the idle timeout
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();

    for (const [id, conn] of this.connections) {
      // Don't cleanup dedicated or active connections
      if (conn.isDedicated || conn.state !== 'idle') continue;

      // Don't go below minimum (at least 1 per server)
      if (this.connections.size <= this.getEffectiveMinConnections()) break;

      const idleTime = now - conn.lastUsedAt.getTime();
      if (idleTime > this.config.idleTimeoutMs) {
        log.debug(`Closing idle connection ${id} (idle for ${idleTime}ms)`);
        conn.state = 'closed';
        try {
          conn.client.disconnect();
        } catch {}
        this.connections.delete(id);
      }
    }
  }
}

// Singleton pool instance (legacy - for backward compatibility, uses mainnet)
let poolInstance: ElectrumPool | null = null;
// Lock to prevent concurrent initialization (race condition fix)
let poolInitPromise: Promise<ElectrumPool> | null = null;

/**
 * Network type for pool operations
 */
export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';

// Per-network pool registry
const networkPools = new Map<NetworkType, ElectrumPool>();
const networkPoolInitPromises = new Map<NetworkType, Promise<ElectrumPool>>();

/**
 * Load pool configuration from database for a specific network
 * @param network Network to load config for (defaults to mainnet)
 */
async function loadPoolConfigFromDatabase(network: NetworkType = 'mainnet'): Promise<{
  config: Partial<ElectrumPoolConfig>;
  servers: ServerConfig[];
  proxy: ProxyConfig | null;
}> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true, type: 'electrum' },
      include: {
        servers: {
          where: { enabled: true, network: network },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (nodeConfig) {
      const servers: ServerConfig[] = nodeConfig.servers.map(s => ({
        id: s.id,
        label: s.label,
        host: s.host,
        port: s.port,
        useSsl: s.useSsl,
        priority: s.priority,
        enabled: s.enabled,
      }));

      // Load proxy config if enabled
      let proxy: ProxyConfig | null = null;
      if (nodeConfig.proxyEnabled && nodeConfig.proxyHost && nodeConfig.proxyPort) {
        proxy = {
          enabled: true,
          host: nodeConfig.proxyHost,
          port: nodeConfig.proxyPort,
          username: nodeConfig.proxyUsername ?? undefined,
          password: nodeConfig.proxyPassword ?? undefined,
        };
      }

      // Get per-network pool settings
      let minConnections = nodeConfig.poolMinConnections;
      let maxConnections = nodeConfig.poolMaxConnections;
      let loadBalancing = nodeConfig.poolLoadBalancing as LoadBalancingStrategy;

      // Use per-network settings if available (new schema)
      if (network === 'mainnet') {
        minConnections = nodeConfig.mainnetPoolMin ?? minConnections;
        maxConnections = nodeConfig.mainnetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.mainnetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      } else if (network === 'testnet') {
        minConnections = nodeConfig.testnetPoolMin ?? minConnections;
        maxConnections = nodeConfig.testnetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.testnetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      } else if (network === 'signet') {
        minConnections = nodeConfig.signetPoolMin ?? minConnections;
        maxConnections = nodeConfig.signetPoolMax ?? maxConnections;
        loadBalancing = (nodeConfig.signetPoolLoadBalancing as LoadBalancingStrategy) ?? loadBalancing;
      }

      return {
        config: {
          enabled: nodeConfig.poolEnabled,
          minConnections,
          maxConnections,
          loadBalancing,
        },
        servers,
        proxy,
      };
    }
  } catch (error) {
    log.warn('Failed to load pool config from database, using defaults', { error: String(error), network });
  }

  return { config: {}, servers: [], proxy: null };
}

/**
 * Get or create an Electrum pool for a specific network
 * This loads settings from the database and filters servers by network.
 * @param network Network to get pool for
 */
export async function getElectrumPoolForNetwork(network: NetworkType): Promise<ElectrumPool> {
  // Fast path: pool already exists for this network
  const existingPool = networkPools.get(network);
  if (existingPool) {
    return existingPool;
  }

  // Another caller is already initializing this network's pool - wait for their result
  const existingPromise = networkPoolInitPromises.get(network);
  if (existingPromise) {
    return existingPromise;
  }

  // We're the first caller for this network - create and store the init promise
  const initPromise = (async () => {
    // Double-check in case of race
    const poolCheck = networkPools.get(network);
    if (poolCheck) {
      return poolCheck;
    }

    log.info(`Initializing Electrum pool for network: ${network}`);

    // Load config and servers from database for this specific network
    const { config: dbConfig, servers, proxy } = await loadPoolConfigFromDatabase(network);

    // Environment variables as fallback
    const envConfig: Partial<ElectrumPoolConfig> = {
      enabled: process.env.ELECTRUM_POOL_ENABLED !== 'false',
      minConnections: parseInt(process.env.ELECTRUM_POOL_MIN_CONNECTIONS || '1', 10),
      maxConnections: parseInt(process.env.ELECTRUM_POOL_MAX_CONNECTIONS || '5', 10),
      idleTimeoutMs: parseInt(process.env.ELECTRUM_POOL_IDLE_TIMEOUT_MS || '300000', 10),
      healthCheckIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS || '30000',
        10
      ),
      acquisitionTimeoutMs: parseInt(
        process.env.ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS || '5000',
        10
      ),
      keepaliveIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS || '15000',
        10
      ),
    };

    // Database config takes precedence over environment variables
    const pool = new ElectrumPool({
      ...envConfig,
      ...dbConfig,
    });

    // Configure proxy if enabled
    if (proxy) {
      pool.setProxyConfig(proxy);
    }

    // Configure servers for this network
    if (servers.length > 0) {
      pool.setServers(servers);
    }

    // Store in registry
    networkPools.set(network, pool);

    // Also set as the global pool instance if this is mainnet (backward compat)
    if (network === 'mainnet' && !poolInstance) {
      poolInstance = pool;
    }

    log.info(`Electrum pool for ${network} initialized with ${servers.length} servers`);

    return pool;
  })();

  networkPoolInitPromises.set(network, initPromise);

  try {
    return await initPromise;
  } finally {
    // Clear the init promise once resolved
    networkPoolInitPromises.delete(network);
  }
}

/**
 * Reset the pool for a specific network (for testing or config changes)
 */
export async function resetElectrumPoolForNetwork(network: NetworkType): Promise<void> {
  const pool = networkPools.get(network);
  if (pool) {
    await pool.shutdown();
    networkPools.delete(network);
    log.info(`Electrum pool for ${network} has been reset`);
  }
}

/**
 * Get the Electrum pool instance (sync version, uses env vars only)
 */
export function getElectrumPool(config?: Partial<ElectrumPoolConfig>): ElectrumPool {
  if (!poolInstance) {
    // ELECTRUM_POOL_ENABLED defaults to true; set to 'false' for single-connection mode
    const poolEnabled = process.env.ELECTRUM_POOL_ENABLED !== 'false';

    poolInstance = new ElectrumPool({
      enabled: poolEnabled,
      minConnections: parseInt(process.env.ELECTRUM_POOL_MIN_CONNECTIONS || '1', 10),
      maxConnections: parseInt(process.env.ELECTRUM_POOL_MAX_CONNECTIONS || '5', 10),
      idleTimeoutMs: parseInt(process.env.ELECTRUM_POOL_IDLE_TIMEOUT_MS || '300000', 10),
      healthCheckIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS || '30000',
        10
      ),
      acquisitionTimeoutMs: parseInt(
        process.env.ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS || '5000',
        10
      ),
      keepaliveIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS || '15000',
        10
      ),
      ...config,
    });
  }
  return poolInstance;
}

/**
 * Get or create the Electrum pool with database config (async)
 * This loads settings from the database, falling back to environment variables
 */
export async function getElectrumPoolAsync(): Promise<ElectrumPool> {
  // Fast path: pool already exists
  if (poolInstance) {
    return poolInstance;
  }

  // Another caller is already initializing - wait for their result
  if (poolInitPromise) {
    return poolInitPromise;
  }

  // We're the first caller - create and store the init promise
  poolInitPromise = (async () => {
    // Double-check in case of race (defensive)
    if (poolInstance) {
      return poolInstance;
    }

    // Load config and servers from database
    const { config: dbConfig, servers, proxy } = await loadPoolConfigFromDatabase();

    // Environment variables as fallback
    const envConfig: Partial<ElectrumPoolConfig> = {
      enabled: process.env.ELECTRUM_POOL_ENABLED !== 'false',
      minConnections: parseInt(process.env.ELECTRUM_POOL_MIN_CONNECTIONS || '1', 10),
      maxConnections: parseInt(process.env.ELECTRUM_POOL_MAX_CONNECTIONS || '5', 10),
      idleTimeoutMs: parseInt(process.env.ELECTRUM_POOL_IDLE_TIMEOUT_MS || '300000', 10),
      healthCheckIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_HEALTH_CHECK_INTERVAL_MS || '30000',
        10
      ),
      acquisitionTimeoutMs: parseInt(
        process.env.ELECTRUM_POOL_ACQUISITION_TIMEOUT_MS || '5000',
        10
      ),
      keepaliveIntervalMs: parseInt(
        process.env.ELECTRUM_POOL_KEEPALIVE_INTERVAL_MS || '15000',
        10
      ),
    };

    // Database config takes precedence over environment variables
    poolInstance = new ElectrumPool({
      ...envConfig,
      ...dbConfig,
    });

    // Set proxy config if loaded from database
    if (proxy) {
      poolInstance.setProxyConfig(proxy);
      log.info('Electrum pool configured with Tor proxy', {
        host: proxy.host,
        port: proxy.port,
      });
    }

    // Set servers if any were loaded from database
    if (servers.length > 0) {
      poolInstance.setServers(servers);
      log.info('Electrum pool configured with servers from database', {
        serverCount: servers.length,
        servers: servers.map(s => `${s.label} (${s.host}:${s.port})`),
      });
    }

    log.info('Electrum pool created', {
      enabled: poolInstance['config'].enabled,
      minConnections: poolInstance['config'].minConnections,
      maxConnections: poolInstance['config'].maxConnections,
      loadBalancing: poolInstance['config'].loadBalancing,
      proxyEnabled: proxy?.enabled ?? false,
    });

    return poolInstance;
  })();

  try {
    return await poolInitPromise;
  } finally {
    // Clear the promise after completion (success or failure)
    // This allows retry on failure
    poolInitPromise = null;
  }
}

/**
 * Initialize the Electrum pool (loads config from database)
 */
export async function initializeElectrumPool(
  config?: Partial<ElectrumPoolConfig>
): Promise<ElectrumPool> {
  // If config provided, use sync version; otherwise load from database
  const pool = config ? getElectrumPool(config) : await getElectrumPoolAsync();
  await pool.initialize();
  return pool;
}

/**
 * Shutdown the Electrum pool
 */
export async function shutdownElectrumPool(): Promise<void> {
  // Clear init promise to prevent new initialization during shutdown
  poolInitPromise = null;

  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
}

/**
 * Reset the Electrum pool (for testing or config changes)
 */
export async function resetElectrumPool(): Promise<void> {
  await shutdownElectrumPool();
}

/**
 * Get current pool configuration (for admin UI)
 */
export function getPoolConfig(): ElectrumPoolConfig | null {
  if (!poolInstance) return null;
  return { ...poolInstance['config'] };
}

/**
 * Check if pool is currently enabled
 */
export function isPoolEnabled(): boolean {
  if (!poolInstance) return true; // Default is enabled
  return poolInstance['config'].enabled;
}

/**
 * Reload servers from database (call after adding/removing servers)
 */
export async function reloadElectrumServers(): Promise<void> {
  if (poolInstance) {
    await poolInstance.reloadServers();
  }
}

/**
 * Get the list of configured servers
 */
export function getElectrumServers(): ServerConfig[] {
  if (!poolInstance) return [];
  return poolInstance.getServers();
}
