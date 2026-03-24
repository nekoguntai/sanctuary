/**
 * Devices - Sharing Router
 *
 * Device access control and user/group sharing
 */

import { Router } from 'express';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import {
  getDeviceShareInfo,
  shareDeviceWithUser,
  removeUserFromDevice,
  shareDeviceWithGroup,
} from '../../services/deviceAccess';

const router = Router();

/**
 * GET /api/v1/devices/:id/share
 * Get sharing info for a device (requires view access)
 */
router.get('/:id/share', requireDeviceAccess('view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const shareInfo = await getDeviceShareInfo(id);

  res.json(shareInfo);
}));

/**
 * POST /api/v1/devices/:id/share/user
 * Share device with a user (owner only)
 */
router.post('/:id/share/user', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ownerId = req.user!.userId;
  const { targetUserId } = req.body;

  if (!targetUserId) {
    throw new InvalidInputError('targetUserId is required');
  }

  const result = await shareDeviceWithUser(id, targetUserId, ownerId);

  if (!result.success) {
    throw new InvalidInputError(result.message);
  }

  res.json(result);
}));

/**
 * DELETE /api/v1/devices/:id/share/user/:targetUserId
 * Remove a user's access to device (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const { id, targetUserId } = req.params;
  const ownerId = req.user!.userId;

  const result = await removeUserFromDevice(id, targetUserId, ownerId);

  if (!result.success) {
    throw new InvalidInputError(result.message);
  }

  res.json(result);
}));

/**
 * POST /api/v1/devices/:id/share/group
 * Share device with a group or remove group access (owner only)
 */
router.post('/:id/share/group', requireDeviceAccess('owner'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ownerId = req.user!.userId;
  const { groupId } = req.body; // null to remove group access

  const result = await shareDeviceWithGroup(id, groupId, ownerId);

  if (!result.success) {
    throw new InvalidInputError(result.message);
  }

  res.json(result);
}));

export default router;
