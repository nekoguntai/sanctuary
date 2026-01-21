/**
 * Mobile Permissions API Routes
 *
 * Manages mobile access restrictions for wallets.
 * Mobile permissions act as ADDITIONAL restrictions on top of wallet roles.
 *
 * ## Design Principles
 *
 * 1. **Additional restrictions model** - Mobile permissions LIMIT what users can do
 *    via mobile, even if their wallet role allows more
 * 2. **Per-wallet granularity** - Each wallet can have different permissions
 * 3. **Self + owner override** - Users can restrict themselves, owners can set caps
 * 4. **Capability flags** - Granular boolean flags for each action
 *
 * ## Endpoints
 *
 * User endpoints (authenticated):
 * - GET /api/v1/mobile-permissions - Get all user's mobile permissions
 * - GET /api/v1/wallets/:id/mobile-permissions - Get wallet permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions - Update own permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions/:userId - Set user's max (owner only)
 *
 * Internal endpoint (gateway):
 * - POST /internal/mobile-permissions/check - Check permission for gateway
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { verifyGatewayRequest } from '../middleware/gatewayAuth';
import { createLogger } from '../utils/logger';
import { mobilePermissionService, type MobileAction, ALL_MOBILE_ACTIONS } from '../services/mobilePermissions';
import { getErrorMessage } from '../utils/errors';

const publicRouter = Router();
const internalRouter = Router();
const log = createLogger('MOBILE-PERMS-API');

/**
 * Validate mobile action
 */
function isValidMobileAction(action: string): action is MobileAction {
  return ALL_MOBILE_ACTIONS.includes(action as MobileAction);
}

/**
 * Validate permission update input
 */
function validatePermissionInput(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const allowedKeys = ALL_MOBILE_ACTIONS;

  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.includes(key as MobileAction)) {
      return { valid: false, error: `Invalid permission key: ${key}` };
    }
    if (typeof value !== 'boolean') {
      return { valid: false, error: `Permission value for ${key} must be a boolean` };
    }
  }

  if (Object.keys(body).length === 0) {
    return { valid: false, error: 'At least one permission must be provided' };
  }

  return { valid: true };
}

// =============================================================================
// User Endpoints
// =============================================================================

/**
 * GET /api/v1/mobile-permissions
 * Get all mobile permissions for the authenticated user
 */
