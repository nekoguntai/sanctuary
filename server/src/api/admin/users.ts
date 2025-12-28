/**
 * Admin Users Router
 *
 * Endpoints for user management (admin only)
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../models/prisma';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { validatePasswordStrength } from '../../utils/password';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';

const router = Router();
const log = createLogger('ADMIN:USERS');

/**
 * GET /api/v1/admin/users
 * Get all users (admin only)
 */
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (error) {
    log.error('Get users error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get users',
    });
  }
});

/**
 * POST /api/v1/admin/users
 * Create a new user (admin only)
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { username, password, email, isAdmin } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username must be at least 3 characters',
      });
    }

    // Validate password strength using the same rules as user registration
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password does not meet security requirements',
        details: passwordValidation.errors,
      });
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Username already exists',
      });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Email already exists',
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        email: email || null,
        isAdmin: isAdmin === true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        createdAt: true,
      },
    });

    log.info('User created:', { username, isAdmin: isAdmin === true });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.USER_CREATE, AuditCategory.USER, {
      details: { targetUser: username, isAdmin: isAdmin === true },
    });

    res.status(201).json(user);
  } catch (error) {
    log.error('Create user error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create user',
    });
  }
});

/**
 * PUT /api/v1/admin/users/:userId
 * Update a user (admin only)
 */
router.put('/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { username, password, email, isAdmin } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (username && username !== existingUser.username) {
      // Check if new username is taken
      const usernameTaken = await prisma.user.findUnique({
        where: { username },
      });
      if (usernameTaken) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Username already exists',
        });
      }
      updateData.username = username;
    }

    if (email !== undefined) {
      if (email && email !== existingUser.email) {
        // Check if new email is taken
        const emailTaken = await prisma.user.findUnique({
          where: { email },
        });
        if (emailTaken) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Email already exists',
          });
        }
      }
      updateData.email = email || null;
    }

    if (password) {
      // Validate password strength using the same rules as user registration
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password does not meet security requirements',
          details: passwordValidation.errors,
        });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (isAdmin !== undefined) {
      updateData.isAdmin = isAdmin === true;
    }

    // Update user
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    log.info('User updated:', { userId, changes: Object.keys(updateData) });

    // Audit log - check for admin role changes
    if ('isAdmin' in updateData) {
      await auditService.logFromRequest(
        req,
        updateData.isAdmin ? AuditAction.USER_ADMIN_GRANT : AuditAction.USER_ADMIN_REVOKE,
        AuditCategory.USER,
        { details: { targetUser: user.username, userId } }
      );
    } else {
      await auditService.logFromRequest(req, AuditAction.USER_UPDATE, AuditCategory.USER, {
        details: { targetUser: user.username, userId, changes: Object.keys(updateData) },
      });
    }

    res.json(user);
  } catch (error) {
    log.error('Update user error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update user',
    });
  }
});

/**
 * DELETE /api/v1/admin/users/:userId
 * Delete a user (admin only)
 */
router.delete('/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user;

    // Prevent self-deletion
    if (userId === currentUser?.userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot delete your own account',
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Delete user
    await prisma.user.delete({
      where: { id: userId },
    });

    log.info('User deleted:', { userId, username: existingUser.username });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.USER_DELETE, AuditCategory.USER, {
      details: { targetUser: existingUser.username, userId },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    log.error('Delete user error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete user',
    });
  }
});

export default router;
