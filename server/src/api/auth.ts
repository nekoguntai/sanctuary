/**
 * Authentication API Routes
 *
 * Handles user authentication (login, register, etc.)
 */

import { Router, Request, Response } from 'express';
import prisma from '../models/prisma';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * POST /api/v1/auth/register
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, email } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Username already exists',
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user with default preferences
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        email,
        preferences: {
          darkMode: true,
          theme: 'sanctuary',
          background: 'zen',
          unit: 'sats',
          fiatCurrency: 'USD',
          showFiat: true,
          priceProvider: 'auto',
        },
      },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        preferences: user.preferences,
      },
    });
  } catch (error) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register user',
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Login existing user
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        preferences: user.preferences,
      },
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to login',
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Get current authenticated user
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
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
      },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    res.json(user);
  } catch (error) {
    console.error('[AUTH] Get me error:', error);
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
router.patch('/me/preferences', authenticate, async (req: Request, res: Response) => {
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
        preferences: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('[AUTH] Update preferences error:', error);
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
router.get('/me/groups', authenticate, async (req: Request, res: Response) => {
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
    console.error('[AUTH] Get user groups error:', error);
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
router.get('/users/search', authenticate, async (req: Request, res: Response) => {
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
    console.error('[AUTH] Search users error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search users',
    });
  }
});

/**
 * POST /api/v1/auth/me/change-password
 * Change user password
 */
router.post('/me/change-password', authenticate, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be at least 6 characters',
      });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);

    if (!isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
      },
    });

    res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('[AUTH] Change password error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to change password',
    });
  }
});

export default router;
