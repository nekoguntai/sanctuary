/**
 * Admin Groups Router
 *
 * Endpoints for group management (admin only)
 */

import { Router, Request, Response } from 'express';
import prisma from '../../models/prisma';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';

const router = Router();
const log = createLogger('ADMIN:GROUPS');

/**
 * GET /api/v1/admin/groups
 * Get all groups (admin only)
 */
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
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
    log.error('Get groups error', { error: String(error) });
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
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
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
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true },
      });
      const validUserIds = new Set(existingUsers.map(u => u.id));

      await prisma.groupMember.createMany({
        data: memberIds
          .filter((id: string) => validUserIds.has(id))
          .map((userId: string) => ({
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

    log.info('Group created:', { name, id: group.id });

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
    log.error('Create group error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create group',
    });
  }
});

/**
 * PUT /api/v1/admin/groups/:groupId
 * Update a group (admin only)
 */
router.put('/:groupId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { name, description, purpose, memberIds } = req.body;

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
      const currentMemberIds = existingGroup.members.map(m => m.userId);
      const toAdd = memberIds.filter((id: string) => !currentMemberIds.includes(id));
      const toRemove = currentMemberIds.filter(id => !memberIds.includes(id));

      if (toRemove.length > 0) {
        await prisma.groupMember.deleteMany({
          where: { groupId, userId: { in: toRemove } },
        });
      }

      if (toAdd.length > 0) {
        const existingUsers = await prisma.user.findMany({
          where: { id: { in: toAdd } },
          select: { id: true },
        });
        const validUserIds = new Set(existingUsers.map(u => u.id));

        await prisma.groupMember.createMany({
          data: toAdd
            .filter((id: string) => validUserIds.has(id))
            .map((userId: string) => ({ groupId, userId, role: 'member' })),
          skipDuplicates: true,
        });
      }
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: { select: { id: true, username: true } },
          },
        },
      },
    });

    log.info('Group updated:', { groupId, name: group!.name });

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
    log.error('Update group error', { error: String(error) });
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
router.delete('/:groupId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    const existingGroup = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!existingGroup) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Group not found',
      });
    }

    await prisma.group.delete({
      where: { id: groupId },
    });

    log.info('Group deleted:', { groupId, name: existingGroup.name });

    await auditService.logFromRequest(req, AuditAction.GROUP_DELETE, AuditCategory.ADMIN, {
      details: { groupName: existingGroup.name, groupId },
    });

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    log.error('Delete group error', { error: String(error) });
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
router.post('/:groupId/members', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { userId, role } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'User ID is required',
      });
    }

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Group not found',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const existingMembership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    });

    if (existingMembership) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'User is already a member of this group',
      });
    }

    const membership = await prisma.groupMember.create({
      data: { groupId, userId, role: role || 'member' },
    });

    log.info('Member added to group:', { groupId, userId, role: membership.role });

    await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_ADD, AuditCategory.ADMIN, {
      details: { groupId, targetUser: user.username, role: membership.role },
    });

    res.status(201).json({
      userId,
      username: user.username,
      role: membership.role,
    });
  } catch (error) {
    log.error('Add group member error', { error: String(error) });
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
router.delete('/:groupId/members/:userId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.params;

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    });

    if (!membership) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Member not found in this group',
      });
    }

    await prisma.groupMember.delete({
      where: { userId_groupId: { userId, groupId } },
    });

    log.info('Member removed from group:', { groupId, userId });

    await auditService.logFromRequest(req, AuditAction.GROUP_MEMBER_REMOVE, AuditCategory.ADMIN, {
      details: { groupId, userId },
    });

    res.json({ message: 'Member removed from group successfully' });
  } catch (error) {
    log.error('Remove group member error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove member from group',
    });
  }
});

export default router;
