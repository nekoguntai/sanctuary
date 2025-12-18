/**
 * Push Notification API Routes
 *
 * Handles device token registration for iOS (APNs) and Android (FCM) push notifications.
 * Mobile apps call these endpoints to register/unregister their device tokens.
 *
 * ## Architecture Overview
 *
 * The push notification system has two main components:
 *
 * 1. **Backend (this file)** - Stores device tokens in PostgreSQL, manages registration
 * 2. **Gateway** - Connects to FCM/APNs and sends actual push notifications
 *
 * ## Flow
 *
 * 1. Mobile app authenticates with backend via gateway
 * 2. App calls POST /api/v1/push/register with its FCM/APNs token
 * 3. Token is stored in PushDevice table
 * 4. When a transaction occurs, backend emits WebSocket event
 * 5. Gateway receives event, fetches user's devices via internal endpoint
 * 6. Gateway sends push notification via FCM (Android) or APNs (iOS)
 *
 * ## Internal Endpoints
 *
 * Some endpoints are internal (X-Gateway-Request: true) and not exposed to mobile apps:
 * - GET /api/v1/push/by-user/:userId - Fetch devices for gateway push delivery
 *
 * ## Security
 *
 * - All user-facing endpoints require JWT authentication
 * - Internal endpoints check X-Gateway-Request header
 * - Device tokens are only modifiable by the owning user
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

/**
 * GET /api/v1/push/by-user/:userId
 *
 * INTERNAL ENDPOINT - Called by gateway to fetch devices for push notification delivery.
 * This endpoint is NOT proxied to mobile apps (blocked by gateway whitelist).
 *
 * The gateway uses this when it receives a transaction event from the backend WebSocket
 * and needs to know which devices to send push notifications to.
 *
 * Security: Requires X-Gateway-Request header (set by gateway)
 */
router.get('/by-user/:userId', async (req: Request, res: Response) => {
  try {
    // Only allow internal gateway requests
    if (req.headers['x-gateway-request'] !== 'true') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint is for internal gateway use only',
      });
    }

    const { userId } = req.params;

    const devices = await prisma.pushDevice.findMany({
      where: { userId },
      select: {
        id: true,
        token: true,
        platform: true,
        userId: true,
      },
    });

    // Map to gateway's expected format
    res.json(
      devices.map((d) => ({
        id: d.id,
        platform: d.platform,
        pushToken: d.token,
        userId: d.userId,
      }))
    );
  } catch (error) {
    log.error('Fetch devices by user error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch devices',
    });
  }
});

/**
 * POST /api/v1/push/gateway-audit
 *
 * INTERNAL ENDPOINT - Called by gateway to log security/audit events.
 * This allows the gateway to store audit logs in the backend database
 * for centralized monitoring and admin visibility.
 *
 * Security: Requires X-Gateway-Request header (set by gateway)
 *
 * Request body:
 *   - event: string - Event type (e.g., AUTH_INVALID_TOKEN, RATE_LIMIT_EXCEEDED)
 *   - category: string - Event category (gateway, auth, security)
 *   - severity: string - Event severity (low, medium, high)
 *   - details: object - Additional event details
 *   - ip: string - Client IP address
 *   - userAgent: string - Client user agent
 *   - userId: string (optional) - User ID if authenticated
 *   - username: string (optional) - Username if known
 */
router.post('/gateway-audit', async (req: Request, res: Response) => {
  try {
    // Only allow internal gateway requests
    if (req.headers['x-gateway-request'] !== 'true') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint is for internal gateway use only',
      });
    }

    const {
      event,
      category,
      severity,
      details,
      ip,
      userAgent,
      userId,
      username,
    } = req.body;

    // Validate required fields
    if (!event) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Event type is required',
      });
    }

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        username: username || 'gateway',
        action: `gateway.${event.toLowerCase()}`,
        category: category || 'gateway',
        details: {
          ...(details || {}),
          severity: severity || 'info',
          source: 'gateway',
        },
        ipAddress: ip || null,
        userAgent: userAgent || null,
        success: !event.includes('FAILED') && !event.includes('EXCEEDED') && !event.includes('BLOCKED'),
        errorMsg: event.includes('FAILED') || event.includes('EXCEEDED') || event.includes('BLOCKED')
          ? event
          : null,
      },
    });

    log.debug('Gateway audit event logged', { event, category });
    res.json({ success: true });
  } catch (error) {
    log.error('Gateway audit log error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to log audit event',
    });
  }
});

export default router;
