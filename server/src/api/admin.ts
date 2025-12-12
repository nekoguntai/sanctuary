/**
 * Admin API Routes
 *
 * Admin-only endpoints for system configuration, user management, and group management
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../models/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { testNodeConfig, resetNodeClient, NodeConfig } from '../services/bitcoin/nodeClient';

const router = Router();

/**
 * GET /api/v1/admin/node-config
 * Get the global node configuration (admin only)
 */
router.get('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Get the default node config
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (!nodeConfig) {
      // Return default configuration if none exists - use public Blockstream server
      return res.json({
        type: 'electrum',
        host: 'electrum.blockstream.info',
        port: '50002',
        useSsl: true,
        user: null,
        password: null,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space',
      });
    }

    res.json({
      type: nodeConfig.type,
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      user: nodeConfig.username,
      password: nodeConfig.password,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
    });
  } catch (error) {
    console.error('[ADMIN] Get node config error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get node configuration',
    });
  }
});

/**
 * PUT /api/v1/admin/node-config
 * Update the global node configuration (admin only)
 */
router.put('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    console.log('[ADMIN] PUT /node-config request body:', req.body);
    const { type, host, port, useSsl, user, password, explorerUrl, feeEstimatorUrl } = req.body;

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    if (type !== 'electrum' && type !== 'bitcoind') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type must be either "electrum" or "bitcoind"',
      });
    }

    // Check if a default config exists
    const existingConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    let nodeConfig;

    if (existingConfig) {
      // Update existing config
      nodeConfig = await prisma.nodeConfig.update({
        where: { id: existingConfig.id },
        data: {
          type,
          host,
          port: parseInt(port.toString(), 10),
          useSsl: useSsl === true,
          username: user || null,
          password: password || null,
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new config
      nodeConfig = await prisma.nodeConfig.create({
        data: {
          id: 'default',
          type,
          host,
          port: parseInt(port.toString(), 10),
          useSsl: useSsl === true,
          username: user || null,
          password: password || null,
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          isDefault: true,
        },
      });
    }

    console.log('[ADMIN] Node config updated:', { type, host, port });

    // Reset the active node client so it reconnects with new config
    resetNodeClient();

    res.json({
      type: nodeConfig.type,
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      user: nodeConfig.username,
      password: nodeConfig.password,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
      message: 'Node configuration updated successfully. Backend will reconnect on next request.',
    });
  } catch (error) {
    console.error('[ADMIN] Update node config error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update node configuration',
    });
  }
});

/**
 * POST /api/v1/admin/node-config/test
 * Test connection to node with provided configuration (admin only)
 */
router.post('/node-config/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, host, port, useSsl, user, password } = req.body;

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    if (type !== 'electrum' && type !== 'bitcoind') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Type must be either "electrum" or "bitcoind"',
      });
    }

    // Build config for testing
    const testConfig: NodeConfig = {
      type: type === 'bitcoind' ? 'bitcoind' : 'electrum',
      host,
      port: parseInt(port.toString(), 10),
      protocol: useSsl ? 'ssl' : 'tcp',
      user: user || undefined,
      password: password || undefined,
      ssl: useSsl === true,
    };

    // Test the connection using the nodeClient abstraction
    const result = await testNodeConfig(testConfig);

    if (result.success) {
      res.json({
        success: true,
        blockHeight: result.info?.blockHeight,
        message: result.message,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Connection Failed',
        message: result.message,
      });
    }
  } catch (error: any) {
    console.error('[ADMIN] Test connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'Failed to test node connection',
    });
  }
});

// ========================================
// USER MANAGEMENT
// ========================================

/**
 * GET /api/v1/admin/users
 * Get all users (admin only)
 */
router.get('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
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
    console.error('[ADMIN] Get users error:', error);
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
router.post('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
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

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 6 characters',
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

    console.log('[ADMIN] User created:', { username, isAdmin: isAdmin === true });

    res.status(201).json(user);
  } catch (error) {
    console.error('[ADMIN] Create user error:', error);
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
router.put('/users/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
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
    const updateData: any = {};

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
      if (password.length < 6) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Password must be at least 6 characters',
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

    console.log('[ADMIN] User updated:', { userId, changes: Object.keys(updateData) });

    res.json(user);
  } catch (error) {
    console.error('[ADMIN] Update user error:', error);
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
router.delete('/users/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).user;

    // Prevent self-deletion
    if (userId === currentUser.id) {
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

    console.log('[ADMIN] User deleted:', { userId, username: existingUser.username });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('[ADMIN] Delete user error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete user',
    });
  }
});

// ========================================
// GROUP MANAGEMENT
// ========================================

/**
 * GET /api/v1/admin/groups
 * Get all groups (admin only)
 */
router.get('/groups', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const groups = await prisma.group.findMany({
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to simpler format
    const result = groups.map(group => ({
      id: group.id,
      name: group.name,
      description: group.description,
      purpose: group.purpose,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      members: group.members.map(m => ({
        userId: m.userId,
        username: m.user.username,
        role: m.role,
      })),
    }));

    res.json(result);
  } catch (error) {
    console.error('[ADMIN] Get groups error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get groups',
    });
  }
});

