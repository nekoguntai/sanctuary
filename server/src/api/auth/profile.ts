/**
 * Auth - Profile Router
 *
 * Endpoints for user profile and preferences management
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('AUTH:PROFILE');

/**
 * GET /api/v1/auth/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        preferences: true,
        createdAt: true,
        twoFactorEnabled: true,
        password: true, // Need this to check default password
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Check if user is still using the initial password
    // We check by looking for the initial password marker in system settings
    const initialPasswordSetting = await prisma.systemSetting.findUnique({
      where: { key: `initialPassword_${user.id}` },
    });
    const usingDefaultPassword = initialPasswordSetting?.value === user.password;

    // Don't send the password hash to the client
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      ...userWithoutPassword,
      usingDefaultPassword,
    });
  } catch (error) {
    log.error('Get me error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user',
    });
  }
});

/**
 * PATCH /api/v1/auth/me/preferences
 * Update user preferences
 */
router.patch('/me/preferences', async (req: Request, res: Response) => {
  try {
    const newPreferences = req.body;

    // Default preferences for new users or those with null preferences
    const defaultPreferences = {
      darkMode: true,
      theme: 'sanctuary',
      background: 'zen',
      unit: 'sats',
      fiatCurrency: 'USD',
      showFiat: true,
      priceProvider: 'auto',
      notificationSounds: {
        enabled: true,
        volume: 50,
        confirmation: { enabled: true, sound: 'chime' },
        receive: { enabled: true, sound: 'coin' },
        send: { enabled: true, sound: 'success' },
      },
    };

    // First get current preferences to merge with
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { preferences: true },
    });

    // Merge: defaults -> existing preferences -> new preferences
    const mergedPreferences = {
      ...defaultPreferences,
      ...(currentUser?.preferences as object || {}),
      ...newPreferences,
    };

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        preferences: mergedPreferences,
      },
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        preferences: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    log.error('Update preferences error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update preferences',
    });
  }
});

/**
 * GET /api/v1/auth/me/groups
 * Get groups the current user is a member of
 */
router.get('/me/groups', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const groups = await prisma.group.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        members: {
          select: {
            userId: true,
            role: true,
          },
        },
      },
    });

    res.json(groups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: g.members.length,
      memberIds: g.members.map(m => m.userId),
    })));
  } catch (error) {
    log.error('Get user groups error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get groups',
    });
  }
});

/**
 * GET /api/v1/auth/users/search
 * Search users by username (for sharing)
 */
router.get('/users/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Search query must be at least 2 characters',
      });
    }

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: q,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
      },
      take: 10,
    });

    res.json(users);
  } catch (error) {
    log.error('Search users error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search users',
    });
  }
});

export default router;
