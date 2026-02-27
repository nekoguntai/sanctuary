/**
 * Default Hooks
 *
 * Provides default hooks for common operations:
 * - Audit logging for all critical operations
 * - Validation checks
 */

import { hookRegistry } from './registry';
import {
  Operations, HookPriorities,
  type WalletCreatePayload, type WalletDeletePayload, type WalletSharePayload,
  type DeviceRegisterPayload, type DeviceDeletePayload,
  type TransactionBroadcastPayload, type TransactionSignPayload,
  type AuthLoginPayload, type UserCreatePayload, type UserDeletePayload,
  type AddressGeneratePayload,
} from './types';
import { createLogger } from '../../utils/logger';

const auditLog = createLogger('AUDIT');

/**
 * Register default audit logging hooks
 */
export function registerAuditHooks(): void {
  // Wallet operations - after hooks for audit logging
  hookRegistry.after<WalletCreatePayload>(
    Operations.WALLET_CREATE,
    (ctx) => {
      auditLog.info('Wallet created', {
        userId: ctx.userId,
        walletName: ctx.payload.name,
        walletType: ctx.payload.type,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet creation' }
  );

  hookRegistry.after<WalletDeletePayload>(
    Operations.WALLET_DELETE,
    (ctx) => {
      auditLog.info('Wallet deleted', {
        userId: ctx.userId,
        walletId: ctx.payload.walletId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet deletion' }
  );

  hookRegistry.after<WalletSharePayload>(
    Operations.WALLET_SHARE,
    (ctx) => {
      auditLog.info('Wallet shared', {
        userId: ctx.userId,
        walletId: ctx.payload.walletId,
        sharedWith: ctx.payload.targetUserId,
        role: ctx.payload.role,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log wallet sharing' }
  );

  // Device operations
  hookRegistry.after<DeviceRegisterPayload>(
    Operations.DEVICE_REGISTER,
    (ctx) => {
      auditLog.info('Device registered', {
        userId: ctx.userId,
        deviceName: ctx.payload.name,
        deviceType: ctx.payload.type,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log device registration' }
  );

  hookRegistry.after<DeviceDeletePayload>(
    Operations.DEVICE_DELETE,
    (ctx) => {
      auditLog.info('Device deleted', {
        userId: ctx.userId,
        deviceId: ctx.payload.deviceId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log device deletion' }
  );

  // Transaction operations
  hookRegistry.after<TransactionBroadcastPayload>(
    Operations.TRANSACTION_BROADCAST,
    (ctx) => {
      auditLog.info('Transaction broadcasted', {
        userId: ctx.userId,
        walletId: ctx.payload.walletId,
        txid: ctx.result,
        success: ctx.success,
        error: ctx.error?.message,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log transaction broadcast' }
  );

  hookRegistry.after<TransactionSignPayload>(
    Operations.TRANSACTION_SIGN,
    (ctx) => {
      auditLog.info('Transaction signed', {
        userId: ctx.userId,
        walletId: ctx.payload.walletId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log transaction signing' }
  );

  // Auth operations
  hookRegistry.after<AuthLoginPayload>(
    Operations.AUTH_LOGIN,
    (ctx) => {
      const result = ctx.result as { userId?: string } | undefined;
      auditLog.info('User login', {
        userId: result?.userId,
        username: ctx.payload.username,
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
  hookRegistry.after<UserCreatePayload>(
    Operations.USER_CREATE,
    (ctx) => {
      auditLog.info('User created', {
        createdBy: ctx.userId,
        newUsername: ctx.payload.username,
        isAdmin: ctx.payload.isAdmin,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user creation' }
  );

  hookRegistry.after<UserDeletePayload>(
    Operations.USER_DELETE,
    (ctx) => {
      auditLog.warn('User deleted', {
        deletedBy: ctx.userId,
        deletedUserId: ctx.payload.userId,
        success: ctx.success,
      });
    },
    { priority: HookPriorities.HIGH, description: 'Audit log user deletion' }
  );

  // Address operations
  hookRegistry.after<AddressGeneratePayload>(
    Operations.ADDRESS_GENERATE,
    (ctx) => {
      auditLog.debug('Address generated', {
        userId: ctx.userId,
        walletId: ctx.payload.walletId,
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
