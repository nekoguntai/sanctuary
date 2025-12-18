/**
 * Admin API Routes
 *
 * Admin-only endpoints for system configuration, user management, and group management
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../models/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { testNodeConfig, resetNodeClient, NodeConfig } from '../services/bitcoin/nodeClient';
import { createLogger } from '../utils/logger';
import { encrypt } from '../utils/encryption';

const router = Router();
const log = createLogger('ADMIN');

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
        hasPassword: false,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space',
        mempoolEstimator: 'simple',
      });
    }

    res.json({
      type: nodeConfig.type,
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      user: nodeConfig.username,
      hasPassword: !!nodeConfig.password,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
      mempoolEstimator: nodeConfig.mempoolEstimator || 'simple',
    });
  } catch (error) {
    log.error('[ADMIN] Get node config error', { error: String(error) });
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
    const { type, host, port, useSsl, user, password, explorerUrl, feeEstimatorUrl, mempoolEstimator } = req.body;
    // Log non-sensitive fields only (password excluded)
    log.info('[ADMIN] PUT /node-config', { type, host, port, useSsl, hasPassword: !!password, mempoolEstimator });

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

    // Validate mempoolEstimator if provided
    const validEstimators = ['simple', 'mempool_space'];
    const estimator = mempoolEstimator && validEstimators.includes(mempoolEstimator) ? mempoolEstimator : 'simple';

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
          password: password ? encrypt(password) : null,
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          mempoolEstimator: estimator,
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
          password: password ? encrypt(password) : null,
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          mempoolEstimator: estimator,
          isDefault: true,
        },
      });
    }

    log.info('[ADMIN] Node config updated:', { type, host, port });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.NODE_CONFIG_UPDATE, AuditCategory.ADMIN, {
      details: { type, host, port },
    });

    // Reset the active node client so it reconnects with new config
    resetNodeClient();

    res.json({
      type: nodeConfig.type,
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      user: nodeConfig.username,
      hasPassword: !!nodeConfig.password,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
      mempoolEstimator: nodeConfig.mempoolEstimator || 'simple',
      message: 'Node configuration updated successfully. Backend will reconnect on next request.',
    });
  } catch (error) {
    log.error('[ADMIN] Update node config error', { error: String(error) });
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
    log.error('[ADMIN] Test connection error', { error: String(error) });
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
    log.error('[ADMIN] Get users error', { error: String(error) });
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

    log.info('[ADMIN] User created:', { username, isAdmin: isAdmin === true });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.USER_CREATE, AuditCategory.USER, {
      details: { targetUser: username, isAdmin: isAdmin === true },
    });

    res.status(201).json(user);
  } catch (error) {
    log.error('[ADMIN] Create user error', { error: String(error) });
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

    log.info('[ADMIN] User updated:', { userId, changes: Object.keys(updateData) });

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
    log.error('[ADMIN] Update user error', { error: String(error) });
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

    log.info('[ADMIN] User deleted:', { userId, username: existingUser.username });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.USER_DELETE, AuditCategory.USER, {
      details: { targetUser: existingUser.username, userId },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    log.error('[ADMIN] Delete user error', { error: String(error) });
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
    log.error('[ADMIN] Get groups error', { error: String(error) });
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

    // Add members if provided (batch operation to avoid N+1 queries)
    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      // Batch load all users to check existence in a single query
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true },
      });
      const validUserIds = new Set(existingUsers.map(u => u.id));

      // Batch create all valid members
      await prisma.groupMember.createMany({
        data: memberIds
          .filter(id => validUserIds.has(id))
          .map(userId => ({
            groupId: group.id,
            userId,
            role: 'member',
          })),
        skipDuplicates: true,
      });
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

    log.info('[ADMIN] Group created:', { name, id: group.id });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.GROUP_CREATE, AuditCategory.ADMIN, {
      details: { groupName: name, groupId: group.id, memberCount: memberIds?.length || 0 },
    });

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
    log.error('[ADMIN] Create group error', { error: String(error) });
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

      // Add new members (batch operation to avoid N+1 queries)
      if (toAdd.length > 0) {
        // Batch load all users to check existence in a single query
        const existingUsers = await prisma.user.findMany({
          where: { id: { in: toAdd } },
          select: { id: true },
        });
        const validUserIds = new Set(existingUsers.map(u => u.id));

        // Batch create all valid members
        await prisma.groupMember.createMany({
          data: toAdd
            .filter(id => validUserIds.has(id))
            .map(userId => ({
              groupId,
              userId,
              role: 'member',
            })),
          skipDuplicates: true,
        });
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

    log.info('[ADMIN] Group updated:', { groupId, name: group!.name });

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
    log.error('[ADMIN] Update group error', { error: String(error) });
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

    log.info('[ADMIN] Group deleted:', { groupId, name: existingGroup.name });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.GROUP_DELETE, AuditCategory.ADMIN, {
      details: { groupName: existingGroup.name, groupId },
    });

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    log.error('[ADMIN] Delete group error', { error: String(error) });
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

    log.info('[ADMIN] Member added to group:', { groupId, userId, role: membership.role });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_ADD, AuditCategory.ADMIN, {
      details: { groupId, targetUser: user.username, role: membership.role },
    });

    res.status(201).json({
      userId,
      username: user.username,
      role: membership.role,
    });
  } catch (error) {
    log.error('[ADMIN] Add group member error', { error: String(error) });
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

    log.info('[ADMIN] Member removed from group:', { groupId, userId });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_REMOVE, AuditCategory.ADMIN, {
      details: { groupId, userId },
    });

    res.json({ message: 'Member removed from group successfully' });
  } catch (error) {
    log.error('[ADMIN] Remove group member error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove member from group',
    });
  }
});

// ========================================
// SYSTEM SETTINGS
// ========================================

/**
 * GET /api/v1/admin/settings
 * Get all system settings (admin only)
 */
