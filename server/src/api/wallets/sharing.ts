/**
 * Wallets - Sharing Router
 *
 * Wallet access control and user/group sharing
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { userRepository, walletSharingRepository } from '../../repositories';
import { getDevicesToShareForWallet } from '../../services/deviceAccess';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('WALLETS:SHARING');

/**
 * POST /api/v1/wallets/:id/share/group
 * Share wallet with a group (owner only)
 */
router.post('/:id/share/group', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { groupId, role = 'viewer' } = req.body;

    // Validate role
    if (role && !['viewer', 'signer'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid role. Must be viewer or signer',
      });
    }

    // If groupId provided, verify user is member of that group
    if (groupId) {
      const isMember = await walletSharingRepository.isGroupMember(groupId, userId);

      if (!isMember) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You must be a member of the group to share with it',
        });
      }
    }

    // Update wallet's group and role
    const wallet = await walletSharingRepository.updateWalletGroupWithResult(walletId, groupId || null, role);

    res.json({
      success: true,
      groupId: wallet.groupId,
      groupName: wallet.group?.name || null,
      groupRole: wallet.groupRole,
    });
  } catch (error) {
    log.error('Share with group error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with group',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/share/user
 * Share wallet with a specific user (owner only)
 */
router.post('/:id/share/user', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { targetUserId, role = 'viewer' } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'targetUserId is required',
      });
    }

    if (!['viewer', 'signer'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'role must be viewer or signer',
      });
    }

    // Verify target user exists
    const targetUser = await userRepository.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Check if user already has access
    const existingAccess = await walletSharingRepository.findWalletUser(walletId, targetUserId);

    if (existingAccess) {
      // Update role if different
      if (existingAccess.role !== role && existingAccess.role !== 'owner') {
        await walletSharingRepository.updateUserRole(existingAccess.id, role);
      }
      return res.json({
        success: true,
        message: 'User access updated',
      });
    }

    // Add user to wallet
    await walletSharingRepository.addUserToWallet(walletId, targetUserId, role);

    // Get devices associated with this wallet that the target user doesn't have access to
    const devicesToShare = await getDevicesToShareForWallet(walletId, targetUserId);

    res.status(201).json({
      success: true,
      message: 'User added to wallet',
      devicesToShare: devicesToShare.length > 0 ? devicesToShare : undefined,
    });
  } catch (error) {
    log.error('Share with user error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with user',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id/share/user/:targetUserId
 * Remove a user's access to wallet (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { targetUserId } = req.params;

    // Can't remove the owner
    const targetWalletUser = await walletSharingRepository.findWalletUser(walletId, targetUserId);

    if (!targetWalletUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User does not have access to this wallet',
      });
    }

    if (targetWalletUser.role === 'owner') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot remove the owner from the wallet',
      });
    }

    await walletSharingRepository.removeUserFromWallet(targetWalletUser.id);

    res.json({
      success: true,
      message: 'User removed from wallet',
    });
  } catch (error) {
    log.error('Remove user error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove user from wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/share
 * Get wallet sharing info (group and users)
 */
router.get('/:id/share', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    const wallet = await walletSharingRepository.getWalletSharingInfo(walletId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json({
      group: wallet.group ? {
        id: wallet.group.id,
        name: wallet.group.name,
        role: wallet.groupRole,
      } : null,
      users: wallet.users.map((wu: { user: { id: string; username: string }; role: string }) => ({
        id: wu.user.id,
        username: wu.user.username,
        role: wu.role,
      })),
    });
  } catch (error) {
    log.error('Get share info error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get sharing info',
    });
  }
});

export default router;
