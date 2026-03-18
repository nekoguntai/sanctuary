/**
 * Approval Service Tests
 *
 * Tests approval workflow: creating requests, casting votes, resolution, and owner override.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo, mockDraftRepo } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findPolicyById: vi.fn(),
    findApprovalRequestById: vi.fn(),
    findApprovalRequestsByDraftId: vi.fn(),
    findPendingApprovalsForUser: vi.fn(),
    createApprovalRequest: vi.fn(),
    updateApprovalRequestStatus: vi.fn(),
    createVote: vi.fn(),
    findVoteByUserAndRequest: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
  },
  mockDraftRepo: {
    findById: vi.fn(),
    update: vi.fn(),
    updateApprovalStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../src/repositories/draftRepository', () => ({
  draftRepository: mockDraftRepo,
}));

vi.mock('../../../src/repositories/db', () => ({
  db: {},
}));

vi.mock('../../../src/services/vaultPolicy/approvalNotifications', () => ({
  notifyApprovalRequested: vi.fn().mockResolvedValue(undefined),
  notifyApprovalResolved: vi.fn().mockResolvedValue(undefined),
}));

import { approvalService } from '../../../src/services/vaultPolicy/approvalService';

describe('ApprovalService', () => {
  const walletId = faker.string.uuid();
  const userId = faker.string.uuid();
  const draftId = faker.string.uuid();
  const policyId = faker.string.uuid();
  const requestId = faker.string.uuid();
  const otherUserId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApprovalRequestsForDraft', () => {
    it('creates approval requests for triggered policies', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 48,
        },
      });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: requestId,
        draftTransactionId: draftId,
        policyId,
        status: 'pending',
        requiredApprovals: 2,
      });

      const result = await approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      );

      expect(result).toHaveLength(1);
      expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          draftTransactionId: draftId,
          policyId,
          requiredApprovals: 2,
          quorumType: 'any_n',
        })
      );
    });

    it('skips non-approval policies', async () => {
      const result = await approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'test' }]
      );

      expect(result).toHaveLength(0);
      expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    });

    it('sets expiration when configured', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: requestId,
        status: 'pending',
      });

      await approvalService.createApprovalRequestsForDraft(
        draftId, walletId, userId,
        [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      );

      const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
      expect(callArgs.expiresAt).toBeDefined();
      expect(callArgs.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('castVote', () => {
    const pendingRequest = {
      id: requestId,
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 2,
      quorumType: 'any_n',
      allowSelfApproval: false,
      expiresAt: null,
      votes: [],
    };

    it('records an approve vote', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });

      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({
        id: 'v1',
        approvalRequestId: requestId,
        userId: otherUserId,
        decision: 'approve',
      });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{
        ...pendingRequest,
        votes: [{ decision: 'approve' }],
      }]);

      const { vote } = await approvalService.castVote(requestId, otherUserId, 'approve', 'Looks good');

      expect(vote.decision).toBe('approve');
      expect(mockPolicyRepo.createVote).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalRequestId: requestId,
          userId: otherUserId,
          decision: 'approve',
          reason: 'Looks good',
        })
      );
    });

    it('rejects vote on non-pending request', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue({
        ...pendingRequest,
        status: 'approved',
      });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('already approved');
    });

    it('rejects duplicate vote', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue({ id: 'existing' });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('already voted');
    });

    it('rejects self-approval when not allowed', async () => {
      const creatorId = faker.string.uuid();
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: creatorId, walletId });

      await expect(
        approvalService.castVote(requestId, creatorId, 'approve')
      ).rejects.toThrow('Self-approval');
    });

    it('resolves request when quorum is met', async () => {
      const requestWith1Vote = {
        ...pendingRequest,
        requiredApprovals: 1,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(requestWith1Vote);

      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWith1Vote, status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'approved');
    });

    it('rejects request on any rejection vote', async () => {
      const requestWithReject = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(requestWithReject);

      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWithReject, status: 'rejected' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'reject', 'Too risky');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'rejected');
    });

    it('rejects non-existent request', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(null);

      await expect(
        approvalService.castVote('nonexistent', otherUserId, 'approve')
      ).rejects.toThrow('not found');
    });
  });

  describe('ownerOverride', () => {
    it('force-approves all pending requests', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'pending', policyId },
        { id: 'r2', status: 'pending', policyId },
      ]);

      await approvalService.ownerOverride(draftId, walletId, userId, 'Emergency');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledTimes(2);
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith('r1', 'approved');
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith('r2', 'approved');
    });

    it('logs override events for each policy', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'pending', policyId },
      ]);

      await approvalService.ownerOverride(draftId, walletId, userId, 'Time critical');

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'overridden',
          details: expect.objectContaining({
            reason: 'Time critical',
            overriddenBy: userId,
          }),
        })
      );
    });

    it('rejects when no pending requests exist', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'approved', policyId },
      ]);

      await expect(
        approvalService.ownerOverride(draftId, walletId, userId, 'reason')
      ).rejects.toThrow('No pending');
    });
  });

  describe('getApprovalsForDraft', () => {
    it('returns approval requests with votes', async () => {
      const mockApprovals = [
        { id: 'r1', status: 'pending', votes: [] },
        { id: 'r2', status: 'approved', votes: [{ decision: 'approve' }] },
      ];
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue(mockApprovals);

      const result = await approvalService.getApprovalsForDraft(draftId);

      expect(result).toHaveLength(2);
    });
  });

  describe('getPendingApprovalsForUser', () => {
    it('passes wallet IDs to repository', async () => {
      mockPolicyRepo.findPendingApprovalsForUser.mockResolvedValue([
        { id: 'r1', draftTransaction: { walletId: 'w1' }, votes: [] },
        { id: 'r3', draftTransaction: { walletId: 'w3' }, votes: [] },
      ]);

      const result = await approvalService.getPendingApprovalsForUser(['w1', 'w3']);

      expect(result).toHaveLength(2);
      expect(mockPolicyRepo.findPendingApprovalsForUser).toHaveBeenCalledWith(['w1', 'w3']);
    });
  });
});