router.get('/settings', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany();

    // Convert to key-value object with parsed JSON values
    const settingsObj: Record<string, any> = {};
    for (const setting of settings) {
      try {
        settingsObj[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObj[setting.key] = setting.value;
      }
    }

    // Return defaults for any missing settings
    res.json({
      registrationEnabled: false, // Default to disabled (admin-only)
      confirmationThreshold: 3, // Default confirmations required
      ...settingsObj,
    });
  } catch (error) {
    log.error('[ADMIN] Get settings error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get system settings',
    });
  }
});

/**
 * PUT /api/v1/admin/settings
 * Update system settings (admin only)
 */
router.put('/settings', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const updates = req.body;

    // Validate and update each setting
    for (const [key, value] of Object.entries(updates)) {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: JSON.stringify(value) },
        create: { key, value: JSON.stringify(value) },
      });
    }

    log.info('[ADMIN] Settings updated:', Object.keys(updates));

    // Audit log
    await auditService.logFromRequest(req, AuditAction.SYSTEM_SETTING_UPDATE, AuditCategory.SYSTEM, {
      details: { settings: Object.keys(updates) },
    });

    // Return updated settings
    const settings = await prisma.systemSetting.findMany();
    const settingsObj: Record<string, any> = {
      registrationEnabled: false, // Default to disabled (admin-only)
      confirmationThreshold: 3, // Default confirmations required
    };
    for (const setting of settings) {
      try {
        settingsObj[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObj[setting.key] = setting.value;
      }
    }

    res.json(settingsObj);
  } catch (error) {
    log.error('[ADMIN] Update settings error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update system settings',
    });
  }
});

// ========================================
// BACKUP & RESTORE
// ========================================

import { backupService, SanctuaryBackup } from '../services/backupService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../services/auditService';

/**
 * POST /api/v1/admin/backup
 * Create a database backup (admin only)
 *
 * Request body:
 *   - includeCache: boolean (optional) - Include price/fee cache tables
 *   - description: string (optional) - Backup description
 *
 * Response: JSON file download
 */
