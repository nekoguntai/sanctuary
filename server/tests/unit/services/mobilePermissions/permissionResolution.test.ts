/**
 * Mobile Permission Resolution Tests
 *
 * Tests for the permission resolution logic.
 * Uses mock data to test the calculation functions without database dependency.
 */

import {
  type MobileAction,
  type WalletRole,
  ROLE_CAPABILITIES,
  ACTION_TO_FIELD,
  ALL_MOBILE_ACTIONS,
} from '../../../../src/services/mobilePermissions/types';

/**
 * Mock MobilePermission type for testing
 * Matches the database model structure
 */
interface MockMobilePermission {
  id: string;
  walletId: string;
  userId: string;
  canViewBalance: boolean;
  canViewTransactions: boolean;
  canViewUtxos: boolean;
  canCreateTransaction: boolean;
  canBroadcast: boolean;
  canSignPsbt: boolean;
  canGenerateAddress: boolean;
  canManageLabels: boolean;
  canManageDevices: boolean;
  canShareWallet: boolean;
  canDeleteWallet: boolean;
  ownerMaxPermissions: Record<string, boolean> | null;
}

/**
 * Get the field value from a mobile permission record
 * Copied from service implementation for testing
 */
function getPermissionField(
  permission: MockMobilePermission | null,
  action: MobileAction
): boolean {
  if (!permission) return true; // No record = all enabled (role determines max)

  const field = ACTION_TO_FIELD[action] as keyof MockMobilePermission;
  return permission[field] as boolean;
}

/**
 * Get owner max permission for an action
 * Copied from service implementation for testing
 */
function getOwnerMax(
  permission: MockMobilePermission | null,
  action: MobileAction
): boolean {
  if (!permission?.ownerMaxPermissions) return true;

  const maxPermissions = permission.ownerMaxPermissions;
  return maxPermissions[action] ?? true;
}

/**
 * Calculate effective permission for a single action
 * Copied from service implementation for testing
 */
function calculateEffectivePermission(
  role: WalletRole,
  permission: MockMobilePermission | null,
  action: MobileAction
): boolean {
  // 1. Check role capability (hard limit)
  const roleMax = ROLE_CAPABILITIES[role][action];
  if (!roleMax) return false;

  // 2. No permission record = use role maximum
  if (!permission) return roleMax;

  // 3. Check owner-set maximum
  const ownerMax = getOwnerMax(permission, action);
  if (!ownerMax) return false;

  // 4. Check user's self-set permission
  const userPermission = getPermissionField(permission, action);
  return userPermission && ownerMax;
}

/**
 * Calculate all effective permissions for a user on a wallet
 */
function calculateAllEffectivePermissions(
  role: WalletRole,
  permission: MockMobilePermission | null
): Record<MobileAction, boolean> {
  const result: Record<MobileAction, boolean> = {} as Record<MobileAction, boolean>;

  for (const action of ALL_MOBILE_ACTIONS) {
    result[action] = calculateEffectivePermission(role, permission, action);
  }

  return result;
}

/**
 * Create a default permission record with all enabled
 */
function createDefaultPermission(walletId: string, userId: string): MockMobilePermission {
  return {
    id: 'test-id',
    walletId,
    userId,
    canViewBalance: true,
    canViewTransactions: true,
    canViewUtxos: true,
    canCreateTransaction: true,
    canBroadcast: true,
    canSignPsbt: true,
    canGenerateAddress: true,
    canManageLabels: true,
    canManageDevices: true,
    canShareWallet: true,
    canDeleteWallet: true,
    ownerMaxPermissions: null,
  };
}