/**
 * POST /api/v1/admin/groups
 * Create a new group (admin only)
 */
router.post('/groups', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, purpose, memberIds } = req.body;
    const currentUser = (req as any).user;

    // Validation
    if (!name) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Group name is required',
      });
    }

    // Create group
    const group = await prisma.group.create({
      data: {
        name,
        description: description || null,
        purpose: purpose || null,
      },
    });

    // Add members if provided
    if (memberIds && Array.isArray(memberIds)) {
      for (const userId of memberIds) {
        // Check if user exists
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (userExists) {
          await prisma.groupMember.create({
            data: {
              groupId: group.id,
              userId,
              role: 'member',
            },
          });
        }
      }
    }

    // Fetch the complete group with members
    const completeGroup = await prisma.group.findUnique({
      where: { id: group.id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });

    console.log('[ADMIN] Group created:', { name, id: group.id });

    res.status(201).json({
      id: completeGroup!.id,
      name: completeGroup!.name,
      description: completeGroup!.description,
      purpose: completeGroup!.purpose,
      createdAt: completeGroup!.createdAt,
      members: completeGroup!.members.map(m => ({
        userId: m.userId,
        username: m.user.username,
        role: m.role,
      })),
    });
  } catch (error) {
    console.error('[ADMIN] Create group error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create group',
    });
  }
});

/**
 * PUT /api/v1/admin/groups/:groupId
 * Update a group (admin only)
 * Supports updating name, description, purpose, and memberIds (replaces all members)
 */
router.put('/groups/:groupId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { name, description, purpose, memberIds } = req.body;

    // Check if group exists
    const existingGroup = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });

    if (!existingGroup) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Group not found',
      });
    }

    // Update group basic info
    await prisma.group.update({
      where: { id: groupId },
      data: {
        name: name || existingGroup.name,
        description: description !== undefined ? description : existingGroup.description,
        purpose: purpose !== undefined ? purpose : existingGroup.purpose,
      },
    });

    // Update members if provided
    if (memberIds !== undefined && Array.isArray(memberIds)) {
      // Get current member IDs
      const currentMemberIds = existingGroup.members.map(m => m.userId);

      // Members to add (in new list but not in current)
      const toAdd = memberIds.filter((id: string) => !currentMemberIds.includes(id));

      // Members to remove (in current but not in new list)
      const toRemove = currentMemberIds.filter(id => !memberIds.includes(id));

      // Remove members
      if (toRemove.length > 0) {
        await prisma.groupMember.deleteMany({
          where: {
            groupId,
            userId: { in: toRemove },
          },
        });
      }

      // Add new members
      for (const userId of toAdd) {
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (userExists) {
          await prisma.groupMember.create({
            data: {
              groupId,
              userId,
              role: 'member',
            },
          });
        }
      }
    }

    // Fetch updated group with members
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });

    console.log('[ADMIN] Group updated:', { groupId, name: group!.name });

    res.json({
      id: group!.id,
      name: group!.name,
      description: group!.description,
      purpose: group!.purpose,
      createdAt: group!.createdAt,
      updatedAt: group!.updatedAt,
      members: group!.members.map(m => ({
        userId: m.userId,
        username: m.user.username,
        role: m.role,
      })),
    });
  } catch (error) {
    console.error('[ADMIN] Update group error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update group',
    });
  }
});

/**
 * DELETE /api/v1/admin/groups/:groupId
 * Delete a group (admin only)
 */
router.delete('/groups/:groupId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    // Check if group exists
    const existingGroup = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!existingGroup) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Group not found',
      });
    }

    // Delete group (members will be cascade deleted)
    await prisma.group.delete({
      where: { id: groupId },
    });

    console.log('[ADMIN] Group deleted:', { groupId, name: existingGroup.name });

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('[ADMIN] Delete group error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete group',
    });
  }
});

/**
 * POST /api/v1/admin/groups/:groupId/members
 * Add a member to a group (admin only)
 */
router.post('/groups/:groupId/members', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { userId, role } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'User ID is required',
      });
    }

    // Check if group exists
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Group not found',
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Check if already a member
    const existingMembership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (existingMembership) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'User is already a member of this group',
      });
    }

    // Add member
    const membership = await prisma.groupMember.create({
      data: {
        groupId,
        userId,
        role: role || 'member',
      },
    });

    console.log('[ADMIN] Member added to group:', { groupId, userId, role: membership.role });

    res.status(201).json({
      userId,
      username: user.username,
      role: membership.role,
    });
  } catch (error) {
    console.error('[ADMIN] Add group member error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add member to group',
    });
  }
});

/**
 * DELETE /api/v1/admin/groups/:groupId/members/:userId
 * Remove a member from a group (admin only)
 */
router.delete('/groups/:groupId/members/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.params;

    // Check if membership exists
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    if (!membership) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Member not found in this group',
      });
    }

    // Remove member
    await prisma.groupMember.delete({
      where: {
        userId_groupId: { userId, groupId },
      },
    });

    console.log('[ADMIN] Member removed from group:', { groupId, userId });

    res.json({ message: 'Member removed from group successfully' });
  } catch (error) {
    console.error('[ADMIN] Remove group member error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove member from group',
    });
  }
});

export default router;
