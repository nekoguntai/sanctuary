/**
 * Vault Policy Service Tests
 *
 * Tests policy CRUD, validation, and inheritance resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findPoliciesByWalletId: vi.fn(),
    findAllPoliciesForWallet: vi.fn(),
    findSystemPolicies: vi.fn(),
    findGroupPolicies: vi.fn(),
    findPolicyById: vi.fn(),
    findPolicyByIdInWallet: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    removePolicy: vi.fn(),
    countPoliciesByWalletId: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

// Mock the policy repository
vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

import {
  vaultPolicyService,
} from '../../../src/services/vaultPolicy/vaultPolicyService';
import type {
  CreatePolicyInput,
  UpdatePolicyInput,
} from '../../../src/services/vaultPolicy/types';

describe('VaultPolicyService', () => {
  const userId = faker.string.uuid();
  const walletId = faker.string.uuid();
  const groupId = faker.string.uuid();
  const policyId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // CREATE POLICY
  // ========================================

  describe('createPolicy', () => {
    it('creates a spending_limit policy with valid config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Daily Limit',
        type: 'spending_limit',
        config: {
          perTransaction: 1_000_000,
          daily: 10_000_000,
          scope: 'wallet',
        },
      };

      const mockPolicy = {
        id: policyId,
        ...input,
        config: input.config,
        priority: 0,
        enforcement: 'enforce',
        enabled: true,
        createdBy: userId,
        sourceType: 'wallet',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPolicyRepo.createPolicy.mockResolvedValue(mockPolicy);

      const result = await vaultPolicyService.createPolicy(userId, input);

      expect(result.id).toBe(policyId);
      expect(result.name).toBe('Daily Limit');
      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledTimes(1);
    });

    it('creates an approval_required policy with valid config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Large Transaction Approval',
        type: 'approval_required',
        config: {
          trigger: { amountAbove: 5_000_000 },
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 48,
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
        config: input.config,
      });

      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });

    it('creates a system-wide policy when no walletId or groupId', async () => {
      const input: CreatePolicyInput = {
        name: 'Org Spending Cap',
        type: 'spending_limit',
        config: {
          daily: 100_000_000,
          scope: 'wallet',
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
        walletId: null,
        groupId: null,
        sourceType: 'system',
      });

      await vaultPolicyService.createPolicy(userId, input);

      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: undefined,
          groupId: undefined,
          sourceType: 'system',
        })
      );
    });

    it('rejects invalid policy type', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Policy',
        type: 'invalid_type' as any,
        config: {},
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('Invalid policy type');
    });

    it('rejects empty name', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: '',
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('Policy name is required');
    });

    it('rejects name over 100 characters', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'a'.repeat(101),
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('100 characters');
    });

    it('rejects spending_limit with no limits set', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Limits',
        type: 'spending_limit',
        config: { scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one non-zero limit');
    });

    it('rejects spending_limit with missing scope', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Scope',
        type: 'spending_limit',
        config: { daily: 100 } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('scope');
    });

    it('rejects approval_required with no trigger', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Trigger',
        type: 'approval_required',
        config: {
          trigger: {},
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one condition');
    });

    it('rejects approval_required with zero requiredApprovals', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Zero Approvals',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 0,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('positive integer');
    });

    it('rejects specific quorum without specificApprovers', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Specific No Approvers',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'specific',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('specificApprovers');
    });

    it('rejects time_delay exceeding 7 days', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Too Long',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 200,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('168');
    });

    it('rejects velocity with no limits', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Velocity Limits',
        type: 'velocity',
        config: { scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one non-zero limit');
    });

    it('validates address_control config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Allowlist',
        type: 'address_control',
        config: {
          mode: 'allowlist',
          allowSelfSend: true,
          managedBy: 'owner_only',
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
      });

      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });

    it('rejects invalid enforcement mode', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Mode',
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
        enforcement: 'block' as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('Invalid enforcement mode');
    });
  });

  // ========================================
  // GET POLICIES
  // ========================================

  describe('getWalletPolicies', () => {
    it('returns wallet-only policies by default', async () => {
      const mockPolicies = [
        { id: '1', name: 'P1', walletId, type: 'spending_limit' },
      ];
      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(mockPolicies);

      const result = await vaultPolicyService.getWalletPolicies(walletId);

      expect(result).toHaveLength(1);
      expect(mockPolicyRepo.findSystemPolicies).not.toHaveBeenCalled();
    });

    it('includes inherited system and group policies', async () => {
      const walletPolicies = [{ id: '1', name: 'Wallet', walletId }];
      const systemPolicies = [{ id: '2', name: 'System', walletId: null }];
      const groupPolicies = [{ id: '3', name: 'Group', groupId }];

      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(walletPolicies);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue(systemPolicies);
      mockPolicyRepo.findGroupPolicies.mockResolvedValue(groupPolicies);

      const result = await vaultPolicyService.getWalletPolicies(walletId, {
        includeInherited: true,
        walletGroupId: groupId,
      });

      // System first, then group, then wallet
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('System');
      expect(result[1].name).toBe('Group');
      expect(result[2].name).toBe('Wallet');
    });

    it('skips group policies if no groupId', async () => {
      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue([]);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue([]);

      const result = await vaultPolicyService.getWalletPolicies(walletId, {
        includeInherited: true,
        walletGroupId: null,
      });

      expect(mockPolicyRepo.findGroupPolicies).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });
  });

  // ========================================
  // UPDATE POLICY
  // ========================================

  describe('updatePolicy', () => {
    it('updates a policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'wallet',
        walletId,
      });

      mockPolicyRepo.updatePolicy.mockResolvedValue({
        id: policyId,
        name: 'Updated Name',
      });

      const result = await vaultPolicyService.updatePolicy(policyId, userId, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
    });

    it('rejects updating non-existent policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue(null);

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('Policy not found');
    });

    it('rejects invalid enforcement on update', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'wallet',
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, {
          enforcement: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid enforcement mode');
    });

    it('rejects updating system policies', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'system',
        walletId: null,
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('system policies');
    });

    it('rejects updating group policies from wallet context', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        type: 'spending_limit',
        sourceType: 'group',
        walletId,
      });

      await expect(
        vaultPolicyService.updatePolicy(policyId, userId, { name: 'x' })
      ).rejects.toThrow('group policies');
    });
  });

  // ========================================
  // DELETE POLICY
  // ========================================

  describe('deletePolicy', () => {
    it('deletes a wallet-level policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId,
        sourceType: 'wallet',
      });

      await vaultPolicyService.deletePolicy(policyId, walletId);

      expect(mockPolicyRepo.removePolicy).toHaveBeenCalledWith(policyId);
    });

    it('rejects deleting non-existent policy', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue(null);

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('Policy not found');
    });

    it('rejects deleting policy from wrong wallet', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId: faker.string.uuid(), // different wallet
        sourceType: 'wallet',
      });

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('does not belong to this wallet');
    });

    it('rejects deleting inherited system policy from wallet', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId,
        sourceType: 'system',
      });

      await expect(
        vaultPolicyService.deletePolicy(policyId, walletId)
      ).rejects.toThrow('inherited');
    });

    it('allows deleting system policy without wallet context', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        walletId: null,
        sourceType: 'system',
      });

      await vaultPolicyService.deletePolicy(policyId);

      expect(mockPolicyRepo.removePolicy).toHaveBeenCalledWith(policyId);
    });
  });

  // ========================================
  // ROLE RESOLUTION
  // ========================================

  describe('getActivePoliciesForWallet', () => {
    it('filters to enabled policies only', async () => {
      const policies = [
        { id: '1', name: 'Active', enabled: true, walletId },
        { id: '2', name: 'Disabled', enabled: false, walletId },
      ];

      mockPolicyRepo.findAllPoliciesForWallet.mockResolvedValue(policies);
      mockPolicyRepo.findSystemPolicies.mockResolvedValue([]);

      const result = await vaultPolicyService.getActivePoliciesForWallet(walletId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Active');
    });
  });
});
