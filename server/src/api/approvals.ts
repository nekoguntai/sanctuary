/**
 * Global Approvals API Routes
 *
 * Cross-wallet approval endpoints for the current user.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { approvalService } from '../services/vaultPolicy/approvalService';
import { db as prisma } from '../repositories/db';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const router = Router();
const log = createLogger('APPROVALS');

router.use(authenticate);

/**
 * GET /api/v1/approvals/pending - List all pending approvals for the current user
 * Returns approvals for wallets where the user has owner or approver role.
 */
router.get('/approvals/pending', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Single query: get wallet IDs where user has approve-capable role (owner or approver)
    const walletUsers = await prisma.walletUser.findMany({
      where: {
        userId,
        role: { in: ['owner', 'approver'] },
      },
      select: { walletId: true },
    });

    const approveWalletIds = walletUsers.map(wu => wu.walletId);

    const pending = await approvalService.getPendingApprovalsForUser(approveWalletIds);

    res.json({
      approvals: pending.map(a => ({
        id: a.id,
        draftTransactionId: a.draftTransactionId,
        walletId: a.draftTransaction.walletId,
        status: a.status,
        requiredApprovals: a.requiredApprovals,
        currentApprovals: a.votes.filter(v => v.decision === 'approve').length,
        totalVotes: a.votes.length,
        recipient: a.draftTransaction.recipient,
        amount: a.draftTransaction.amount.toString(),
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
      })),
      total: pending.length,
    });
  } catch (error) {
    log.error('Failed to list pending approvals', { error: getErrorMessage(error) });
    throw error;
  }
});

export default router;