router.post('/backup', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { includeCache, description } = req.body;
    const adminUser = req.user?.username || 'unknown';

    log.info('[ADMIN] Creating backup', { adminUser, includeCache });

    const backup = await backupService.createBackup(adminUser, {
      includeCache: includeCache === true,
      description,
    });

    // Audit log
    const totalRecords = Object.values(backup.meta.recordCounts).reduce((a, b) => a + b, 0);
    await auditService.logFromRequest(req, AuditAction.BACKUP_CREATE, AuditCategory.BACKUP, {
      details: {
        tables: Object.keys(backup.data).length,
        records: totalRecords,
        includeCache: includeCache === true,
      },
    });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString()
      .slice(0, 19)
      .replace(/[T:]/g, '-');
    const filename = `sanctuary-backup-${timestamp}.json`;

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json(backup);
  } catch (error) {
    log.error('[ADMIN] Backup creation failed', { error: String(error) });
    res.status(500).json({
      error: 'Backup Failed',
      message: 'Failed to create database backup',
    });
  }
});

/**
 * POST /api/v1/admin/backup/validate
 * Validate a backup file (admin only)
 *
 * Request body:
 *   - backup: SanctuaryBackup - The backup to validate
 *
 * Response: ValidationResult
 */
router.post('/backup/validate', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { backup } = req.body;

    if (!backup) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing backup data',
      });
    }

    const validation = await backupService.validateBackup(backup);
    res.json(validation);
  } catch (error) {
    log.error('[ADMIN] Backup validation failed', { error: String(error) });
    res.status(400).json({
      error: 'Validation Failed',
      message: 'Failed to validate backup file',
    });
  }
});

/**
 * POST /api/v1/admin/restore
 * Restore database from backup (admin only)
 *
 * WARNING: This will DELETE ALL existing data and replace with backup data.
 *
 * Request body:
 *   - backup: SanctuaryBackup - The backup to restore
 *   - confirmationCode: string - Must be "CONFIRM_RESTORE" to proceed
 *
 * Response: RestoreResult
 */
router.post('/restore', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { backup, confirmationCode } = req.body;
    const adminUser = req.user?.username || 'unknown';

    // Require explicit confirmation
    if (confirmationCode !== 'CONFIRM_RESTORE') {
      return res.status(400).json({
        error: 'Confirmation Required',
        message: 'To restore from backup, send confirmationCode: "CONFIRM_RESTORE" in the request body. WARNING: This will delete all existing data.',
      });
    }

    if (!backup) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing backup data',
      });
    }

    // Validate before restore
    const validation = await backupService.validateBackup(backup);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid Backup',
        message: 'Backup validation failed',
        issues: validation.issues,
      });
    }

    log.info('[ADMIN] Starting restore', {
      adminUser,
      backupDate: backup.meta?.createdAt,
      backupCreatedBy: backup.meta?.createdBy,
    });

    // Perform restore
    const result = await backupService.restoreFromBackup(backup as SanctuaryBackup);

    if (!result.success) {
      log.error('[ADMIN] Restore failed', { adminUser, error: result.error });
      return res.status(500).json({
        error: 'Restore Failed',
        message: result.error,
        warnings: result.warnings,
      });
    }

    log.info('[ADMIN] Restore completed', {
      adminUser,
      tablesRestored: result.tablesRestored,
      recordsRestored: result.recordsRestored,
    });

    // Audit log (note: this creates a new audit log in the restored DB)
    await auditService.logFromRequest(req, AuditAction.BACKUP_RESTORE, AuditCategory.BACKUP, {
      details: {
        tablesRestored: result.tablesRestored,
        recordsRestored: result.recordsRestored,
        backupDate: backup.meta?.createdAt,
        backupCreatedBy: backup.meta?.createdBy,
      },
    });

    res.json({
      success: true,
      message: 'Database restored successfully',
      tablesRestored: result.tablesRestored,
      recordsRestored: result.recordsRestored,
      warnings: result.warnings,
    });
  } catch (error) {
    log.error('[ADMIN] Restore error', { error: String(error) });
    res.status(500).json({
      error: 'Restore Failed',
      message: 'An unexpected error occurred during restore',
    });
  }
});

