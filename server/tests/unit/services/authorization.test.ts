import { vi } from 'vitest';
/**
 * Authorization Service Tests
 *
 * Comprehensive tests for policy-based access control, role resolution,
 * and permission checking across wallets, devices, and groups.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  authorizationService,
  type Role,
  type ResourceType,
  type Action,
} from '../../../src/services/authorization';
import { ForbiddenError, UnauthorizedError } from '../../../src/errors';

describe('Authorization Service', () => {
  beforeEach(async () => {
    resetPrismaMocks();
    vi.clearAllMocks();
    // Clear authorization cache between tests
    await authorizationService.clearCache();
  });

  // ===========================================================================
  // Role Resolution Tests
  // ===========================================================================

  describe('getRole', () => {
    describe('admin users', () => {
      it('should return admin role for admin users on any resource', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'admin-user',
          isAdmin: true,
        });

        const role = await authorizationService.getRole('admin-user', 'wallet', 'any-wallet');
        expect(role).toBe('admin');
      });

      it('should return admin role for admin users on system resources', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'admin-user',
          isAdmin: true,
        });

        const role = await authorizationService.getRole('admin-user', 'system', 'config');
        expect(role).toBe('admin');
      });
    });

    describe('wallet roles', () => {
      beforeEach(() => {
        // Non-admin user
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'user-1',
          isAdmin: false,
        });
      });

      it('should return owner role for wallet owner', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'owner',
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('owner');
      });

      it('should return signer role for wallet signer', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'signer',
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('signer');
      });

      it('should return viewer role for wallet viewer', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'viewer',
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('viewer');
      });

      it('should return signer role for group owner accessing wallet', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          groupId: 'group-1',
          group: {
            members: [{
              userId: 'user-1',
              role: 'owner',
            }],
          },
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('signer');
      });

      it('should return viewer role for group member accessing wallet', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          groupId: 'group-1',
          group: {
            members: [{
              userId: 'user-1',
              role: 'member',
            }],
          },
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('viewer');
      });

      it('should return none for user with no wallet access', async () => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          groupId: null,
          group: null,
        });

        const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
        expect(role).toBe('none');
      });
    });

    describe('device roles', () => {
      beforeEach(() => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'user-1',
          isAdmin: false,
        });
      });

      it('should return owner role for device owner', async () => {
        mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
          deviceId: 'device-1',
          userId: 'user-1',
          role: 'owner',
        });

        const role = await authorizationService.getRole('user-1', 'device', 'device-1');
        expect(role).toBe('owner');
      });

      it('should return viewer role for device viewer', async () => {
        mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
          deviceId: 'device-1',
          userId: 'user-1',
          role: 'viewer',
        });

        const role = await authorizationService.getRole('user-1', 'device', 'device-1');
        expect(role).toBe('viewer');
      });

      it('should return none for user with no device access', async () => {
        mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

        const role = await authorizationService.getRole('user-1', 'device', 'device-1');
        expect(role).toBe('none');
      });
    });

    describe('group roles', () => {
      beforeEach(() => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'user-1',
          isAdmin: false,
        });
      });

      it('should return owner role for group owner', async () => {
        mockPrismaClient.groupMember.findFirst.mockResolvedValue({
          groupId: 'group-1',
          userId: 'user-1',
          role: 'owner',
        });

        const role = await authorizationService.getRole('user-1', 'group', 'group-1');
        expect(role).toBe('owner');
      });

      it('should return viewer role for group member', async () => {
        mockPrismaClient.groupMember.findFirst.mockResolvedValue({
          groupId: 'group-1',
          userId: 'user-1',
          role: 'member',
        });

        const role = await authorizationService.getRole('user-1', 'group', 'group-1');
        expect(role).toBe('viewer');
      });

      it('should return none for non-member', async () => {
        mockPrismaClient.groupMember.findFirst.mockResolvedValue(null);

        const role = await authorizationService.getRole('user-1', 'group', 'group-1');
        expect(role).toBe('none');
      });
    });

    describe('user resource roles', () => {
      beforeEach(() => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'user-1',
          isAdmin: false,
        });
      });

      it('should return owner for user accessing their own resource', async () => {
        const role = await authorizationService.getRole('user-1', 'user', 'user-1');
        expect(role).toBe('owner');
      });

      it('should return none for user accessing other user resource', async () => {
        const role = await authorizationService.getRole('user-1', 'user', 'user-2');
        expect(role).toBe('none');
      });
    });

    describe('system resource roles', () => {
      it('should return none for non-admin on system resource', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'user-1',
          isAdmin: false,
        });

        const role = await authorizationService.getRole('user-1', 'system', 'config');
        expect(role).toBe('none');
      });
    });
  });

  // ===========================================================================
  // Permission Check Tests
  // ===========================================================================

  describe('can', () => {
    describe('wallet permissions', () => {
      it('should allow owner to delete wallet', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'owner',
        });

        const decision = await authorizationService.can('user-1', 'delete', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(true);
        expect(decision.role).toBe('owner');
      });

      it('should deny signer from deleting wallet', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'signer',
        });

        const decision = await authorizationService.can('user-1', 'delete', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(false);
        expect(decision.role).toBe('signer');
        expect(decision.reason).toContain('signer');
        expect(decision.reason).toContain('delete');
      });

      it('should allow signer to edit wallet', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'signer',
        });

        const decision = await authorizationService.can('user-1', 'edit', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(true);
      });

      it('should allow viewer to view wallet', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'viewer',
        });

        const decision = await authorizationService.can('user-1', 'view', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(true);
      });

      it('should deny viewer from editing wallet', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({
          walletId: 'wallet-1',
          userId: 'user-1',
          role: 'viewer',
        });

        const decision = await authorizationService.can('user-1', 'edit', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(false);
      });

      it('should deny user with no access', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
        mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: 'wallet-1', groupId: null });

        const decision = await authorizationService.can('user-1', 'view', 'wallet', 'wallet-1');
        expect(decision.allowed).toBe(false);
        expect(decision.role).toBe('none');
      });
    });

    describe('device permissions', () => {
      it('should allow owner to delete device', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
          deviceId: 'device-1',
          userId: 'user-1',
          role: 'owner',
        });

        const decision = await authorizationService.can('user-1', 'delete', 'device', 'device-1');
        expect(decision.allowed).toBe(true);
      });

      it('should deny viewer from deleting device', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
        mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
          deviceId: 'device-1',
          userId: 'user-1',
          role: 'viewer',
        });

        const decision = await authorizationService.can('user-1', 'delete', 'device', 'device-1');
        expect(decision.allowed).toBe(false);
      });
    });

    describe('admin override', () => {
      it('should allow admin to perform any action on any resource', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'admin-1', isAdmin: true });

        const decisions = await Promise.all([
          authorizationService.can('admin-1', 'delete', 'wallet', 'wallet-1'),
          authorizationService.can('admin-1', 'admin', 'system', 'config'),
          authorizationService.can('admin-1', 'delete', 'user', 'user-2'),
        ]);

        expect(decisions.every(d => d.allowed)).toBe(true);
        expect(decisions.every(d => d.role === 'admin')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Assert Methods Tests
  // ===========================================================================

  describe('assertCan', () => {
    it('should return role when permission is granted', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      const role = await authorizationService.assertCan('user-1', 'delete', 'wallet', 'wallet-1');
      expect(role).toBe('owner');
    });

    it('should throw ForbiddenError when permission is denied', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      await expect(
        authorizationService.assertCan('user-1', 'delete', 'wallet', 'wallet-1')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should include details in ForbiddenError', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      try {
        await authorizationService.assertCan('user-1', 'delete', 'wallet', 'wallet-1');
        fail('Expected ForbiddenError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        const forbiddenError = error as ForbiddenError;
        expect(forbiddenError.details).toEqual({
          resource: 'wallet',
          resourceId: 'wallet-1',
          action: 'delete',
          role: 'viewer',
        });
      }
    });
  });

  describe('hasRole', () => {
    it('should return true when user has at least required role', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      const hasViewer = await authorizationService.hasRole('user-1', 'wallet', 'wallet-1', 'viewer');
      const hasSigner = await authorizationService.hasRole('user-1', 'wallet', 'wallet-1', 'signer');
      const hasOwner = await authorizationService.hasRole('user-1', 'wallet', 'wallet-1', 'owner');

      expect(hasViewer).toBe(true);
      expect(hasSigner).toBe(true);
      expect(hasOwner).toBe(true);
    });

    it('should return false when user has lower role', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      const hasOwner = await authorizationService.hasRole('user-1', 'wallet', 'wallet-1', 'owner');
      const hasSigner = await authorizationService.hasRole('user-1', 'wallet', 'wallet-1', 'signer');

      expect(hasOwner).toBe(false);
      expect(hasSigner).toBe(false);
    });
  });

  describe('assertRole', () => {
    it('should return role when user has sufficient role', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      const role = await authorizationService.assertRole('user-1', 'wallet', 'wallet-1', 'signer');
      expect(role).toBe('owner');
    });

    it('should throw ForbiddenError when user has insufficient role', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      await expect(
        authorizationService.assertRole('user-1', 'wallet', 'wallet-1', 'owner')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('assertAuthenticated', () => {
    it('should not throw when userId is provided', () => {
      expect(() => {
        authorizationService.assertAuthenticated('user-1');
      }).not.toThrow();
    });

    it('should throw UnauthorizedError when userId is undefined', () => {
      expect(() => {
        authorizationService.assertAuthenticated(undefined);
      }).toThrow(UnauthorizedError);
    });
  });

  // ===========================================================================
  // Policy Management Tests
  // ===========================================================================

  describe('policy management', () => {
    it('should register custom policy', () => {
      const initialPolicies = authorizationService.getPolicies();
      const initialCount = initialPolicies.length;

      authorizationService.registerPolicy({
        resource: 'wallet',
        action: 'admin',
        allowedRoles: ['admin'],
      });

      const updatedPolicies = authorizationService.getPolicies();
      expect(updatedPolicies.length).toBe(initialCount + 1);
    });

    it('should return all registered policies', () => {
      const policies = authorizationService.getPolicies();
      expect(Array.isArray(policies)).toBe(true);
      expect(policies.length).toBeGreaterThan(0);
      expect(policies[0]).toHaveProperty('resource');
      expect(policies[0]).toHaveProperty('action');
      expect(policies[0]).toHaveProperty('allowedRoles');
    });
  });

  // ===========================================================================
  // Caching Tests
  // ===========================================================================

  describe('caching', () => {
    it('should cache role lookups', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      // First call hits DB
      const role1 = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(role1).toBe('owner');
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(1);

      // Second call should use cache, not hit DB again
      const role2 = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(role2).toBe('owner');
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should cache admin status', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'admin-1', isAdmin: true });

      // First call checks admin status
      const role1 = await authorizationService.getRole('admin-1', 'wallet', 'wallet-1');
      expect(role1).toBe('admin');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);

      // Second call should use cached admin status
      const role2 = await authorizationService.getRole('admin-1', 'wallet', 'wallet-2');
      expect(role2).toBe('admin');
      // Still only 1 call because admin status is cached
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should invalidate role cache for specific resource', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      // Populate cache
      await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(1);

      // Invalidate cache
      await authorizationService.invalidateRole('user-1', 'wallet', 'wallet-1');

      // Update mock to return different role
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      // Next call should hit DB again
      const role = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(role).toBe('viewer');
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all user roles', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        deviceId: 'device-1',
        userId: 'user-1',
        role: 'owner',
      });

      // Populate cache for multiple resources
      await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      await authorizationService.getRole('user-1', 'device', 'device-1');

      // Invalidate all user roles
      await authorizationService.invalidateUserRoles('user-1');

      // Update mocks
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'viewer',
      });

      // Next calls should hit DB again
      const walletRole = await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(walletRole).toBe('viewer');
    });

    it('should clear all caches', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1', isAdmin: false });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        walletId: 'wallet-1',
        userId: 'user-1',
        role: 'owner',
      });

      // Populate cache
      await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      const callCount1 = mockPrismaClient.walletUser.findFirst.mock.calls.length;

      // Clear all caches
      await authorizationService.clearCache();

      // Next call should hit DB again
      await authorizationService.getRole('user-1', 'wallet', 'wallet-1');
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(callCount1 + 1);
    });
  });
});
