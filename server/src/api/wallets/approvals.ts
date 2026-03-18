/**
 * Wallet Approval API Routes
 *
 * Endpoints for the approval workflow: listing approvals, casting votes,
 * and owner override.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { approvalService } from '../../services/vaultPolicy/approvalService';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { VoteDecision } from '../../services/vaultPolicy/types';

const router = Router();
const log = createLogger('WALLETS:APPROVALS');

const VALID_DECISIONS: VoteDecision[] = ['approve', 'reject', 'veto'];

/**
 * GET /:walletId/drafts/:draftId/approvals - List approval requests for a draft
 */
router.get('/:walletId/drafts/:draftId/approvals', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const { draftId } = req.params;

    const approvals = await approvalService.getApprovalsForDraft(draftId);

    res.json({ approvals });
  } catch (error) {
    log.error('Failed to list approvals', { draftId: req.params.draftId, error: getErrorMessage(error) });
    throw error;
  }
});

/**
 * POST /:walletId/drafts/:draftId/approvals/:requestId/vote - Cast a vote
 * Requires 'approve' access level (owner or approver role)
 */
router.post(
  '/:walletId/drafts/:draftId/approvals/:requestId/vote',
  requireWalletAccess('approve'),
  async (req: Request, res: Response) => {
    try {
      const { walletId, draftId, requestId } = req.params;
      const userId = req.user!.userId;
      const { decision, reason } = req.body;

      if (!decision || !VALID_DECISIONS.includes(decision)) {
        return res.status(400).json({
          error: 'decision is required and must be one of: approve, reject, veto',
        });
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
    } catch (error) {
      log.error('Failed to cast vote', { requestId: req.params.requestId, error: getErrorMessage(error) });
      throw error;
    }
  }
);

/**
 * POST /:walletId/drafts/:draftId/override - Owner force-approve
 * Requires 'owner' access level
 */
router.post('/:walletId/drafts/:draftId/override', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { walletId, draftId } = req.params;
    const userId = req.user!.userId;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'A reason is required for owner override' });
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
  } catch (error) {
    log.error('Failed to override approvals', { draftId: req.params.draftId, error: getErrorMessage(error) });
    throw error;
  }
});

export default router;