// ========================================
// AUDIT LOGS
// ========================================

/**
 * GET /api/v1/admin/audit-logs
 * Get audit logs with optional filters (admin only)
 *
 * Query parameters:
 *   - userId: Filter by user ID
 *   - username: Filter by username (partial match)
 *   - action: Filter by action (partial match)
 *   - category: Filter by category (auth, user, wallet, device, admin, backup, system)
 *   - success: Filter by success status (true/false)
 *   - startDate: Filter by start date (ISO string)
 *   - endDate: Filter by end date (ISO string)
 *   - limit: Number of records (default 50, max 500)
 *   - offset: Skip records for pagination
 */
router.get('/audit-logs', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      userId,
      username,
      action,
      category,
      success,
      startDate,
      endDate,
      limit,
      offset,
    } = req.query;

    const result = await auditService.query({
      userId: userId as string,
      username: username as string,
      action: action as string,
      category: category as AuditCategory,
      success: success !== undefined ? success === 'true' : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: Math.min(parseInt(limit as string) || 50, 500),
      offset: parseInt(offset as string) || 0,
    });

    res.json(result);
  } catch (error) {
    log.error('[ADMIN] Get audit logs error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get audit logs',
    });
  }
});

/**
 * GET /api/v1/admin/audit-logs/stats
 * Get audit log statistics (admin only)
 *
 * Query parameters:
 *   - days: Number of days to include (default 30)
 */
router.get('/audit-logs/stats', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const stats = await auditService.getStats(days);
    res.json(stats);
  } catch (error) {
    log.error('[ADMIN] Get audit stats error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get audit statistics',
    });
  }
});

// ========================================
// VERSION CHECK
// ========================================

// Read version from package.json at startup
import { readFileSync } from 'fs';
import { join } from 'path';

let currentVersion = '0.0.0';
try {
  // Try to read from root package.json (Docker build copies it)
  const pkgPath = join(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  currentVersion = pkg.version || '0.0.0';
} catch {
  try {
    // Fallback: try parent directory (development)
    const pkgPath = join(__dirname, '../../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    currentVersion = pkg.version || '0.0.0';
  } catch {
    log.warn('[ADMIN] Could not read version from package.json');
  }
}

// Cache for GitHub release check (avoid rate limiting)
let releaseCache: {
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  body: string;
  checkedAt: number;
} | null = null;
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/v1/admin/version
 * Get current version and check for updates
 * Does not require authentication - version info is not sensitive
 */
router.get('/version', async (req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Check if we need to fetch from GitHub
    if (!releaseCache || (now - releaseCache.checkedAt) > RELEASE_CACHE_TTL) {
      try {
        const response = await fetch(
          'https://api.github.com/repos/n-narusegawa/sanctuary/releases/latest',
          {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Sanctuary-App',
            },
          }
        );

        if (response.ok) {
          const release = await response.json() as {
            tag_name?: string;
            html_url?: string;
            name?: string;
            published_at?: string;
            body?: string;
          };
          releaseCache = {
            latestVersion: release.tag_name?.replace(/^v/, '') || '0.0.0',
            releaseUrl: release.html_url || '',
            releaseName: release.name || '',
            publishedAt: release.published_at || '',
            body: release.body || '',
            checkedAt: now,
          };
        }
      } catch (fetchError) {
        log.warn('[ADMIN] Failed to fetch latest release from GitHub', { error: String(fetchError) });
      }
    }

    // Compare versions
    const compareVersions = (a: string, b: string): number => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
      }
      return 0;
    };

    const latestVersion = releaseCache?.latestVersion || currentVersion;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    res.json({
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: releaseCache?.releaseUrl || `https://github.com/n-narusegawa/sanctuary/releases`,
      releaseName: releaseCache?.releaseName || '',
      publishedAt: releaseCache?.publishedAt || '',
      releaseNotes: releaseCache?.body || '',
    });
  } catch (error) {
    log.error('[ADMIN] Version check error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check version',
    });
  }
});

export default router;
