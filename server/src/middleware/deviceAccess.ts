/**
 * Device Access Middleware
 *
 * Middleware to verify user has appropriate access level to a device
 */

import { Request, Response, NextFunction } from 'express';
import {
  checkDeviceAccess,
  checkDeviceOwnerAccess,
  getUserDeviceRole,
  DeviceRole,
} from '../services/deviceAccess';
import { createLogger } from '../utils/logger';

const log = createLogger('DEVICE_ACCESS');

// Extend Express Request type to include device info
declare global {
  namespace Express {
    interface Request {
      deviceId?: string;
      deviceRole?: DeviceRole;
    }
  }
}

export type DeviceAccessLevel = 'view' | 'owner';

/**
 * Middleware factory to require a specific access level to a device
 *
 * Usage:
 *   router.get('/:id', authenticate, requireDeviceAccess('view'), handler);
 *   router.patch('/:id', authenticate, requireDeviceAccess('owner'), handler);
 *   router.delete('/:id', authenticate, requireDeviceAccess('owner'), handler);
 *
 * @param level - 'view' (any access), 'owner' (owner only)
 */
export function requireDeviceAccess(level: DeviceAccessLevel = 'view') {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Get device ID from route params (supports both :id and :deviceId)
    const deviceId = req.params.deviceId || req.params.id;
    const userId = req.user?.userId;

    if (!deviceId) {
      log.warn('Device access check failed: no device ID', { path: req.path });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Device ID is required',
      });
    }

    if (!userId) {
      log.warn('Device access check failed: no user ID', { deviceId });
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
          hasAccess = await checkDeviceOwnerAccess(deviceId, userId);
          break;
        case 'view':
        default:
          hasAccess = await checkDeviceAccess(deviceId, userId);
          break;
      }

      if (!hasAccess) {
        log.warn('Device access denied', { deviceId, userId, requiredLevel: level });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to access this device',
        });
      }

      // Attach device info to request for use in handlers
      req.deviceId = deviceId;

      // Optionally get and attach the user's role for the handler
      const role = await getUserDeviceRole(deviceId, userId);
      req.deviceRole = role;

      next();
    } catch (error) {
      log.error('Device access check error', { deviceId, userId, error });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify device access',
      });
    }
  };
}

/**
 * Helper to check access inline within a handler (for conditional logic)
 * Returns the user's role or null if no access
 */
export async function getDeviceAccessRole(
  deviceId: string,
  userId: string
): Promise<DeviceRole> {
  return getUserDeviceRole(deviceId, userId);
}
