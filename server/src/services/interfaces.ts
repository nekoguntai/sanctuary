/**
 * Service Interfaces
 *
 * Explicit interface definitions for core services to enable:
 * - Compile-time contract verification
 * - Easy mocking for unit tests
 * - Dependency injection patterns
 * - Clear documentation of service capabilities
 *
 * Usage in production:
 *   import { syncService } from './syncService';
 *   // syncService implements ISyncService
 *
 * Usage in tests:
 *   const mockSyncService: ISyncService = {
 *     start: jest.fn(),
 *     stop: jest.fn(),
 *     ...
 *   };
 */

// =============================================================================
// Sync Service Interface
// =============================================================================

/**
 * Wallet sync status for monitoring
 */
export interface WalletSyncStatus {
  walletId: string;
  inProgress: boolean;
  lastSyncedAt: Date | null;
  error?: string;
  retryCount?: number;
}

/**
 * Sync service for wallet synchronization with blockchain
 */
export interface ISyncService {
  /** Start the sync service */
  start(): Promise<void>;

  /** Stop the sync service */
  stop(): void;

  /** Trigger immediate sync for a wallet */
  triggerSync(walletId: string, options?: { fullResync?: boolean }): Promise<void>;

  /** Check if a wallet is currently syncing */
  isSyncing(walletId: string): boolean;

  /** Get sync status for a wallet */
  getStatus(walletId: string): WalletSyncStatus | null;

  /** Get all active sync statuses */
  getAllStatuses(): WalletSyncStatus[];
}

// =============================================================================
// Maintenance Service Interface
// =============================================================================

/**
 * Maintenance task result
 */
export interface MaintenanceTaskResult {
  task: string;
  success: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Maintenance service for scheduled cleanup and optimization tasks
 */
export interface IMaintenanceService {
  /** Start the maintenance scheduler */
  start(): void;

  /** Stop the maintenance scheduler */
  stop(): void;

  /** Run a specific maintenance task immediately */
  runTask(taskName: string): Promise<MaintenanceTaskResult>;

  /** Get status of last run for each task */
  getLastRunStatus(): Record<string, MaintenanceTaskResult>;

  /** Check if maintenance is currently running */
  isRunning(): boolean;
}

// =============================================================================
// Audit Service Interface
// =============================================================================

/**
 * Audit log entry
 */
export interface AuditEntry {
  id?: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp?: Date;
}

/**
 * Audit query options
 */
export interface AuditQueryOptions {
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Audit service for security logging
 */
export interface IAuditService {
  /** Log an audit event */
  log(entry: AuditEntry): Promise<void>;

  /** Query audit logs */
  query(options: AuditQueryOptions): Promise<AuditEntry[]>;

  /** Count matching audit entries */
  count(options: AuditQueryOptions): Promise<number>;
}

// =============================================================================
// Price Service Interface
// =============================================================================

/**
 * Price data
 */
export interface PriceData {
  btcUsd: number;
  btcEur?: number;
  btcGbp?: number;
  source: string;
  timestamp: Date;
}

/**
 * Fee estimate data
 */
export interface FeeEstimate {
  fastestFee: number;  // sat/vB for next block
  halfHourFee: number; // sat/vB for ~30 min
  hourFee: number;     // sat/vB for ~1 hour
  economyFee: number;  // sat/vB for low priority
  minimumFee: number;  // sat/vB minimum relay fee
  timestamp: Date;
}

/**
 * Price service for BTC price and fee estimates
 */
export interface IPriceService {
  /** Get current BTC price */
  getPrice(): Promise<PriceData>;

  /** Get current fee estimates */
  getFeeEstimates(): Promise<FeeEstimate>;

  /** Get historical price data */
  getHistoricalPrices(days: number): Promise<PriceData[]>;
}

// =============================================================================
// Notification Service Interface
// =============================================================================

/**
 * Push notification payload
 */
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

/**
 * Notification service for push notifications
 */
export interface INotificationService {
  /** Start the notification service */
  start(): Promise<void>;

  /** Stop the notification service */
  stop(): void;

  /** Send notification to a user */
  sendToUser(userId: string, payload: NotificationPayload): Promise<boolean>;

  /** Send notification to multiple users */
  sendToUsers(userIds: string[], payload: NotificationPayload): Promise<number>;

  /** Check if service is healthy */
  isHealthy(): boolean;
}

// =============================================================================
// Token Revocation Service Interface
// =============================================================================

/**
 * Token revocation service for invalidating JWT tokens
 */
export interface ITokenRevocationService {
  /** Revoke a specific token */
  revokeToken(tokenId: string, expiresAt: Date): Promise<void>;

  /** Revoke all tokens for a user */
  revokeAllUserTokens(userId: string): Promise<void>;

  /** Check if a token is revoked */
  isRevoked(tokenId: string): Promise<boolean>;

  /** Clean up expired revocations */
  cleanup(): Promise<number>;
}

// =============================================================================
// Circuit Breaker Interface
// =============================================================================

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker health info
 */
export interface CircuitHealth {
  name: string;
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
}

/**
 * Circuit breaker for fault tolerance
 */
export interface ICircuitBreaker<T> {
  /** Execute an operation with circuit breaker protection */
  execute(operation: () => Promise<T>): Promise<T>;

  /** Get current circuit health */
  getHealth(): CircuitHealth;

  /** Manually trip the circuit */
  trip(): void;

  /** Manually reset the circuit */
  reset(): void;
}

// =============================================================================
// Wallet Service Interface
// =============================================================================

/**
 * Basic wallet info
 */
export interface WalletInfo {
  id: string;
  name: string;
  type: 'single' | 'multisig';
  network: 'mainnet' | 'testnet' | 'signet' | 'regtest';
  balance: bigint;
  unconfirmedBalance: bigint;
}

/**
 * Wallet service for wallet operations
 */
export interface IWalletService {
  /** Get wallet by ID */
  getWallet(walletId: string): Promise<WalletInfo | null>;

  /** Get all wallets for a user */
  getUserWallets(userId: string): Promise<WalletInfo[]>;

  /** Check if user has access to wallet */
  checkAccess(walletId: string, userId: string): Promise<boolean>;

  /** Update wallet balance */
  updateBalance(walletId: string, balance: bigint, unconfirmedBalance: bigint): Promise<void>;
}

// =============================================================================
// Service Registry Interface
// =============================================================================

/**
 * Service registry for dependency injection
 */
export interface IServiceRegistry {
  /** Register a service instance */
  register<T>(name: string, instance: T): void;

  /** Get a registered service */
  get<T>(name: string): T;

  /** Check if a service is registered */
  has(name: string): boolean;

  /** Get all registered service names */
  getNames(): string[];
}

// =============================================================================
// Lifecycle Interface
// =============================================================================

/**
 * Common lifecycle interface for startable/stoppable services
 */
export interface ILifecycle {
  /** Start the service */
  start(): Promise<void> | void;

  /** Stop the service gracefully */
  stop(): Promise<void> | void;

  /** Check if service is running */
  isRunning(): boolean;
}

/**
 * Health check interface for monitorable services
 */
export interface IHealthCheck {
  /** Perform health check */
  healthCheck(): Promise<boolean>;

  /** Get detailed health status */
  getHealthStatus(): {
    healthy: boolean;
    details?: Record<string, unknown>;
  };
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Service factory function type
 */
export type ServiceFactory<T> = () => T;

/**
 * Async service factory function type
 */
export type AsyncServiceFactory<T> = () => Promise<T>;