describe('Permission Resolution', () => {
  describe('getPermissionField', () => {
    it('should return true when no permission record exists', () => {
      expect(getPermissionField(null, 'viewBalance')).toBe(true);
      expect(getPermissionField(null, 'broadcast')).toBe(true);
    });

    it('should return field value from permission record', () => {
      const permission = createDefaultPermission('wallet-1', 'user-1');
      permission.canBroadcast = false;

      expect(getPermissionField(permission, 'viewBalance')).toBe(true);
      expect(getPermissionField(permission, 'broadcast')).toBe(false);
    });
  });

  describe('getOwnerMax', () => {
    it('should return true when no owner max set', () => {
      const permission = createDefaultPermission('wallet-1', 'user-1');
      expect(getOwnerMax(permission, 'broadcast')).toBe(true);
    });

    it('should return true for unset actions in owner max', () => {
      const permission = createDefaultPermission('wallet-1', 'user-1');
      permission.ownerMaxPermissions = { createTransaction: false };

      expect(getOwnerMax(permission, 'broadcast')).toBe(true);
    });

    it('should return owner max value when set', () => {
      const permission = createDefaultPermission('wallet-1', 'user-1');
      permission.ownerMaxPermissions = {
        broadcast: false,
        createTransaction: false,
      };

      expect(getOwnerMax(permission, 'broadcast')).toBe(false);
      expect(getOwnerMax(permission, 'createTransaction')).toBe(false);
      expect(getOwnerMax(permission, 'viewBalance')).toBe(true);
    });
  });

  describe('calculateEffectivePermission', () => {
    describe('role limits', () => {
      it('should deny actions not allowed by role', () => {
        // Viewer trying to broadcast
        expect(calculateEffectivePermission('viewer', null, 'broadcast')).toBe(false);
        expect(calculateEffectivePermission('viewer', null, 'createTransaction')).toBe(false);

        // Signer trying to manage devices
        expect(calculateEffectivePermission('signer', null, 'manageDevices')).toBe(false);
        expect(calculateEffectivePermission('signer', null, 'shareWallet')).toBe(false);
      });

      it('should allow actions within role capabilities', () => {
        expect(calculateEffectivePermission('viewer', null, 'viewBalance')).toBe(true);
        expect(calculateEffectivePermission('signer', null, 'broadcast')).toBe(true);
        expect(calculateEffectivePermission('owner', null, 'manageDevices')).toBe(true);
      });
    });

    describe('no permission record', () => {
      it('should use role maximum when no permission record', () => {
        // Viewer gets all view permissions
        expect(calculateEffectivePermission('viewer', null, 'viewBalance')).toBe(true);
        expect(calculateEffectivePermission('viewer', null, 'viewTransactions')).toBe(true);

        // Signer gets transaction permissions
        expect(calculateEffectivePermission('signer', null, 'createTransaction')).toBe(true);
        expect(calculateEffectivePermission('signer', null, 'broadcast')).toBe(true);

        // Owner gets all permissions
        expect(calculateEffectivePermission('owner', null, 'manageDevices')).toBe(true);
        expect(calculateEffectivePermission('owner', null, 'deleteWallet')).toBe(true);
      });
    });

    describe('self-set restrictions', () => {
      it('should respect user self-restriction', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');
        permission.canBroadcast = false;

        // Owner restricted themselves from broadcasting
        expect(calculateEffectivePermission('owner', permission, 'broadcast')).toBe(false);
        // Other permissions still work
        expect(calculateEffectivePermission('owner', permission, 'createTransaction')).toBe(true);
      });

      it('should not grant more than role allows even if enabled', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');
        permission.canBroadcast = true;

        // Viewer cannot broadcast even if permission record says true
        expect(calculateEffectivePermission('viewer', permission, 'broadcast')).toBe(false);
      });
    });

    describe('owner max restrictions', () => {
      it('should respect owner-set caps', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');
        permission.ownerMaxPermissions = {
          broadcast: false,
          createTransaction: false,
        };

        // Signer cannot broadcast even though role allows it
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(false);
        expect(calculateEffectivePermission('signer', permission, 'createTransaction')).toBe(false);
        // Can still do other things
        expect(calculateEffectivePermission('signer', permission, 'signPsbt')).toBe(true);
      });

      it('should combine owner max with user self-restriction', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');
        permission.ownerMaxPermissions = { broadcast: true };
        permission.canBroadcast = false;

        // User self-restricted broadcast
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(false);
      });

      it('should deny if owner max denies regardless of user setting', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');
        permission.ownerMaxPermissions = { broadcast: false };
        permission.canBroadcast = true; // User tried to enable it

        // Owner max takes precedence
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(false);
      });
    });

    describe('full permission resolution chain', () => {
      it('should apply MIN(role, ownerMax, userPermission)', () => {
        const permission = createDefaultPermission('wallet-1', 'user-1');

        // All allow: signer can broadcast, owner max allows, user allows
        permission.ownerMaxPermissions = { broadcast: true };
        permission.canBroadcast = true;
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(true);

        // Role denies: viewer cannot broadcast
        expect(calculateEffectivePermission('viewer', permission, 'broadcast')).toBe(false);

        // Owner max denies
        permission.ownerMaxPermissions = { broadcast: false };
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(false);

        // User self-denies
        permission.ownerMaxPermissions = { broadcast: true };
        permission.canBroadcast = false;
        expect(calculateEffectivePermission('signer', permission, 'broadcast')).toBe(false);
      });
    });
  });

  describe('calculateAllEffectivePermissions', () => {
    it('should calculate all permissions for viewer', () => {
      const permissions = calculateAllEffectivePermissions('viewer', null);

      expect(permissions.viewBalance).toBe(true);
      expect(permissions.viewTransactions).toBe(true);
      expect(permissions.viewUtxos).toBe(true);
      expect(permissions.broadcast).toBe(false);
      expect(permissions.createTransaction).toBe(false);
    });

    it('should calculate all permissions for signer', () => {
      const permissions = calculateAllEffectivePermissions('signer', null);

      expect(permissions.viewBalance).toBe(true);
      expect(permissions.broadcast).toBe(true);
      expect(permissions.createTransaction).toBe(true);
      expect(permissions.manageDevices).toBe(false);
    });

    it('should calculate all permissions for owner', () => {
      const permissions = calculateAllEffectivePermissions('owner', null);

      ALL_MOBILE_ACTIONS.forEach((action) => {
        expect(permissions[action]).toBe(true);
      });
    });

    it('should apply restrictions from permission record', () => {
      const permission = createDefaultPermission('wallet-1', 'user-1');
      permission.canBroadcast = false;
      permission.ownerMaxPermissions = { createTransaction: false };

      const permissions = calculateAllEffectivePermissions('owner', permission);

      expect(permissions.broadcast).toBe(false);
      expect(permissions.createTransaction).toBe(false);
      expect(permissions.viewBalance).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle new user with no restrictions', () => {
      // New user with signer role, no permission record
      const permissions = calculateAllEffectivePermissions('signer', null);

      expect(permissions.viewBalance).toBe(true);
      expect(permissions.createTransaction).toBe(true);
      expect(permissions.broadcast).toBe(true);
      expect(permissions.manageDevices).toBe(false);
    });

    it('should handle user who self-restricted for security', () => {
      // User disabled mobile broadcasting for security
      const permission = createDefaultPermission('wallet-1', 'user-1');
      permission.canBroadcast = false;

      const permissions = calculateAllEffectivePermissions('signer', permission);

      expect(permissions.createTransaction).toBe(true);
      expect(permissions.broadcast).toBe(false);
    });

    it('should handle owner restricting employee access', () => {
      // Owner wants employee (signer) to only view, not transact
      const permission = createDefaultPermission('wallet-1', 'employee-1');
      permission.ownerMaxPermissions = {
        createTransaction: false,
        broadcast: false,
        signPsbt: false,
      };

      const permissions = calculateAllEffectivePermissions('signer', permission);

      expect(permissions.viewBalance).toBe(true);
      expect(permissions.viewTransactions).toBe(true);
      expect(permissions.createTransaction).toBe(false);
      expect(permissions.broadcast).toBe(false);
      expect(permissions.signPsbt).toBe(false);
      expect(permissions.generateAddress).toBe(true);
    });

    it('should handle viewer trying to exceed role', () => {
      // Viewer with all permissions enabled (shouldn't grant more)
      const permission = createDefaultPermission('wallet-1', 'viewer-1');

      const permissions = calculateAllEffectivePermissions('viewer', permission);

      // Still limited by viewer role
      expect(permissions.viewBalance).toBe(true);
      expect(permissions.broadcast).toBe(false);
      expect(permissions.createTransaction).toBe(false);
    });
  });
});
