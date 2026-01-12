/**
 * Devices - Sharing Router
 *
 * Device access control and user/group sharing
 */

import { Router, Request, Response } from 'express';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import {
  getDeviceShareInfo,
  shareDeviceWithUser,
  removeUserFromDevice,
  shareDeviceWithGroup,
} from '../../services/deviceAccess';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('DEVICES:SHARING');

/**
 * GET /api/v1/devices/:id/share
 * Get sharing info for a device (requires view access)
 */
router.get('/:id/share', requireDeviceAccess('view'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const shareInfo = await getDeviceShareInfo(id);

    res.json(shareInfo);
  } catch (error) {
    log.error('Get device share info error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device sharing info',
    });
  }
});

/**
 * POST /api/v1/devices/:id/share/user
 * Share device with a user (owner only)
 */
router.post('/:id/share/user', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ownerId = req.user!.userId;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'targetUserId is required',
      });
    }

    const result = await shareDeviceWithUser(id, targetUserId, ownerId);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Share device with user error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share device',
    });
  }
});

/**
 * DELETE /api/v1/devices/:id/share/user/:targetUserId
 * Remove a user's access to device (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { id, targetUserId } = req.params;
    const ownerId = req.user!.userId;

    const result = await removeUserFromDevice(id, targetUserId, ownerId);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Remove user from device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove user access',
    });
  }
});

/**
 * POST /api/v1/devices/:id/share/group
 * Share device with a group or remove group access (owner only)
 */
router.post('/:id/share/group', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ownerId = req.user!.userId;
    const { groupId } = req.body; // null to remove group access

    const result = await shareDeviceWithGroup(id, groupId, ownerId);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Share device with group error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share device with group',
    });
  }
});

export default router;
