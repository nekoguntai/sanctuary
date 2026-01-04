/**
 * Hooks Defaults Tests
 *
 * Tests for the default audit logging hooks.
 */

import { HookRegistry } from '../../../../src/services/hooks/registry';
import { Operations } from '../../../../src/services/hooks/types';

// Mock the logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
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
