/**
 * Device Access Middleware
 *
 * Middleware to verify user has appropriate access level to a device.
 * Thin wrapper around the generic resource access middleware factory.
 */

import { Request } from 'express';
import {
  checkDeviceAccess,
  checkDeviceOwnerAccess,
  getUserDeviceRole,
  DeviceRole,
} from '../services/deviceAccess';
import { createResourceAccessMiddleware } from './resourceAccess';

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

export const requireDeviceAccess = createResourceAccessMiddleware<DeviceAccessLevel>({
  resourceName: 'Device',
  loggerName: 'MW:DEVICE_ACCESS',
  paramNames: ['deviceId', 'id'],
  checks: {
    view: checkDeviceAccess,
    owner: checkDeviceOwnerAccess,
  },
  getRole: getUserDeviceRole,
  attachToRequest: (req: Request, id: string, role: unknown) => {
    req.deviceId = id;
    req.deviceRole = role as DeviceRole;
  },
});

/**
 * Helper to check access inline within a handler (for conditional logic)
 * Returns the user's role or null if no access
 */
export async function getDeviceAccessRole(
  deviceId: string,
  userId: string,
): Promise<DeviceRole> {
  return getUserDeviceRole(deviceId, userId);
}
