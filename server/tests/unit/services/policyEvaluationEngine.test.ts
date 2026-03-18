/**
 * Policy Evaluation Engine Tests
 *
 * Tests policy evaluation logic for spending limits, address controls,
 * approval requirements, and velocity limits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo, mockWalletRepo, mockVaultPolicyService, mockIncrementUsageWindow } = vi.hoisted(() => ({
  mockIncrementUsageWindow: vi.fn().mockResolvedValue(undefined),
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findOrCreateUsageWindow: vi.fn(),
    findPolicyAddresses: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
    incrementUsageWindow: vi.fn().mockResolvedValue(undefined),
  },
  mockWalletRepo: {
    findById: vi.fn(),
  },
  mockVaultPolicyService: {
    getActivePoliciesForWallet: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: mockWalletRepo,
}));

vi.mock('../../../src/services/vaultPolicy/vaultPolicyService', () => ({
  vaultPolicyService: mockVaultPolicyService,
}));

import { policyEvaluationEngine } from '../../../src/services/vaultPolicy/policyEvaluationEngine';

describe('PolicyEvaluationEngine', () => {
  const walletId = faker.string.uuid();
  const userId = faker.string.uuid();
  const recipient = 'bc1qtest123456789';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId: null });
  });

  describe('no policies', () => {
    it('returns allowed when no policies exist', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId,
        userId,
        recipient,
        amount: BigInt(100_000),
      });

      expect(result.allowed).toBe(true);
      expect(result.triggered).toHaveLength(0);
    });
  });

  describe('spending_limit', () => {
    it('allows transaction under per-transaction limit', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Tx Limit',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { perTransaction: 1_000_000, scope: 'wallet' },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(500_000),
      });

      expect(result.allowed).toBe(true);
      expect(result.triggered).toHaveLength(0);
    });

    it('blocks transaction over per-transaction limit', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Tx Limit',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { perTransaction: 1_000_000, scope: 'wallet' },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(2_000_000),
      });

      expect(result.allowed).toBe(false);
      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].action).toBe('blocked');
      expect(result.triggered[0].type).toBe('spending_limit');
    });

    it('blocks when daily limit would be exceeded', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Daily Cap',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { daily: 5_000_000, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(4_500_000),
        txCount: 3,
      });

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(600_000),
      });

      expect(result.allowed).toBe(false);
      expect(result.triggered[0].reason).toContain('daily');
    });

    it('allows when daily limit has room', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Daily Cap',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { daily: 5_000_000, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(1_000_000),
        txCount: 1,
      });

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(600_000),
      });

      expect(result.allowed).toBe(true);
      expect(result.limits?.daily?.remaining).toBe(4_000_000);
    });

    it('monitors but does not block in monitor mode', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Monitored Limit',
        type: 'spending_limit',
        enforcement: 'monitor',
        config: { perTransaction: 100, scope: 'wallet' },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(500_000),
      });

      expect(result.allowed).toBe(true);
      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].action).toBe('monitored');
    });
  });

  describe('approval_required', () => {
    it('triggers when always is set', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Always Approve',
        type: 'approval_required',
        enforcement: 'enforce',
        config: {
          trigger: { always: true },
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 48,
        },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(true); // approval_required doesn't block
      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].action).toBe('approval_required');
    });

    it('triggers when amount exceeds threshold', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Large Tx',
        type: 'approval_required',
        enforcement: 'enforce',
        config: {
          trigger: { amountAbove: 1_000_000 },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(2_000_000),
      });

      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].action).toBe('approval_required');
    });

    it('does not trigger when amount is under threshold', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Large Tx',
        type: 'approval_required',
        enforcement: 'enforce',
        config: {
          trigger: { amountAbove: 1_000_000 },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(500_000),
      });

      expect(result.triggered).toHaveLength(0);
    });
  });

  describe('address_control', () => {
    it('blocks address not on allowlist', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Allowlist',
        type: 'address_control',
        enforcement: 'enforce',
        config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
      }]);

      mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
        { address: 'bc1qallowed1', listType: 'allow' },
        { address: 'bc1qallowed2', listType: 'allow' },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId,
        recipient: 'bc1qnotallowed',
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(false);
      expect(result.triggered[0].reason).toContain('not on the allowlist');
    });

    it('allows address on allowlist', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Allowlist',
        type: 'address_control',
        enforcement: 'enforce',
        config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
      }]);

      mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
        { address: 'bc1qallowed1', listType: 'allow' },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId,
        recipient: 'bc1qallowed1',
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(true);
    });

    it('blocks address on denylist', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Denylist',
        type: 'address_control',
        enforcement: 'enforce',
        config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
      }]);

      mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
        { address: 'bc1qbadactor', listType: 'deny' },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId,
        recipient: 'bc1qbadactor',
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(false);
      expect(result.triggered[0].reason).toContain('denylist');
    });

    it('allows empty allowlist (no restrictions)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Empty Allowlist',
        type: 'address_control',
        enforcement: 'enforce',
        config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
      }]);

      mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId,
        recipient: 'bc1qanything',
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('velocity', () => {
    it('blocks when daily tx count exceeded', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Tx Limit',
        type: 'velocity',
        enforcement: 'enforce',
        config: { maxPerDay: 5, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 5,
      });

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(false);
      expect(result.triggered[0].reason).toContain('daily');
    });

    it('allows when under tx count', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Tx Limit',
        type: 'velocity',
        enforcement: 'enforce',
        config: { maxPerDay: 5, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 2,
      });

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('multiple policies', () => {
    it('evaluates all policies and combines results', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        {
          id: 'p1',
          name: 'Spending Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { perTransaction: 10_000_000, scope: 'wallet' },
        },
        {
          id: 'p2',
          name: 'Approval',
          type: 'approval_required',
          enforcement: 'enforce',
          config: {
            trigger: { amountAbove: 5_000_000 },
            requiredApprovals: 1,
            quorumType: 'any_n',
            allowSelfApproval: false,
            expirationHours: 24,
          },
        },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(7_000_000),
      });

      // Under spending limit but above approval threshold
      expect(result.allowed).toBe(true);
      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].type).toBe('approval_required');
    });

    it('enforce-mode policy error blocks transaction (fail-closed)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        {
          id: 'p1',
          name: 'Bad Policy',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: null, // Will cause evaluation error
        },
        {
          id: 'p2',
          name: 'Good Policy',
          type: 'approval_required',
          enforcement: 'enforce',
          config: {
            trigger: { always: true },
            requiredApprovals: 1,
            quorumType: 'any_n',
            allowSelfApproval: false,
            expirationHours: 24,
          },
        },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      // First policy errored → blocked (fail-closed), second still evaluated
      expect(result.allowed).toBe(false);
      expect(result.triggered.some(t => t.reason.includes('precaution'))).toBe(true);
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('monitor-mode policy error does not block (fail-open)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        {
          id: 'p1',
          name: 'Monitored Bad',
          type: 'spending_limit',
          enforcement: 'monitor',
          config: null, // Will cause evaluation error
        },
      ]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      // Monitor mode → fail-open
      expect(result.allowed).toBe(true);
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('preview mode', () => {
    it('skips event logging in preview mode', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Always Approve',
        type: 'approval_required',
        enforcement: 'enforce',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      }]);

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
        preview: true,
      });

      expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
    });

    it('logs events when not in preview mode', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Always Approve',
        type: 'approval_required',
        enforcement: 'enforce',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      }]);

      await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalled();
    });
  });

  describe('time_delay', () => {
    it('includes time_delay in triggered list for UI awareness', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Cooling Period',
        type: 'time_delay',
        enforcement: 'enforce',
        config: {
          trigger: { always: true },
          delayHours: 24,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      }]);

      const result = await policyEvaluationEngine.evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      expect(result.triggered).toHaveLength(1);
      expect(result.triggered[0].type).toBe('time_delay');
      expect(result.triggered[0].reason).toContain('cooling period');
    });
  });

  describe('recordUsage', () => {
    it('increments spending limit usage windows after broadcast', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Daily Cap',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { daily: 5_000_000, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          walletId,
          windowType: 'daily',
        })
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('increments velocity usage windows after broadcast', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Tx Limit',
        type: 'velocity',
        enforcement: 'enforce',
        config: { maxPerDay: 10, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('uses per_user scope when configured', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Per-User Cap',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { daily: 1_000_000, scope: 'per_user' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
        })
      );
    });

    it('handles errors gracefully without throwing', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([{
        id: 'p1',
        name: 'Erroring',
        type: 'spending_limit',
        enforcement: 'enforce',
        config: { daily: 100, scope: 'wallet' },
      }]);

      mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        policyEvaluationEngine.recordUsage(walletId, userId, BigInt(100))
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalled();
    });
  });
});
