/**
 * Default Hooks
 *
 * Provides default hooks for common operations:
 * - Audit logging for all critical operations
 * - Validation checks
 */

import { hookRegistry } from './registry';
import { Operations, HookPriorities } from './types';
import { createLogger } from '../../utils/logger';

const auditLog = createLogger('AUDIT');

/**
 * Register default audit logging hooks
 */
export function registerAuditHooks(): void {
  // Wallet operations - after hooks for audit logging
  hookRegistry.after(
    Operations.WALLET_CREATE,
    (ctx) => {
      auditLog.info('Wallet created', {
        userId: ctx.userId,
        walletName: (ctx.payload as any)?.name,
        walletType: (ctx.payload as any)?.type,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet creation' }
  );

  hookRegistry.after(
    Operations.WALLET_DELETE,
    (ctx) => {
      auditLog.info('Wallet deleted', {
        userId: ctx.userId,
        walletId: (ctx.payload as any)?.walletId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet deletion' }
  );

  hookRegistry.after(
    Operations.WALLET_SHARE,
    (ctx) => {
      auditLog.info('Wallet shared', {
        userId: ctx.userId,
        walletId: (ctx.payload as any)?.walletId,
        sharedWith: (ctx.payload as any)?.targetUserId,
        role: (ctx.payload as any)?.role,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet sharing' }
  );

  // Device operations
  hookRegistry.after(
    Operations.DEVICE_REGISTER,
    (ctx) => {
      auditLog.info('Device registered', {
        userId: ctx.userId,
        deviceName: (ctx.payload as any)?.name,
        deviceType: (ctx.payload as any)?.type,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log device registration' }
  );

  hookRegistry.after(
    Operations.DEVICE_DELETE,
    (ctx) => {
      auditLog.info('Device deleted', {
        userId: ctx.userId,
        deviceId: (ctx.payload as any)?.deviceId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log device deletion' }
  );

  // Transaction operations
  hookRegistry.after(
    Operations.TRANSACTION_BROADCAST,
    (ctx) => {
      auditLog.info('Transaction broadcasted', {
        userId: ctx.userId,
        walletId: (ctx.payload as any)?.walletId,
        txid: ctx.result,
        success: ctx.success,
        error: ctx.error?.message,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log transaction broadcast' }
  );

  hookRegistry.after(
    Operations.TRANSACTION_SIGN,
    (ctx) => {
      auditLog.info('Transaction signed', {
        userId: ctx.userId,
        walletId: (ctx.payload as any)?.walletId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log transaction signing' }
  );

  // Auth operations
  hookRegistry.after(
    Operations.AUTH_LOGIN,
    (ctx) => {
      auditLog.info('User login', {
        userId: ctx.result ? (ctx.result as any).userId : undefined,
        username: (ctx.payload as any)?.username,
        success: ctx.success,
        error: ctx.error ? 'Authentication failed' : undefined,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user login' }
  );

  hookRegistry.after(
    Operations.AUTH_LOGOUT,
    (ctx) => {
      auditLog.info('User logout', {
        userId: ctx.userId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user logout' }
  );

  // User management
  hookRegistry.after(
    Operations.USER_CREATE,
    (ctx) => {
      auditLog.info('User created', {
        createdBy: ctx.userId,
        newUsername: (ctx.payload as any)?.username,
        isAdmin: (ctx.payload as any)?.isAdmin,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user creation' }
  );

  hookRegistry.after(
    Operations.USER_DELETE,
    (ctx) => {
      auditLog.warn('User deleted', {
        deletedBy: ctx.userId,
        deletedUserId: (ctx.payload as any)?.userId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user deletion' }
  );

  // Address operations
  hookRegistry.after(
    Operations.ADDRESS_GENERATE,
    (ctx) => {
      auditLog.debug('Address generated', {
        userId: ctx.userId,
        walletId: (ctx.payload as any)?.walletId,
        address: ctx.result,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.LOW, description: 'Audit log address generation' }
  );
}

/**
 * Get hook summary for admin dashboard
 */
export function getHooksSummary() {
  return hookRegistry.getSummary();
}
