/**
 * Maintenance Service
 *
 * Handles scheduled cleanup and maintenance tasks to ensure
 * the application can run perpetually without resource exhaustion.
 *
 * Tasks:
 *   - Audit log cleanup (configurable retention, default 90 days)
 *   - Price data cleanup (30 days retention)
 *   - Fee estimate cleanup (7 days retention)
 *   - Expired draft transaction cleanup
 *   - Stale session cleanup
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { auditService, AuditAction, AuditCategory } from './auditService';

const log = createLogger('MAINTENANCE');

/**
 * Maintenance configuration (can be overridden via environment variables)
 */
interface MaintenanceConfig {
  // Retention periods in days
  auditLogRetentionDays: number;
  priceDataRetentionDays: number;
  feeEstimateRetentionDays: number;

  // Cleanup intervals in milliseconds
  dailyCleanupInterval: number;
  hourlyCleanupInterval: number;

  // Initial delay before first cleanup (to let server fully start)
  initialDelayMs: number;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
  auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
  priceDataRetentionDays: parseInt(process.env.PRICE_DATA_RETENTION_DAYS || '30', 10),
  feeEstimateRetentionDays: parseInt(process.env.FEE_ESTIMATE_RETENTION_DAYS || '7', 10),
  dailyCleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
  hourlyCleanupInterval: 60 * 60 * 1000, // 1 hour
  initialDelayMs: 60 * 1000, // 1 minute
};

/**
 * Maintenance Service class
 */
class MaintenanceService {
  private config: MaintenanceConfig;
  private dailyTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: Partial<MaintenanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the maintenance service
   */
  start(): void {
    if (this.running) {
      log.warn('Maintenance service already running');
      return;
    }

    this.running = true;
    log.info('Maintenance service starting', {
      auditLogRetention: `${this.config.auditLogRetentionDays} days`,
      priceDataRetention: `${this.config.priceDataRetentionDays} days`,
      feeEstimateRetention: `${this.config.feeEstimateRetentionDays} days`,
    });

    // Run initial cleanup after a short delay
    this.initialTimer = setTimeout(() => {
      this.runAllCleanups().catch((err) => {
        log.error('Initial cleanup failed', { error: String(err) });
      });
    }, this.config.initialDelayMs);

    // Schedule daily cleanup tasks
    this.dailyTimer = setInterval(() => {
      this.runDailyCleanups().catch((err) => {
        log.error('Daily cleanup failed', { error: String(err) });
      });
    }, this.config.dailyCleanupInterval);

    // Schedule hourly cleanup tasks
    this.hourlyTimer = setInterval(() => {
      this.runHourlyCleanups().catch((err) => {
        log.error('Hourly cleanup failed', { error: String(err) });
      });
    }, this.config.hourlyCleanupInterval);
  }

  /**
   * Stop the maintenance service
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    log.info('Maintenance service stopping');

    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }

    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }

    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
  }

  /**
   * Run all cleanup tasks
   */
  async runAllCleanups(): Promise<void> {
    log.info('Running all maintenance cleanups');
    await this.runDailyCleanups();
    await this.runHourlyCleanups();
  }

  /**
   * Run daily cleanup tasks
   */
  async runDailyCleanups(): Promise<void> {
    log.info('Running daily maintenance tasks');

    const results = await Promise.allSettled([
      this.cleanupAuditLogs(),
      this.cleanupPriceData(),
      this.cleanupFeeEstimates(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Daily cleanup task failed', { error: String(result.reason) });
      }
    }
  }

  /**
   * Run hourly cleanup tasks
   */
  async runHourlyCleanups(): Promise<void> {
    log.debug('Running hourly maintenance tasks');

    const results = await Promise.allSettled([
      this.cleanupExpiredDrafts(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Hourly cleanup task failed', { error: String(result.reason) });
      }
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupAuditLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.auditLogRetentionDays);

    try {
      const deleted = await auditService.cleanup(cutoffDate);

      if (deleted > 0) {
        log.info('Audit log cleanup completed', {
          deleted,
          olderThan: cutoffDate.toISOString(),
        });
      }

      return deleted;
    } catch (error) {
      log.error('Audit log cleanup failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Clean up old price data
   */
  async cleanupPriceData(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.priceDataRetentionDays);

    try {
      const result = await prisma.priceData.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      if (result.count > 0) {
        log.info('Price data cleanup completed', {
          deleted: result.count,
          olderThan: cutoffDate.toISOString(),
        });
      }

      return result.count;
    } catch (error) {
      log.error('Price data cleanup failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Clean up old fee estimates
   */
  async cleanupFeeEstimates(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.feeEstimateRetentionDays);

    try {
      const result = await prisma.feeEstimate.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      if (result.count > 0) {
        log.info('Fee estimate cleanup completed', {
          deleted: result.count,
          olderThan: cutoffDate.toISOString(),
        });
      }

      return result.count;
    } catch (error) {
      log.error('Fee estimate cleanup failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Clean up expired draft transactions
   */
  async cleanupExpiredDrafts(): Promise<number> {
    const now = new Date();

    try {
      const result = await prisma.draftTransaction.deleteMany({
        where: {
          expiresAt: { lt: now },
        },
      });

      if (result.count > 0) {
        log.info('Expired draft cleanup completed', {
          deleted: result.count,
        });

        // Log to audit for tracking
        await auditService.log({
          username: 'system',
          action: 'maintenance.draft_cleanup',
          category: AuditCategory.SYSTEM,
          details: { deletedCount: result.count },
          success: true,
        });
      }

      return result.count;
    } catch (error) {
      log.error('Expired draft cleanup failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Get maintenance statistics
   */
  async getStats(): Promise<{
    auditLogCount: number;
    priceDataCount: number;
    feeEstimateCount: number;
    draftCount: number;
    expiredDraftCount: number;
  }> {
    const now = new Date();

    const [auditLogCount, priceDataCount, feeEstimateCount, draftCount, expiredDraftCount] =
      await Promise.all([
        prisma.auditLog.count(),
        prisma.priceData.count(),
        prisma.feeEstimate.count(),
        prisma.draftTransaction.count(),
        prisma.draftTransaction.count({
          where: { expiresAt: { lt: now } },
        }),
      ]);

    return {
      auditLogCount,
      priceDataCount,
      feeEstimateCount,
      draftCount,
      expiredDraftCount,
    };
  }

  /**
   * Manually trigger cleanup (for admin API or testing)
   */
  async triggerCleanup(task: 'all' | 'audit' | 'price' | 'fees' | 'drafts'): Promise<number> {
    switch (task) {
      case 'all':
        await this.runAllCleanups();
        return 0;
      case 'audit':
        return this.cleanupAuditLogs();
      case 'price':
        return this.cleanupPriceData();
      case 'fees':
        return this.cleanupFeeEstimates();
      case 'drafts':
        return this.cleanupExpiredDrafts();
      default:
        throw new Error(`Unknown cleanup task: ${task}`);
    }
  }
}

// Export singleton instance
export const maintenanceService = new MaintenanceService();
