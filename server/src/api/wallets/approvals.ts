/**
 * Wallet Approval API Routes
 *
 * Endpoints for the approval workflow: listing approvals, casting votes,
 * and owner override.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { approvalService } from '../../services/vaultPolicy/approvalService';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import type { VoteDecision } from '../../services/vaultPolicy/types';

const router = Router();

const VALID_DECISIONS: VoteDecision[] = ['approve', 'reject', 'veto'];

/**
 * GET /:walletId/drafts/:draftId/approvals - List approval requests for a draft
 */
router.get('/:walletId/drafts/:draftId/approvals', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { draftId } = req.params;

  const approvals = await approvalService.getApprovalsForDraft(draftId);

  res.json({ approvals });
}));

/**
 * POST /:walletId/drafts/:draftId/approvals/:requestId/vote - Cast a vote
 * Requires 'approve' access level (owner or approver role)
 */
router.post(
  '/:walletId/drafts/:draftId/approvals/:requestId/vote',
  requireWalletAccess('approve'),
  asyncHandler(async (req, res) => {
    const { walletId, draftId, requestId } = req.params;
    const userId = req.user!.userId;
    const { decision, reason } = req.body;

    if (!decision || !VALID_DECISIONS.includes(decision)) {
      throw new InvalidInputError('decision is required and must be one of: approve, reject, veto');
    }

    const { vote, request } = await approvalService.castVote(requestId, userId, decision, reason);

    await auditService.logFromRequest(req, AuditAction.POLICY_APPROVAL_VOTE, AuditCategory.WALLET, {
      details: {
        walletId,
        draftId,
        requestId,
        decision,
        reason: reason ?? null,
        requestStatus: request.status,
      },
    });

    res.json({
      vote: {
        id: vote.id,
        decision: vote.decision,
        reason: vote.reason,
        createdAt: vote.createdAt,
      },
      request: {
        id: request.id,
        status: request.status,
        requiredApprovals: request.requiredApprovals,
        currentApprovals: request.votes.filter(v => v.decision === 'approve').length,
        totalVotes: request.votes.length,
      },
    });
  })
);

/**
 * POST /:walletId/drafts/:draftId/override - Owner force-approve
 * Requires 'owner' access level
 */
router.post('/:walletId/drafts/:draftId/override', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, draftId } = req.params;
  const userId = req.user!.userId;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new InvalidInputError('A reason is required for owner override');
  }

  await approvalService.ownerOverride(draftId, walletId, userId, reason.trim());

  await auditService.logFromRequest(req, AuditAction.POLICY_OVERRIDE, AuditCategory.WALLET, {
    details: {
      walletId,
      draftId,
      reason: reason.trim(),
    },
  });

  res.json({ success: true, message: 'All pending approvals have been force-approved' });
}));

export default router;
