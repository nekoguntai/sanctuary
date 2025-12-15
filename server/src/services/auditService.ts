/**
 * Audit Service
 *
 * Logs security-relevant events for compliance and troubleshooting.
 * All admin actions, authentication events, and sensitive operations
 * are recorded with user context, IP address, and details.
 *
 * Categories:
 *   - auth: Login, logout, failed login attempts
 *   - user: User creation, modification, deletion
 *   - wallet: Wallet creation, sharing, deletion
 *   - device: Device registration, removal
 *   - admin: Admin settings changes, node config
 *   - backup: Backup creation, restore operations
 *   - system: System settings changes
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { Request } from 'express';

const log = createLogger('AUDIT');

/**
 * Audit event categories
 */
export enum AuditCategory {
  AUTH = 'auth',
  USER = 'user',
  WALLET = 'wallet',
  DEVICE = 'device',
  ADMIN = 'admin',
  BACKUP = 'backup',
  SYSTEM = 'system',
}

/**
 * Common audit actions
 */
export enum AuditAction {
  // Auth
  LOGIN = 'auth.login',
  LOGIN_FAILED = 'auth.login_failed',
  LOGOUT = 'auth.logout',
  PASSWORD_CHANGE = 'auth.password_change',

  // User management
  USER_CREATE = 'user.create',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',
  USER_ADMIN_GRANT = 'user.admin_grant',
  USER_ADMIN_REVOKE = 'user.admin_revoke',

  // Wallet management
  WALLET_CREATE = 'wallet.create',
  WALLET_DELETE = 'wallet.delete',
  WALLET_SHARE = 'wallet.share',
  WALLET_UNSHARE = 'wallet.unshare',
  WALLET_EXPORT = 'wallet.export',

  // Device management
  DEVICE_REGISTER = 'device.register',
  DEVICE_DELETE = 'device.delete',
  DEVICE_UPDATE = 'device.update',

  // Admin operations
  NODE_CONFIG_UPDATE = 'admin.node_config_update',
  NODE_CONFIG_CREATE = 'admin.node_config_create',
  NODE_CONFIG_DELETE = 'admin.node_config_delete',
  SYSTEM_SETTING_UPDATE = 'admin.system_setting_update',

  // Group management
  GROUP_CREATE = 'admin.group_create',
  GROUP_DELETE = 'admin.group_delete',
  GROUP_MEMBER_ADD = 'admin.group_member_add',
  GROUP_MEMBER_REMOVE = 'admin.group_member_remove',

  // Backup operations
  BACKUP_CREATE = 'backup.create',
  BACKUP_VALIDATE = 'backup.validate',
  BACKUP_RESTORE = 'backup.restore',

  // Two-Factor Authentication
  TWO_FACTOR_SETUP = 'auth.2fa_setup',
  TWO_FACTOR_ENABLED = 'auth.2fa_enabled',
  TWO_FACTOR_DISABLED = 'auth.2fa_disabled',
  TWO_FACTOR_VERIFIED = 'auth.2fa_verified',
  TWO_FACTOR_FAILED = 'auth.2fa_failed',
  TWO_FACTOR_BACKUP_CODE_USED = 'auth.2fa_backup_code_used',
  TWO_FACTOR_BACKUP_CODES_REGENERATED = 'auth.2fa_backup_codes_regenerated',

  // Transaction operations
  TRANSACTION_CREATE = 'wallet.transaction_create',
  TRANSACTION_SIGN = 'wallet.transaction_sign',
  TRANSACTION_BROADCAST = 'wallet.transaction_broadcast',
  TRANSACTION_BROADCAST_FAILED = 'wallet.transaction_broadcast_failed',

  // Address operations
  ADDRESS_GENERATE = 'wallet.address_generate',
}

/**
 * Audit log entry input
 */
export interface AuditLogInput {
  userId?: string;
  username: string;
  action: string;
  category: AuditCategory;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMsg?: string;
}