publicRouter.get('/mobile-permissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const permissions = await mobilePermissionService.getUserMobilePermissions(userId);

    res.json({
      permissions: permissions.map((p) => ({
        id: p.id,
        walletId: p.walletId,
        walletName: p.wallet.name,
        walletNetwork: p.wallet.network,
        role: p.role,
        effectivePermissions: p.effectivePermissions,
        hasCustomRestrictions: p.canViewBalance !== true ||
          p.canViewTransactions !== true ||
          p.canViewUtxos !== true ||
          p.canCreateTransaction !== true ||
          p.canBroadcast !== true ||
          p.canSignPsbt !== true ||
          p.canGenerateAddress !== true ||
          p.canManageLabels !== true ||
          p.canManageDevices !== true ||
          p.canShareWallet !== true ||
          p.canDeleteWallet !== true,
        hasOwnerRestrictions: p.ownerMaxPermissions !== null,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    log.error('List mobile permissions error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list mobile permissions',
    });
  }
});

// =============================================================================
// Wallet-Scoped Endpoints
// =============================================================================

/**
 * GET /api/v1/wallets/:id/mobile-permissions
 * Get mobile permissions for a wallet
 */
publicRouter.get('/wallets/:id/mobile-permissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id: walletId } = req.params;

    // Get effective permissions for the requesting user
    const effective = await mobilePermissionService.getEffectivePermissions(walletId, userId);

    // If user is owner, also get all wallet permissions
    let allWalletPermissions = null;
    if (effective.role === 'owner') {
      allWalletPermissions = await mobilePermissionService.getWalletPermissions(walletId, userId);
    }

    res.json({
      walletId,
      userId,
      role: effective.role,
      permissions: effective.permissions,
      hasCustomRestrictions: effective.hasCustomRestrictions,
      hasOwnerRestrictions: effective.hasOwnerRestrictions,
      ...(allWalletPermissions && { walletUsers: allWalletPermissions }),
    });
  } catch (error) {
    const msg = getErrorMessage(error);
    log.error('Get wallet mobile permissions error', { error: msg });

    if (msg.includes('does not have access')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this wallet',
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get mobile permissions',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id/mobile-permissions
 * Update own mobile permissions for a wallet
 */
publicRouter.patch('/wallets/:id/mobile-permissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id: walletId } = req.params;

    // Validate input
    const validation = validatePermissionInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: validation.error,
      });
    }

    const result = await mobilePermissionService.updateOwnPermissions(
      walletId,
      userId,
      req.body,
      userId
    );

    log.info('Updated mobile permissions', {
      walletId,
      userId,
      changes: Object.keys(req.body),
    });

    res.json({
      success: true,
      walletId,
      userId,
      role: result.role,
      permissions: result.permissions,
      hasCustomRestrictions: result.hasCustomRestrictions,
      hasOwnerRestrictions: result.hasOwnerRestrictions,
    });
  } catch (error) {
    const msg = getErrorMessage(error);
    log.error('Update mobile permissions error', { error: msg });

    if (msg.includes('does not have access')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this wallet',
      });
    }

    if (msg.includes('owner has restricted')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: msg,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update mobile permissions',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id/mobile-permissions/:userId
 * Set max permissions for a user (owner only)
 */
publicRouter.patch('/wallets/:id/mobile-permissions/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const ownerId = req.user!.userId;
    const { id: walletId, userId: targetUserId } = req.params;

    // Validate input
    const validation = validatePermissionInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: validation.error,
      });
    }

    const result = await mobilePermissionService.setMaxPermissions(
      walletId,
      targetUserId,
      ownerId,
      req.body
    );

    log.info('Set mobile permission caps', {
      walletId,
      targetUserId,
      ownerId,
      caps: Object.keys(req.body),
    });

    res.json({
      success: true,
      walletId,
      userId: targetUserId,
      role: result.role,
      permissions: result.permissions,
      hasCustomRestrictions: result.hasCustomRestrictions,
      hasOwnerRestrictions: result.hasOwnerRestrictions,
    });
  } catch (error) {
    const msg = getErrorMessage(error);
    log.error('Set mobile permission caps error', { error: msg });

    if (msg.includes('Only wallet owners')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: msg,
      });
    }

    if (msg.includes('does not have access')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: msg,
      });
    }

    if (msg.includes('Cannot set permission restrictions on wallet owners')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: msg,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to set mobile permission caps',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id/mobile-permissions/:userId/caps
 * Clear max permissions for a user (owner only)
 */
publicRouter.delete('/wallets/:id/mobile-permissions/:userId/caps', authenticate, async (req: Request, res: Response) => {
  try {
    const ownerId = req.user!.userId;
    const { id: walletId, userId: targetUserId } = req.params;

    const result = await mobilePermissionService.clearMaxPermissions(
      walletId,
      targetUserId,
      ownerId
    );

    log.info('Cleared mobile permission caps', {
      walletId,
      targetUserId,
      ownerId,
    });

    res.json({
      success: true,
      walletId,
      userId: targetUserId,
      role: result.role,
      permissions: result.permissions,
      hasCustomRestrictions: result.hasCustomRestrictions,
      hasOwnerRestrictions: result.hasOwnerRestrictions,
    });
  } catch (error) {
    const msg = getErrorMessage(error);
    log.error('Clear mobile permission caps error', { error: msg });

    if (msg.includes('Only wallet owners')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: msg,
      });
    }

    if (msg.includes('not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: msg,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to clear mobile permission caps',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id/mobile-permissions
 * Reset own mobile permissions to defaults
 */
publicRouter.delete('/wallets/:id/mobile-permissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id: walletId } = req.params;

    await mobilePermissionService.resetPermissions(walletId, userId);

    log.info('Reset mobile permissions', { walletId, userId });

    res.json({
      success: true,
      message: 'Mobile permissions reset to defaults',
    });
  } catch (error) {
    log.error('Reset mobile permissions error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset mobile permissions',
    });
  }
});

// =============================================================================
// Internal Endpoint (Gateway)
// =============================================================================

/**
 * POST /internal/mobile-permissions/check
 *
 * INTERNAL ENDPOINT - Called by gateway to check mobile permissions.
 * Returns whether a user can perform an action on a wallet from mobile.
 *
 * Security: Requires HMAC-signed gateway authentication
 *
 * Request body:
 *   - walletId: string
 *   - userId: string
 *   - action: MobileAction
 */
internalRouter.post('/mobile-permissions/check', verifyGatewayRequest, async (req: Request, res: Response) => {
  try {
    const { walletId, userId, action } = req.body;

    // Validate required fields
    if (!walletId || !userId || !action) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'walletId, userId, and action are required',
      });
    }

    // Validate action
    if (!isValidMobileAction(action)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid action: ${action}`,
      });
    }

    const result = await mobilePermissionService.checkForGateway(walletId, userId, action);

    res.json(result);
  } catch (error) {
    log.error('Internal permission check error', { error: getErrorMessage(error) });
    res.status(500).json({
      allowed: false,
      reason: 'Permission check failed',
    });
  }
});

export const mobilePermissionsInternalRoutes = internalRouter;
export default publicRouter;
