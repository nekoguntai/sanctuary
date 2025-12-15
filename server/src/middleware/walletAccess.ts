/**
 * Wallet Access Middleware
 *
 * Middleware to verify user has appropriate access level to a wallet
 */

import { Request, Response, NextFunction } from 'express';
import {
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  getUserWalletRole,
  WalletRole,
} from '../services/wallet';
import { createLogger } from '../utils/logger';

const log = createLogger('WALLET_ACCESS');

// Extend Express Request type to include wallet info
declare global {
  namespace Express {
    interface Request {
      walletId?: string;
      walletRole?: WalletRole;
    }
  }
}

export type AccessLevel = 'view' | 'edit' | 'owner';

/**
 * Middleware factory to require a specific access level to a wallet
 *
 * Usage:
 *   router.get('/:id', authenticate, requireWalletAccess('view'), handler);
 *   router.post('/:id/send', authenticate, requireWalletAccess('edit'), handler);
 *   router.delete('/:id', authenticate, requireWalletAccess('owner'), handler);
 *
 * @param level - 'view' (any access), 'edit' (owner/signer), 'owner' (owner only)
 */
export function requireWalletAccess(level: AccessLevel = 'view') {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Get wallet ID from route params (supports both :id and :walletId)
    const walletId = req.params.walletId || req.params.id;
    const userId = req.user?.userId;

    if (!walletId) {
      log.warn('Wallet access check failed: no wallet ID', { path: req.path });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Wallet ID is required',
      });
    }

    if (!userId) {
      log.warn('Wallet access check failed: no user ID', { walletId });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      // Select the appropriate check function based on access level
      let hasAccess: boolean;

      switch (level) {
        case 'owner':
          hasAccess = await checkWalletOwnerAccess(walletId, userId);
          break;
        case 'edit':
          hasAccess = await checkWalletEditAccess(walletId, userId);
          break;
        case 'view':
        default:
          hasAccess = await checkWalletAccess(walletId, userId);
          break;
      }

      if (!hasAccess) {
        log.warn('Wallet access denied', { walletId, userId, requiredLevel: level });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to access this wallet',
        });
      }

      // Attach wallet info to request for use in handlers
      req.walletId = walletId;

      // Optionally get and attach the user's role for the handler
      const role = await getUserWalletRole(walletId, userId);
      req.walletRole = role;

      next();
    } catch (error) {
      log.error('Wallet access check error', { walletId, userId, error });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify wallet access',
      });
    }
  };
}

/**
 * Helper to check access inline within a handler (for conditional logic)
 * Returns the user's role or null if no access
 */
export async function getWalletAccessRole(
  walletId: string,
  userId: string
): Promise<WalletRole> {
  return getUserWalletRole(walletId, userId);
}
