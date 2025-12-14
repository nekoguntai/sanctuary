/**
 * Push Notification API Routes
 *
 * Handles device token registration for iOS (APNs) and Android (FCM) push notifications.
 * Mobile apps call these endpoints to register/unregister their device tokens.
 */

import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { authenticate } from '../middleware/auth';
import { createLogger } from '../utils/logger';

const router = Router();
const log = createLogger('PUSH-API');

/**
 * POST /api/v1/push/register
 * Register a device token for push notifications
 */
router.post('/register', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { token, platform, deviceName } = req.body;

    // Validation
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Device token is required',
      });
    }

    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Platform must be "ios" or "android"',
      });
    }

    // Check if token already exists
    const existing = await prisma.pushDevice.findUnique({
      where: { token },
    });

    if (existing) {
      // If same user, just update last used time
      if (existing.userId === userId) {
        await prisma.pushDevice.update({
          where: { id: existing.id },
          data: {
            lastUsedAt: new Date(),
            deviceName: deviceName || existing.deviceName,
          },
        });
        return res.json({
          success: true,
          deviceId: existing.id,
          message: 'Device token updated',
        });
      }

      // If different user, reassign token to new user
      // This handles the case where a device is signed out and signed in with a different account
      await prisma.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId,
          lastUsedAt: new Date(),
          deviceName: deviceName || null,
        },
      });
      log.info(`Reassigned push device ${existing.id} from user ${existing.userId} to ${userId}`);
      return res.json({
        success: true,
        deviceId: existing.id,
        message: 'Device token reassigned',
      });
    }

    // Create new device registration
    const device = await prisma.pushDevice.create({
      data: {
        userId,
        token,
        platform,
        deviceName: deviceName || null,
      },
    });

    log.info(`Registered ${platform} device for user ${userId}`);
    res.json({
      success: true,
      deviceId: device.id,
      message: 'Device registered for push notifications',
    });
  } catch (error) {
    log.error('Register device error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register device',
    });
  }
});

/**
 * DELETE /api/v1/push/unregister
 * Remove a device token (called when user signs out of mobile app)
 */
router.delete('/unregister', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Device token is required',
      });
    }

    // Find and delete the device (only if owned by this user)
    const device = await prisma.pushDevice.findFirst({
      where: {
        token,
        userId,
      },
    });

    if (!device) {
      // Token not found or not owned by user - still return success
      // This is idempotent behavior for sign-out scenarios
      return res.json({
        success: true,
        message: 'Device token removed',
      });
    }

    await prisma.pushDevice.delete({
      where: { id: device.id },
    });

    log.info(`Unregistered ${device.platform} device for user ${userId}`);
    res.json({
      success: true,
      message: 'Device token removed',
    });
  } catch (error) {
    log.error('Unregister device error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to unregister device',
    });
  }
});

/**
 * GET /api/v1/push/devices
 * List all registered devices for the current user
 */
router.get('/devices', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const devices = await prisma.pushDevice.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        deviceName: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    res.json({
      devices: devices.map((d) => ({
        id: d.id,
        platform: d.platform,
        deviceName: d.deviceName,
        lastUsedAt: d.lastUsedAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    log.error('List devices error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list devices',
    });
  }
});

/**
 * DELETE /api/v1/push/devices/:id
 * Remove a specific device by ID
 */
router.delete('/devices/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // Find device (must be owned by user)
    const device = await prisma.pushDevice.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    await prisma.pushDevice.delete({
      where: { id },
    });

    log.info(`Removed ${device.platform} device ${id} for user ${userId}`);
    res.json({
      success: true,
      message: 'Device removed',
    });
  } catch (error) {
    log.error('Delete device error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete device',
    });
  }
});

export default router;
