import { vi } from 'vitest';
/**
 * Hooks Defaults Tests
 *
 * Tests for the default audit logging hooks.
 */

import { HookRegistry } from '../../../../src/services/hooks/registry';
import { Operations } from '../../../../src/services/hooks/types';

// Mock the logger
const auditLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => auditLogger,
}));

// Import after mocks are set up
import { registerAuditHooks, getHooksSummary } from '../../../../src/services/hooks/defaults';
import { hookRegistry } from '../../../../src/services/hooks/registry';

describe('Hooks Defaults', () => {
  beforeEach(() => {
    // Clear the registry before each test
    hookRegistry.clear();
  });

  describe('registerAuditHooks', () => {
    it('should register audit hooks for wallet operations', () => {
      registerAuditHooks();

      // Check wallet create hook is registered
      const walletCreateHooks = hookRegistry.getHooks(Operations.WALLET_CREATE, 'after');
      expect(walletCreateHooks.length).toBeGreaterThan(0);

      // Check wallet delete hook is registered
      const walletDeleteHooks = hookRegistry.getHooks(Operations.WALLET_DELETE, 'after');
      expect(walletDeleteHooks.length).toBeGreaterThan(0);

      // Check wallet share hook is registered
      const walletShareHooks = hookRegistry.getHooks(Operations.WALLET_SHARE, 'after');
      expect(walletShareHooks.length).toBeGreaterThan(0);
    });

    it('should register audit hooks for device operations', () => {
      registerAuditHooks();

      const deviceRegisterHooks = hookRegistry.getHooks(Operations.DEVICE_REGISTER, 'after');
      expect(deviceRegisterHooks.length).toBeGreaterThan(0);

      const deviceDeleteHooks = hookRegistry.getHooks(Operations.DEVICE_DELETE, 'after');
      expect(deviceDeleteHooks.length).toBeGreaterThan(0);
    });

    it('should register audit hooks for transaction operations', () => {
      registerAuditHooks();

      const txBroadcastHooks = hookRegistry.getHooks(Operations.TRANSACTION_BROADCAST, 'after');
      expect(txBroadcastHooks.length).toBeGreaterThan(0);

      const txSignHooks = hookRegistry.getHooks(Operations.TRANSACTION_SIGN, 'after');
      expect(txSignHooks.length).toBeGreaterThan(0);
    });

    it('should register audit hooks for auth operations', () => {
      registerAuditHooks();

      const loginHooks = hookRegistry.getHooks(Operations.AUTH_LOGIN, 'after');
      expect(loginHooks.length).toBeGreaterThan(0);

      const logoutHooks = hookRegistry.getHooks(Operations.AUTH_LOGOUT, 'after');
      expect(logoutHooks.length).toBeGreaterThan(0);
    });

    it('should register audit hooks for user operations', () => {
      registerAuditHooks();

      const userCreateHooks = hookRegistry.getHooks(Operations.USER_CREATE, 'after');
      expect(userCreateHooks.length).toBeGreaterThan(0);

      const userDeleteHooks = hookRegistry.getHooks(Operations.USER_DELETE, 'after');
      expect(userDeleteHooks.length).toBeGreaterThan(0);
    });

    it('should register audit hook for address generation', () => {
      registerAuditHooks();

      const addressHooks = hookRegistry.getHooks(Operations.ADDRESS_GENERATE, 'after');
      expect(addressHooks.length).toBeGreaterThan(0);
    });

    it('should set hooks with appropriate descriptions', () => {
      registerAuditHooks();

      const hooks = hookRegistry.getHooks(Operations.WALLET_CREATE, 'after');
      expect(hooks[0].description).toContain('Audit log');
    });

    it('should execute audit hooks and write expected log entries', async () => {
      registerAuditHooks();

      await hookRegistry.getHooks(Operations.WALLET_CREATE, 'after')[0].handler({
        operation: Operations.WALLET_CREATE,
        phase: 'after',
        payload: { name: 'Wallet A', type: 'single' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.WALLET_DELETE, 'after')[0].handler({
        operation: Operations.WALLET_DELETE,
        phase: 'after',
        payload: { walletId: 'w1' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.WALLET_SHARE, 'after')[0].handler({
        operation: Operations.WALLET_SHARE,
        phase: 'after',
        payload: { walletId: 'w1', targetUserId: 'u2', role: 'viewer' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.DEVICE_REGISTER, 'after')[0].handler({
        operation: Operations.DEVICE_REGISTER,
        phase: 'after',
        payload: { name: 'Phone', type: 'ios' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.DEVICE_DELETE, 'after')[0].handler({
        operation: Operations.DEVICE_DELETE,
        phase: 'after',
        payload: { deviceId: 'd1' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.TRANSACTION_BROADCAST, 'after')[0].handler({
        operation: Operations.TRANSACTION_BROADCAST,
        phase: 'after',
        payload: { walletId: 'w1' },
        userId: 'u1',
        success: true,
        result: 'txid-1',
      } as any);

      await hookRegistry.getHooks(Operations.TRANSACTION_SIGN, 'after')[0].handler({
        operation: Operations.TRANSACTION_SIGN,
        phase: 'after',
        payload: { walletId: 'w1' },
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.AUTH_LOGIN, 'after')[0].handler({
        operation: Operations.AUTH_LOGIN,
        phase: 'after',
        payload: { username: 'alice' },
        result: { userId: 'u1' },
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.AUTH_LOGOUT, 'after')[0].handler({
        operation: Operations.AUTH_LOGOUT,
        phase: 'after',
        payload: {},
        userId: 'u1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.USER_CREATE, 'after')[0].handler({
        operation: Operations.USER_CREATE,
        phase: 'after',
        payload: { username: 'bob', isAdmin: false },
        userId: 'admin-1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.USER_DELETE, 'after')[0].handler({
        operation: Operations.USER_DELETE,
        phase: 'after',
        payload: { userId: 'u2' },
        userId: 'admin-1',
        success: true,
      } as any);

      await hookRegistry.getHooks(Operations.ADDRESS_GENERATE, 'after')[0].handler({
        operation: Operations.ADDRESS_GENERATE,
        phase: 'after',
        payload: { walletId: 'w1' },
        userId: 'u1',
        success: true,
        result: 'bc1qexample',
      } as any);

      expect(auditLogger.info).toHaveBeenCalledWith('Wallet created', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Wallet deleted', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Wallet shared', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Device registered', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Device deleted', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Transaction broadcasted', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('Transaction signed', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('User login', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('User logout', expect.any(Object));
      expect(auditLogger.info).toHaveBeenCalledWith('User created', expect.any(Object));
      expect(auditLogger.warn).toHaveBeenCalledWith('User deleted', expect.any(Object));
      expect(auditLogger.debug).toHaveBeenCalledWith('Address generated', expect.any(Object));
    });

    it('should mark failed login attempts in audit logs', async () => {
      registerAuditHooks();

      await hookRegistry.getHooks(Operations.AUTH_LOGIN, 'after')[0].handler({
        operation: Operations.AUTH_LOGIN,
        phase: 'after',
        payload: { username: 'alice' },
        result: undefined,
        success: false,
        error: new Error('invalid credentials'),
      } as any);

      expect(auditLogger.info).toHaveBeenCalledWith(
        'User login',
        expect.objectContaining({
          username: 'alice',
          success: false,
          error: 'Authentication failed',
        })
      );
    });
  });

  describe('getHooksSummary', () => {
    it('should return registry summary', () => {
      registerAuditHooks();

      const summary = getHooksSummary();

      expect(summary).toHaveProperty('totalHooks');
      expect(summary).toHaveProperty('operations');
      expect(summary.totalHooks).toBeGreaterThan(0);
      expect(Array.isArray(summary.operations)).toBe(true);
    });

    it('should include operation details in summary', () => {
      registerAuditHooks();

      const summary = getHooksSummary();

      // Find the wallet:create operation
      const walletCreateOp = summary.operations.find(
        (op: any) => op.operation === 'wallet:create'
      );

      expect(walletCreateOp).toBeDefined();
      expect(walletCreateOp!.after).toBeGreaterThan(0);
    });
  });
});
