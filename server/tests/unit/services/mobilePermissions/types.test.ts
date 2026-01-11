/**
 * Mobile Permissions Types Tests
 *
 * Tests for mobile permissions type definitions and constants.
 * These tests verify the permission resolution logic without requiring a database.
 */

import {
  type MobileAction,
  type WalletRole,
  ROLE_CAPABILITIES,
  ACTION_TO_FIELD,
  ALL_MOBILE_ACTIONS,
} from '../../../../src/services/mobilePermissions/types';

describe('Mobile Permissions Types', () => {
  describe('ALL_MOBILE_ACTIONS', () => {
    it('should contain all 11 mobile actions', () => {
      expect(ALL_MOBILE_ACTIONS).toHaveLength(11);
    });

    it('should contain expected actions', () => {
      const expectedActions: MobileAction[] = [
        'viewBalance',
        'viewTransactions',
        'viewUtxos',
        'createTransaction',
        'broadcast',
        'signPsbt',
        'generateAddress',
        'manageLabels',
        'manageDevices',
        'shareWallet',
        'deleteWallet',
      ];

      expectedActions.forEach((action) => {
        expect(ALL_MOBILE_ACTIONS).toContain(action);
      });
    });
  });

  describe('ACTION_TO_FIELD', () => {
    it('should map all actions to database fields', () => {
      ALL_MOBILE_ACTIONS.forEach((action) => {
        expect(ACTION_TO_FIELD[action]).toBeDefined();
        expect(ACTION_TO_FIELD[action]).toMatch(/^can[A-Z]/);
      });
    });

    it('should have correct field mappings', () => {
      expect(ACTION_TO_FIELD.viewBalance).toBe('canViewBalance');
      expect(ACTION_TO_FIELD.viewTransactions).toBe('canViewTransactions');
      expect(ACTION_TO_FIELD.viewUtxos).toBe('canViewUtxos');
      expect(ACTION_TO_FIELD.createTransaction).toBe('canCreateTransaction');
      expect(ACTION_TO_FIELD.broadcast).toBe('canBroadcast');
      expect(ACTION_TO_FIELD.signPsbt).toBe('canSignPsbt');
      expect(ACTION_TO_FIELD.generateAddress).toBe('canGenerateAddress');
      expect(ACTION_TO_FIELD.manageLabels).toBe('canManageLabels');
      expect(ACTION_TO_FIELD.manageDevices).toBe('canManageDevices');
      expect(ACTION_TO_FIELD.shareWallet).toBe('canShareWallet');
      expect(ACTION_TO_FIELD.deleteWallet).toBe('canDeleteWallet');
    });
  });

  describe('ROLE_CAPABILITIES', () => {
    describe('viewer role', () => {
      const viewerCaps = ROLE_CAPABILITIES.viewer;

      it('should allow view-only actions', () => {
        expect(viewerCaps.viewBalance).toBe(true);
        expect(viewerCaps.viewTransactions).toBe(true);
        expect(viewerCaps.viewUtxos).toBe(true);
      });

      it('should deny transaction actions', () => {
        expect(viewerCaps.createTransaction).toBe(false);
        expect(viewerCaps.broadcast).toBe(false);
        expect(viewerCaps.signPsbt).toBe(false);
      });

      it('should deny all other actions', () => {
        expect(viewerCaps.generateAddress).toBe(false);
        expect(viewerCaps.manageLabels).toBe(false);
        expect(viewerCaps.manageDevices).toBe(false);
        expect(viewerCaps.shareWallet).toBe(false);
        expect(viewerCaps.deleteWallet).toBe(false);
      });
    });

    describe('signer role', () => {
      const signerCaps = ROLE_CAPABILITIES.signer;

      it('should allow all view actions', () => {
        expect(signerCaps.viewBalance).toBe(true);
        expect(signerCaps.viewTransactions).toBe(true);
        expect(signerCaps.viewUtxos).toBe(true);
      });

      it('should allow transaction actions', () => {
        expect(signerCaps.createTransaction).toBe(true);
        expect(signerCaps.broadcast).toBe(true);
        expect(signerCaps.signPsbt).toBe(true);
      });

      it('should allow address generation and labels', () => {
        expect(signerCaps.generateAddress).toBe(true);
        expect(signerCaps.manageLabels).toBe(true);
      });

      it('should deny administrative actions', () => {
        expect(signerCaps.manageDevices).toBe(false);
        expect(signerCaps.shareWallet).toBe(false);
        expect(signerCaps.deleteWallet).toBe(false);
      });
    });

    describe('owner role', () => {
      const ownerCaps = ROLE_CAPABILITIES.owner;

      it('should allow all actions', () => {
        ALL_MOBILE_ACTIONS.forEach((action) => {
          expect(ownerCaps[action]).toBe(true);
        });
      });
    });

    it('should have capabilities for all roles', () => {
      const roles: WalletRole[] = ['viewer', 'signer', 'owner'];
      roles.forEach((role) => {
        expect(ROLE_CAPABILITIES[role]).toBeDefined();
      });
    });

    it('should define all actions for each role', () => {
      const roles: WalletRole[] = ['viewer', 'signer', 'owner'];
      roles.forEach((role) => {
        ALL_MOBILE_ACTIONS.forEach((action) => {
          expect(typeof ROLE_CAPABILITIES[role][action]).toBe('boolean');
        });
      });
    });
  });

  describe('Permission hierarchy', () => {
    it('should have owner with more permissions than signer', () => {
      const ownerTrue = ALL_MOBILE_ACTIONS.filter(
        (action) => ROLE_CAPABILITIES.owner[action]
      ).length;
      const signerTrue = ALL_MOBILE_ACTIONS.filter(
        (action) => ROLE_CAPABILITIES.signer[action]
      ).length;

      expect(ownerTrue).toBeGreaterThan(signerTrue);
    });

    it('should have signer with more permissions than viewer', () => {
      const signerTrue = ALL_MOBILE_ACTIONS.filter(
        (action) => ROLE_CAPABILITIES.signer[action]
      ).length;
      const viewerTrue = ALL_MOBILE_ACTIONS.filter(
        (action) => ROLE_CAPABILITIES.viewer[action]
      ).length;

      expect(signerTrue).toBeGreaterThan(viewerTrue);
    });

    it('should have viewer only allowed view actions', () => {
      const viewerActions = ALL_MOBILE_ACTIONS.filter(
        (action) => ROLE_CAPABILITIES.viewer[action]
      );

      viewerActions.forEach((action) => {
        expect(action).toMatch(/^view/);
      });
    });

    it('should have consistent permission escalation', () => {
      // If a viewer can do something, signer and owner can too
      ALL_MOBILE_ACTIONS.forEach((action) => {
        if (ROLE_CAPABILITIES.viewer[action]) {
          expect(ROLE_CAPABILITIES.signer[action]).toBe(true);
          expect(ROLE_CAPABILITIES.owner[action]).toBe(true);
        }
      });

      // If a signer can do something, owner can too
      ALL_MOBILE_ACTIONS.forEach((action) => {
        if (ROLE_CAPABILITIES.signer[action]) {
          expect(ROLE_CAPABILITIES.owner[action]).toBe(true);
        }
      });
    });
  });
});
