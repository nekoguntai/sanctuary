/**
 * Electrum Connection Pool
 *
 * Manages a pool of Electrum server connections for improved
 * performance and resilience. Provides:
 * - Connection pooling with min/max limits
 * - Health checks and automatic reconnection
 * - Dedicated subscription connection for real-time events
 * - Acquisition queue when pool is exhausted
 */

import { EventEmitter } from 'events';
import { ElectrumClient } from './electrum';
import { createLogger } from '../../utils/logger';
import prisma from '../../models/prisma';

const log = createLogger('ELECTRUM_POOL');

/**
 * Pool configuration options
 */
export interface ElectrumPoolConfig {
  // Pool mode
  enabled: boolean; // If false, acts as single connection (legacy mode)

  // Pool sizing
  minConnections: number;
  maxConnections: number;

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
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG: ElectrumPoolConfig = {
  enabled: true, // Set to false for single-connection mode
  minConnections: 1,
  maxConnections: 5,
  connectionTimeoutMs: 10000,
  idleTimeoutMs: 300000,
  healthCheckIntervalMs: 30000,
  acquisitionTimeoutMs: 5000,
  maxWaitingRequests: 100,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
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
}

/**
 * Acquisition options
 */
export interface AcquireOptions {
  purpose?: string;
  timeoutMs?: number;
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
 * Manages a pool of connections to an Electrum server for improved
 * concurrency and resilience.
 */
export class ElectrumPool extends EventEmitter {
  private config: ElectrumPoolConfig;
  private connections: Map<string, PooledConnection> = new Map();
  private waitingQueue: WaitingRequest[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private isInitialized = false;
  private subscriptionConnectionId: string | null = null;

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
   * Initialize the pool by creating minimum connections
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      log.debug('Pool already initialized');
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

    log.info(
      `Initializing Electrum pool (min: ${this.config.minConnections}, max: ${this.config.maxConnections})`
    );

    // Create minimum connections
    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.minConnections; i++) {
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

    this.isInitialized = true;
    log.info(`Electrum pool initialized with ${this.connections.size} connections`);
  }

  /**
   * Shutdown the pool and close all connections
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Electrum pool...');
    this.isShuttingDown = true;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
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
    if (this.connections.size < this.config.maxConnections) {
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
    if (!conn && this.connections.size < this.config.maxConnections) {
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
    };
  }

  /**
   * Check if the pool is healthy (has available capacity)
   */
  isHealthy(): boolean {
    if (!this.isInitialized) return false;
    const stats = this.getPoolStats();
    return stats.idleConnections > 0 || stats.totalConnections < this.config.maxConnections;
  }

  /**
   * Check if the pool is initialized
   */
  isPoolInitialized(): boolean {
    return this.isInitialized;
  }

  // Private methods

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<PooledConnection> {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const client = new ElectrumClient();

    log.debug(`Creating connection ${id}...`);

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
    };

    // Set up error handling
    client.on('error', (error) => {
      log.error(`Connection ${id} error`, { error: String(error) });
      this.handleConnectionError(conn);
    });

    this.connections.set(id, conn);
    log.debug(`Created connection ${id}`);

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
    for (const [id, conn] of this.connections) {
      if (conn.state === 'idle' || (conn.state === 'active' && conn.isDedicated)) {
        try {
          if (!conn.client.isConnected()) {
            throw new Error('Connection not connected');
          }
          // Lightweight health check
          await conn.client.getBlockHeight();
          conn.lastHealthCheck = new Date();
        } catch (error) {
          this.stats.healthCheckFailures++;
          log.warn(`Health check failed for connection ${id}`, { error: String(error) });

          if (conn.isDedicated) {
            // For dedicated connection, try to reconnect
            await this.reconnectConnection(conn);
          } else {
            this.handleConnectionError(conn);
          }
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

      // Ensure minimum connections
      if (this.connections.size < this.config.minConnections && !this.isShuttingDown) {
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

      // Don't go below minimum
      if (this.connections.size <= this.config.minConnections) break;

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

// Singleton pool instance
let poolInstance: ElectrumPool | null = null;

/**
 * Load pool configuration from database
 */
async function loadPoolConfigFromDatabase(): Promise<Partial<ElectrumPoolConfig>> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true, type: 'electrum' },
    });

    if (nodeConfig) {
      return {
        enabled: nodeConfig.poolEnabled,
        minConnections: nodeConfig.poolMinConnections,
        maxConnections: nodeConfig.poolMaxConnections,
      };
    }
  } catch (error) {
    log.warn('Failed to load pool config from database, using defaults', { error: String(error) });
  }

  return {};
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
  if (!poolInstance) {
    // Load config from database first
    const dbConfig = await loadPoolConfigFromDatabase();

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
    };

    // Database config takes precedence over environment variables
    poolInstance = new ElectrumPool({
      ...envConfig,
      ...dbConfig,
    });

    log.info('Electrum pool created', {
      enabled: poolInstance['config'].enabled,
      minConnections: poolInstance['config'].minConnections,
      maxConnections: poolInstance['config'].maxConnections,
    });
  }
  return poolInstance;
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
