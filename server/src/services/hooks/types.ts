/**
 * Operation Hooks Types
 *
 * Defines interfaces for the operation hooks system.
 * Hooks can be registered to run before/after operations for:
 * - Validation
 * - Logging/auditing
 * - Side effects
 * - Custom business logic
 */

/**
 * Hook execution phase
 */
export type HookPhase = 'before' | 'after';

/**
 * Hook priority - determines execution order
 * Lower numbers run first
 */
export type HookPriority = number;

/**
 * Standard priority levels
 */
export const HookPriorities = {
  /** Run first - validation, security checks */
  HIGHEST: 0,
  /** Run early - logging, auditing */
  HIGH: 25,
  /** Default priority */
  NORMAL: 50,
  /** Run late - notifications, side effects */
  LOW: 75,
  /** Run last - cleanup */
  LOWEST: 100,
} as const;

/**
 * Hook context passed to hook handlers
 */
export interface HookContext<T = unknown> {
  /** The operation being performed */
  operation: string;
  /** The phase (before/after) */
  phase: HookPhase;
  /** The payload/data for the operation */
  payload: T;
  /** User ID if authenticated */
  userId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Result (only available in 'after' phase) */
  result?: unknown;
  /** Error (only available in 'after' phase if operation failed) */
  error?: Error;
  /** Whether the operation was successful (only in 'after' phase) */
  success?: boolean;
}

/**
 * Hook handler function
 * Can return a modified payload or throw to abort the operation
 */
export type HookHandler<T = unknown, R = T> = (context: HookContext<T>) => R | Promise<R> | void | Promise<void>;

/**
 * Registered hook with metadata
 */
export interface RegisteredHook<T = unknown, R = T> {
  /** Unique identifier for this hook registration */
  id: string;
  /** Operation name this hook handles */
  operation: string;
  /** Phase to run in */
  phase: HookPhase;
  /** Priority (lower = runs earlier) */
  priority: HookPriority;
  /** The handler function */
  handler: HookHandler<T, R>;
  /** Whether the hook is enabled */
  enabled: boolean;
  /** Description of what this hook does */
  description?: string;
}

/**
 * Hook registration options
 */
export interface HookRegistrationOptions {
  /** Priority (lower = runs earlier), default: HookPriorities.NORMAL */
  priority?: HookPriority;
  /** Description of what this hook does */
  description?: string;
  /** Whether the hook starts enabled, default: true */
  enabled?: boolean;
}

/**
 * Hook execution result
 */
export interface HookExecutionResult<T = unknown> {
  /** Whether all hooks executed successfully */
  success: boolean;
  /** The final payload after all hooks */
  payload: T;
  /** Number of hooks executed */
  hooksExecuted: number;
  /** Errors from failed hooks (if any) */
  errors?: Array<{ hookId: string; error: Error }>;
  /** Execution time in ms */
  executionTimeMs: number;
}

/**
 * Operations that have hooks registered
 */
export const Operations = {
  // Wallet operations
  WALLET_CREATE: 'wallet:create',
  WALLET_DELETE: 'wallet:delete',
  WALLET_IMPORT: 'wallet:import',
  WALLET_SHARE: 'wallet:share',

  // Device operations
  DEVICE_REGISTER: 'device:register',
  DEVICE_DELETE: 'device:delete',
  DEVICE_UPDATE: 'device:update',

  // Transaction operations
  TRANSACTION_CREATE: 'transaction:create',
  TRANSACTION_SIGN: 'transaction:sign',
  TRANSACTION_BROADCAST: 'transaction:broadcast',

  // Address operations
  ADDRESS_GENERATE: 'address:generate',
  ADDRESS_LABEL: 'address:label',

  // Auth operations
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_TOKEN_REFRESH: 'auth:token_refresh',

  // User operations
  USER_CREATE: 'user:create',
  USER_DELETE: 'user:delete',
  USER_UPDATE: 'user:update',

  // Sync operations
  SYNC_WALLET: 'sync:wallet',
  SYNC_ALL: 'sync:all',
} as const;

export type OperationName = (typeof Operations)[keyof typeof Operations];

/**
 * Registry configuration
 */
export interface HookRegistryConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Stop on first error in before hooks (default: true) */
  stopOnBeforeError?: boolean;
  /** Log hook executions */
  logExecutions?: boolean;
}
