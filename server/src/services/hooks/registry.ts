/**
 * Operation Hooks Registry
 *
 * Central registry for operation hooks.
 * Allows registering before/after hooks for various operations.
 */

import { createLogger } from '../../utils/logger';
import type {
  HookPhase,
  HookHandler,
  HookContext,
  RegisteredHook,
  HookRegistrationOptions,
  HookExecutionResult,
  HookRegistryConfig,
} from './types';
import { HookPriorities } from './types';

const log = createLogger('HOOKS:REGISTRY');

/**
 * Generate unique hook ID
 */
function generateHookId(): string {
  return `hook_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Operation Hooks Registry
 */
class HookRegistry {
  private hooks: Map<string, RegisteredHook[]> = new Map();
  private config: HookRegistryConfig;

  constructor(config: HookRegistryConfig = {}) {
    this.config = {
      stopOnBeforeError: true,
      logExecutions: false,
      ...config,
    };
  }

  /**
   * Get the map key for a hook
   */
  private getKey(operation: string, phase: HookPhase): string {
    return `${operation}:${phase}`;
  }

  /**
   * Register a before hook
   */
  before<T = unknown, R = T>(
    operation: string,
    handler: HookHandler<T, R>,
    options: HookRegistrationOptions = {}
  ): string {
    return this.register(operation, 'before', handler, options);
  }

  /**
   * Register an after hook
   */
  after<T = unknown, R = T>(
    operation: string,
    handler: HookHandler<T, R>,
    options: HookRegistrationOptions = {}
  ): string {
    return this.register(operation, 'after', handler, options);
  }

  /**
   * Register a hook
   */
  private register<T = unknown, R = T>(
    operation: string,
    phase: HookPhase,
    handler: HookHandler<T, R>,
    options: HookRegistrationOptions = {}
  ): string {
    const id = generateHookId();
    const key = this.getKey(operation, phase);

    const hook: RegisteredHook<T, R> = {
      id,
      operation,
      phase,
      priority: options.priority ?? HookPriorities.NORMAL,
      handler,
      enabled: options.enabled ?? true,
      description: options.description,
    };

    const hooks = this.hooks.get(key) || [];
    hooks.push(hook as RegisteredHook);
    // Sort by priority (lower = runs earlier)
    hooks.sort((a, b) => a.priority - b.priority);
    this.hooks.set(key, hooks);

    if (this.config.debug) {
      log.debug('Registered hook', {
        id,
        operation,
        phase,
        priority: hook.priority,
        description: hook.description,
      });
    }

    return id;
  }

  /**
   * Unregister a hook by ID
   */
  unregister(hookId: string): boolean {
    for (const [key, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        if (hooks.length === 0) {
          this.hooks.delete(key);
        }
        if (this.config.debug) {
          log.debug('Unregistered hook', { id: hookId });
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Enable/disable a hook
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find((h) => h.id === hookId);
      if (hook) {
        hook.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /**
   * Get hooks for an operation and phase
   */
  getHooks(operation: string, phase: HookPhase): RegisteredHook[] {
    const key = this.getKey(operation, phase);
    return this.hooks.get(key) || [];
  }

  /**
   * Get all enabled hooks for an operation and phase
   */
  getEnabledHooks(operation: string, phase: HookPhase): RegisteredHook[] {
    return this.getHooks(operation, phase).filter((h) => h.enabled);
  }

  /**
   * Execute before hooks for an operation
   * Returns modified payload or throws if a hook fails and stopOnBeforeError is true
   */
  async executeBefore<T>(
    operation: string,
    payload: T,
    options: { userId?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<HookExecutionResult<T>> {
    return this.executeHooks(operation, 'before', payload, options);
  }

  /**
   * Execute after hooks for an operation
   * After hooks receive the result and can't modify it
   */
  async executeAfter<T>(
    operation: string,
    payload: T,
    options: {
      userId?: string;
      metadata?: Record<string, unknown>;
      result?: unknown;
      error?: Error;
      success?: boolean;
    } = {}
  ): Promise<HookExecutionResult<T>> {
    return this.executeHooks(operation, 'after', payload, options);
  }

  /**
   * Execute hooks for an operation
   */
  private async executeHooks<T>(
    operation: string,
    phase: HookPhase,
    payload: T,
    options: {
      userId?: string;
      metadata?: Record<string, unknown>;
      result?: unknown;
      error?: Error;
      success?: boolean;
    } = {}
  ): Promise<HookExecutionResult<T>> {
    const startTime = Date.now();
    const hooks = this.getEnabledHooks(operation, phase);
    const errors: Array<{ hookId: string; error: Error }> = [];

    let currentPayload = payload;
    let hooksExecuted = 0;

    for (const hook of hooks) {
      const context: HookContext<T> = {
        operation,
        phase,
        payload: currentPayload,
        userId: options.userId,
        metadata: options.metadata,
        result: options.result,
        error: options.error,
        success: options.success,
      };

      try {
        if (this.config.logExecutions) {
          log.debug('Executing hook', {
            id: hook.id,
            operation,
            phase,
            priority: hook.priority,
          });
        }

        const result = await hook.handler(context);
        hooksExecuted++;

        // Before hooks can modify the payload
        if (phase === 'before' && result !== undefined) {
          currentPayload = result as T;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ hookId: hook.id, error: err });

        log.warn('Hook execution failed', {
          id: hook.id,
          operation,
          phase,
          error: err.message,
        });

        // For before hooks, stop on error if configured
        if (phase === 'before' && this.config.stopOnBeforeError) {
          throw err;
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;

    if (this.config.logExecutions && hooks.length > 0) {
      log.debug('Hooks execution complete', {
        operation,
        phase,
        hooksExecuted,
        errors: errors.length,
        executionTimeMs,
      });
    }

    return {
      success: errors.length === 0,
      payload: currentPayload,
      hooksExecuted,
      errors: errors.length > 0 ? errors : undefined,
      executionTimeMs,
    };
  }

  /**
   * Wrap an operation with before/after hooks
   * This is a convenience method for running hooks around an async operation
   */
  async wrap<T, R>(
    operation: string,
    payload: T,
    fn: (modifiedPayload: T) => Promise<R>,
    options: { userId?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<R> {
    // Execute before hooks
    const beforeResult = await this.executeBefore(operation, payload, options);

    let result: R | undefined;
    let error: Error | undefined;
    let success = false;

    try {
      // Execute the operation
      result = await fn(beforeResult.payload);
      success = true;
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      success = false;

      // Execute after hooks with error info
      this.executeAfter(operation, beforeResult.payload, {
        ...options,
        result: undefined,
        error,
        success,
      }).catch((afterError) => {
        log.error('After hooks failed', {
          operation,
          error: afterError instanceof Error ? afterError.message : String(afterError),
        });
      });

      throw e;
    }

    // Execute after hooks with success info
    this.executeAfter(operation, beforeResult.payload, {
      ...options,
      result,
      error: undefined,
      success,
    }).catch((afterError) => {
      log.error('After hooks failed', {
        operation,
        error: afterError instanceof Error ? afterError.message : String(afterError),
      });
    });

    return result;
  }

  /**
   * Get all registered operations
   */
  getOperations(): string[] {
    const operations = new Set<string>();
    for (const key of this.hooks.keys()) {
      operations.add(key.split(':')[0]);
    }
    return Array.from(operations);
  }

  /**
   * Get hook count for an operation
   */
  getHookCount(operation: string): { before: number; after: number } {
    return {
      before: this.getHooks(operation, 'before').length,
      after: this.getHooks(operation, 'after').length,
    };
  }

  /**
   * Clear all hooks (for testing)
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Get summary of registered hooks
   */
  getSummary(): {
    totalHooks: number;
    operations: Array<{
      operation: string;
      before: number;
      after: number;
    }>;
  } {
    const operations = this.getOperations();
    return {
      totalHooks: Array.from(this.hooks.values()).reduce((sum, h) => sum + h.length, 0),
      operations: operations.map((op) => ({
        operation: op,
        ...this.getHookCount(op),
      })),
    };
  }
}

// Singleton instance
export const hookRegistry = new HookRegistry({ debug: false, logExecutions: false });

// Also export class for testing
export { HookRegistry };
