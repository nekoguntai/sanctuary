/**
 * Operation Hooks System
 *
 * Provides before/after hooks for various operations in the system.
 * Useful for:
 * - Validation before operations
 * - Logging/auditing after operations
 * - Triggering side effects
 * - Custom business logic injection
 *
 * Usage:
 *   import { hookRegistry, Operations, HookPriorities } from './hooks';
 *
 *   // Register a before hook for wallet creation
 *   hookRegistry.before(Operations.WALLET_CREATE, async (ctx) => {
 *     console.log('Creating wallet:', ctx.payload);
 *     // Optionally modify and return payload
 *     return ctx.payload;
 *   }, { priority: HookPriorities.HIGH, description: 'Log wallet creation' });
 *
 *   // Register an after hook for wallet creation
 *   hookRegistry.after(Operations.WALLET_CREATE, async (ctx) => {
 *     if (ctx.success) {
 *       await sendNotification('Wallet created!');
 *     }
 *   }, { priority: HookPriorities.LOW });
 *
 *   // Wrap an operation with hooks
 *   const wallet = await hookRegistry.wrap(
 *     Operations.WALLET_CREATE,
 *     { name: 'My Wallet' },
 *     async (payload) => createWallet(payload),
 *     { userId: 'user123' }
 *   );
 *
 * Adding new operation types:
 *   1. Add the operation to Operations in types.ts
 *   2. Use hookRegistry.wrap() or manually call executeBefore/executeAfter
 */

import { registerAuditHooks, getHooksSummary } from './defaults';

export { hookRegistry, HookRegistry } from './registry';
export {
  HookPriorities,
  Operations,
} from './types';
export type {
  HookPhase,
  HookHandler,
  HookContext,
  RegisteredHook,
  HookRegistrationOptions,
  HookExecutionResult,
  HookRegistryConfig,
  OperationName,
  HookPriority,
} from './types';

// Re-export helper functions
export { registerAuditHooks, getHooksSummary };

// Auto-register default audit hooks on import
registerAuditHooks();