/**
 * Query options for audit logs
 */
export interface AuditLogQuery {
  userId?: string;
  username?: string;
  action?: string;
  category?: AuditCategory;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Extract client info from Express request
 */
export function getClientInfo(req: Request): { ipAddress: string; userAgent: string } {
  // Get IP from x-forwarded-for header (for proxies) or direct connection
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress || 'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';

  return { ipAddress, userAgent };
}

/**
 * Audit Service class
 */
class AuditService {
  /**
   * Log an audit event
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: input.userId,
          username: input.username,
          action: input.action,
          category: input.category,
          details: input.details ?? undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          success: input.success ?? true,
          errorMsg: input.errorMsg,
        },
      });

      // Also log to application logger for immediate visibility
      const logMsg = `[${input.category}] ${input.action} by ${input.username}`;
      if (input.success === false) {
        log.warn(logMsg, { error: input.errorMsg, ...input.details });
      } else {
        log.info(logMsg, input.details);
      }
    } catch (error) {
      // Don't let audit logging failures break the application
      log.error('Failed to write audit log', { error: String(error), input });
    }
  }

  /**
   * Convenience method to log from an Express request
   */
  async logFromRequest(
    req: Request,
    action: string,
    category: AuditCategory,
    options: {
      details?: Record<string, any>;
      success?: boolean;
      errorMsg?: string;
    } = {}
  ): Promise<void> {
    const { ipAddress, userAgent } = getClientInfo(req);
    // @ts-ignore - req.user is set by auth middleware
    const user = req.user;

    await this.log({
      userId: user?.userId,
      username: user?.username || 'anonymous',
      action,
      category,
      ipAddress,
      userAgent,
      ...options,
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(options: AuditLogQuery = {}): Promise<{
    logs: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const {
      userId,
      username,
      action,
      category,
      success,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = options;

    const where: any = {};

    if (userId) where.userId = userId;
    if (username) where.username = { contains: username, mode: 'insensitive' };
    if (action) where.action = { contains: action };
    if (category) where.category = category;
    if (success !== undefined) where.success = success;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { logs, total, limit, offset };
  }

  /**
   * Get recent audit logs for a specific user
   */
  async getForUser(userId: string, limit = 20): Promise<any[]> {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get failed login attempts (for security monitoring)
   */
  async getFailedLogins(since: Date, limit = 100): Promise<any[]> {
    return prisma.auditLog.findMany({
      where: {
        action: AuditAction.LOGIN_FAILED,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get all admin actions
   */
  async getAdminActions(limit = 50, offset = 0): Promise<any[]> {
    return prisma.auditLog.findMany({
      where: {
        category: { in: [AuditCategory.ADMIN, AuditCategory.BACKUP, AuditCategory.SYSTEM] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Clean up old audit logs (retention policy)
   */
  async cleanup(olderThan: Date): Promise<number> {
    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: olderThan },
      },
    });

    log.info('Audit log cleanup completed', {
      deleted: result.count,
      olderThan: olderThan.toISOString(),
    });

    return result.count;
  }

  /**
   * Get audit statistics
   */
  async getStats(days = 30): Promise<{
    totalEvents: number;
    byCategory: Record<string, number>;
    byAction: Record<string, number>;
    failedEvents: number;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalEvents, failedEvents, categoryStats, actionStats] = await Promise.all([
      prisma.auditLog.count({
        where: { createdAt: { gte: since } },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: since }, success: false },
      }),
      prisma.auditLog.groupBy({
        by: ['category'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
    ]);

    const byCategory: Record<string, number> = {};
    for (const stat of categoryStats) {
      byCategory[stat.category] = stat._count;
    }

    const byAction: Record<string, number> = {};
    for (const stat of actionStats) {
      byAction[stat.action] = stat._count;
    }

    return { totalEvents, byCategory, byAction, failedEvents };
  }
}

// Export singleton instance
export const auditService = new AuditService();
