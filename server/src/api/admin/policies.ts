/**
 * Admin Policy API Routes
 *
 * System-wide and group-level policy management (admin only).
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { vaultPolicyService } from '../../services/vaultPolicy';
import { policyRepository } from '../../repositories/policyRepository';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { CreatePolicyInput, UpdatePolicyInput } from '../../services/vaultPolicy/types';

const router = Router();
const log = createLogger('ADMIN:POLICIES');

// ========================================
// SYSTEM-WIDE POLICIES
// ========================================

/**
 * GET / - List all system-wide policies
 */
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const policies = await vaultPolicyService.getSystemPolicies();
    res.json({ policies });
  } catch (error) {
    log.error('Failed to list system policies', { error: getErrorMessage(error) });
    throw error;
  }
});

/**
 * POST / - Create a system-wide policy
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const input: CreatePolicyInput = {
      // No walletId or groupId = system-wide
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      config: req.body.config,
      priority: req.body.priority,
      enforcement: req.body.enforcement,
      enabled: req.body.enabled,
    };

    const policy = await vaultPolicyService.createPolicy(userId, input);

    await auditService.logFromRequest(req, AuditAction.POLICY_CREATE, AuditCategory.ADMIN, {
      details: {
        scope: 'system',
        policyId: policy.id,
        policyName: policy.name,
        policyType: policy.type,
      },
    });

    res.status(201).json({ policy });
  } catch (error) {
    log.error('Failed to create system policy', { error: getErrorMessage(error) });
    throw error;
  }
});

/**
 * PATCH /:policyId - Update a system-wide policy
 */
router.patch('/:policyId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { policyId } = req.params;
    const userId = req.user!.userId;

    // Verify this is a system-level policy
    const existing = await vaultPolicyService.getPolicy(policyId);
    if (existing.sourceType !== 'system') {
      return res.status(403).json({ error: 'Admin policy endpoints can only manage system-level policies' });
    }

    const input: UpdatePolicyInput = {
      ...(req.body.name !== undefined && { name: req.body.name }),
      ...(req.body.description !== undefined && { description: req.body.description }),
      ...(req.body.config !== undefined && { config: req.body.config }),
      ...(req.body.priority !== undefined && { priority: req.body.priority }),
      ...(req.body.enforcement !== undefined && { enforcement: req.body.enforcement }),
      ...(req.body.enabled !== undefined && { enabled: req.body.enabled }),
    };

    const policy = await vaultPolicyService.updatePolicy(policyId, userId, input, { isAdmin: true });

    await auditService.logFromRequest(req, AuditAction.POLICY_UPDATE, AuditCategory.ADMIN, {
      details: {
        scope: 'system',
        policyId,
        updatedFields: Object.keys(input),
      },
    });

    res.json({ policy });
  } catch (error) {
    log.error('Failed to update system policy', { policyId: req.params.policyId, error: getErrorMessage(error) });
    throw error;
  }
});

/**
 * DELETE /:policyId - Delete a system-wide policy
 */
router.delete('/:policyId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { policyId } = req.params;

    // Verify this is a system-level policy
    const existing = await vaultPolicyService.getPolicy(policyId);
    if (existing.sourceType !== 'system') {
      return res.status(403).json({ error: 'Admin policy endpoints can only manage system-level policies' });
    }

    await vaultPolicyService.deletePolicy(policyId);

    await auditService.logFromRequest(req, AuditAction.POLICY_DELETE, AuditCategory.ADMIN, {
      details: {
        scope: 'system',
        policyId,
      },
    });

    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete system policy', { policyId: req.params.policyId, error: getErrorMessage(error) });
    throw error;
  }
});

// ========================================
// GROUP POLICIES (mounted under /groups/:groupId/policies by admin.ts)
// These are handled as sub-routes; see the admin router for mounting.
// ========================================

export default router;
