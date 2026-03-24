/**
 * Wallet Policy API Routes
 *
 * CRUD endpoints for managing vault policies on individual wallets.
 * Policy management requires owner access.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { vaultPolicyService, policyEvaluationEngine } from '../../services/vaultPolicy';
import { policyRepository } from '../../repositories/policyRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import type { CreatePolicyInput, UpdatePolicyInput } from '../../services/vaultPolicy/types';

const router = Router();

const MAX_PAGE_LIMIT = 200;

// ========================================
// POLICY EVENTS (must be before /:policyId to avoid "events" matching as policyId)
// ========================================

/**
 * GET /:walletId/policies/events - Get policy event log
 */
router.get('/:walletId/policies/events', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const { policyId, eventType, from, to, limit, offset } = req.query;

  const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
  const parsedOffset = offset ? parseInt(offset as string, 10) : 0;
  const clampedLimit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT);
  const clampedOffset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

  const result = await policyRepository.findPolicyEvents(walletId, {
    policyId: policyId as string | undefined,
    eventType: eventType as string | undefined,
    from: from ? new Date(from as string) : undefined,
    to: to ? new Date(to as string) : undefined,
    limit: clampedLimit,
    offset: clampedOffset,
  });

  res.json(result);
}));

// ========================================
// POLICY EVALUATION PREVIEW
// ========================================

/**
 * POST /:walletId/policies/evaluate - Preview policy evaluation for a transaction
 * Returns which policies would trigger without creating anything.
 */
router.post('/:walletId/policies/evaluate', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const userId = req.user!.userId;
  const { recipient, amount, outputs } = req.body;

  if (!recipient || amount === undefined) {
    throw new InvalidInputError('recipient and amount are required');
  }

  // Validate amount is a valid integer before BigInt conversion
  if (typeof amount !== 'number' && (typeof amount !== 'string' || !/^\d+$/.test(amount))) {
    throw new InvalidInputError('amount must be a valid non-negative integer');
  }

  const result = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId,
    recipient,
    amount: BigInt(amount),
    outputs,
    preview: true, // Skip event logging for previews
  });

  res.json(result);
}));

// ========================================
// POLICY CRUD
// ========================================

/**
 * GET /:walletId/policies - List all policies for a wallet (includes inherited)
 */
router.get('/:walletId/policies', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const includeInherited = req.query.includeInherited !== 'false';

  const wallet = await walletRepository.findById(walletId);

  const policies = await vaultPolicyService.getWalletPolicies(walletId, {
    includeInherited,
    walletGroupId: wallet?.groupId,
  });

  res.json({ policies });
}));

/**
 * GET /:walletId/policies/:policyId - Get a specific policy
 */
router.get('/:walletId/policies/:policyId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const policy = await vaultPolicyService.getPolicyInWallet(req.params.policyId, req.params.walletId);
  res.json({ policy });
}));

/**
 * POST /:walletId/policies - Create a new policy (Owner only)
 */
router.post('/:walletId/policies', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const userId = req.user!.userId;

  const input: CreatePolicyInput = {
    walletId,
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    config: req.body.config,
    priority: req.body.priority,
    enforcement: req.body.enforcement,
    enabled: req.body.enabled,
  };

  const policy = await vaultPolicyService.createPolicy(userId, input);

  await auditService.logFromRequest(req, AuditAction.POLICY_CREATE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId: policy.id,
      policyName: policy.name,
      policyType: policy.type,
    },
  });

  res.status(201).json({ policy });
}));

/**
 * PATCH /:walletId/policies/:policyId - Update a policy (Owner only)
 */
router.patch('/:walletId/policies/:policyId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const userId = req.user!.userId;

  // Verify the policy belongs to this wallet
  await vaultPolicyService.getPolicyInWallet(policyId, walletId);

  const input: UpdatePolicyInput = {
    ...(req.body.name !== undefined && { name: req.body.name }),
    ...(req.body.description !== undefined && { description: req.body.description }),
    ...(req.body.config !== undefined && { config: req.body.config }),
    ...(req.body.priority !== undefined && { priority: req.body.priority }),
    ...(req.body.enforcement !== undefined && { enforcement: req.body.enforcement }),
    ...(req.body.enabled !== undefined && { enabled: req.body.enabled }),
  };

  const policy = await vaultPolicyService.updatePolicy(policyId, userId, input);

  await auditService.logFromRequest(req, AuditAction.POLICY_UPDATE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId,
      updatedFields: Object.keys(input),
    },
  });

  res.json({ policy });
}));

/**
 * DELETE /:walletId/policies/:policyId - Delete a policy (Owner only, wallet-level only)
 */
router.delete('/:walletId/policies/:policyId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;

  await vaultPolicyService.deletePolicy(policyId, walletId);

  await auditService.logFromRequest(req, AuditAction.POLICY_DELETE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId,
    },
  });

  res.json({ success: true });
}));

// ========================================
// POLICY ADDRESSES
// ========================================

/**
 * GET /:walletId/policies/:policyId/addresses - List policy addresses
 */
router.get('/:walletId/policies/:policyId/addresses', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const listType = req.query.listType as string | undefined;

  // Verify policy belongs to this wallet
  await vaultPolicyService.getPolicyInWallet(policyId, walletId);

  const addresses = await policyRepository.findPolicyAddresses(
    policyId,
    listType === 'allow' || listType === 'deny' ? listType : undefined
  );

  res.json({ addresses });
}));

/**
 * POST /:walletId/policies/:policyId/addresses - Add address to policy list
 */
router.post('/:walletId/policies/:policyId/addresses', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const userId = req.user!.userId;

  // Verify policy belongs to this wallet and is address_control type
  const policy = await vaultPolicyService.getPolicyInWallet(policyId, walletId);
  if (policy.type !== 'address_control') {
    throw new InvalidInputError('Address lists can only be managed on address_control policies');
  }

  const { address, label, listType } = req.body;

  if (!address || !listType) {
    throw new InvalidInputError('address and listType are required');
  }

  if (typeof address !== 'string' || address.length > 100) {
    throw new InvalidInputError('address must be a string of 100 characters or fewer');
  }

  if (listType !== 'allow' && listType !== 'deny') {
    throw new InvalidInputError('listType must be "allow" or "deny"');
  }

  const policyAddress = await policyRepository.createPolicyAddress({
    policyId,
    address,
    label,
    listType,
    addedBy: userId,
  });

  res.status(201).json({ address: policyAddress });
}));

/**
 * DELETE /:walletId/policies/:policyId/addresses/:addressId - Remove address from policy list
 */
router.delete('/:walletId/policies/:policyId/addresses/:addressId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId, addressId } = req.params;

  // Verify policy belongs to this wallet
  await vaultPolicyService.getPolicyInWallet(policyId, walletId);

  // Verify address belongs to this policy
  const address = await policyRepository.findPolicyAddressById(addressId);
  if (!address || address.policyId !== policyId) {
    throw new NotFoundError('Address not found in this policy');
  }

  await policyRepository.removePolicyAddress(addressId);
  res.json({ success: true });
}));

export default router;
