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
 *   - Docker volume disk usage monitoring
 *   - Weekly PostgreSQL VACUUM ANALYZE and REINDEX
 *   - Monthly orphaned record cleanup
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { auditService, AuditAction, AuditCategory } from './auditService';
import { exec } from 'child_process';
import { promisify } from 'util';

const log = createLogger('MAINTENANCE');
const execAsync = promisify(exec);

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

  // Database maintenance intervals
  weeklyMaintenanceInterval: number; // 7 days in milliseconds
  monthlyMaintenanceInterval: number; // 30 days in milliseconds

  // Disk usage monitoring
  diskWarningThresholdPercent: number;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
  auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
  priceDataRetentionDays: parseInt(process.env.PRICE_DATA_RETENTION_DAYS || '30', 10),
  feeEstimateRetentionDays: parseInt(process.env.FEE_ESTIMATE_RETENTION_DAYS || '7', 10),
  dailyCleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
  hourlyCleanupInterval: 60 * 60 * 1000, // 1 hour
  initialDelayMs: 60 * 1000, // 1 minute
  weeklyMaintenanceInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
  monthlyMaintenanceInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
  diskWarningThresholdPercent: parseInt(process.env.DISK_WARNING_THRESHOLD_PERCENT || '80', 10),
};

/**
 * Maintenance Service class
 */
class MaintenanceService {
  private config: MaintenanceConfig;
  private dailyTimer: NodeJS.Timeout | null = null;
  private hourlyTimer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private weeklyTimer: NodeJS.Timeout | null = null;
  private monthlyTimer: NodeJS.Timeout | null = null;
  private running = false;

  // Track last run times for weekly/monthly tasks
  private lastWeeklyRun: Date | null = null;
  private lastMonthlyRun: Date | null = null;

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

    // Schedule weekly maintenance tasks
    this.weeklyTimer = setInterval(() => {
      this.checkAndRunWeeklyMaintenance().catch((err) => {
        log.error('Weekly maintenance check failed', { error: String(err) });
      });
    }, this.config.dailyCleanupInterval); // Check daily, run weekly

    // Schedule monthly maintenance tasks
    this.monthlyTimer = setInterval(() => {
      this.checkAndRunMonthlyMaintenance().catch((err) => {
        log.error('Monthly maintenance check failed', { error: String(err) });
      });
    }, this.config.dailyCleanupInterval); // Check daily, run monthly
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

    if (this.weeklyTimer) {
      clearInterval(this.weeklyTimer);
      this.weeklyTimer = null;
    }

    if (this.monthlyTimer) {
      clearInterval(this.monthlyTimer);
      this.monthlyTimer = null;
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
      this.checkDiskUsage(),
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
   * Check Docker volume disk usage and warn if threshold exceeded
   */
  async checkDiskUsage(): Promise<void> {
    const volumes = ['sanctuary_postgres_data', 'sanctuary_ollama_data'];

    try {
      // Check if docker command is available
      const { stdout: versionOutput } = await execAsync('docker --version').catch(() => ({ stdout: '' }));
      if (!versionOutput) {
        log.debug('Docker not available for disk usage monitoring');
        return;
      }

      for (const volumeName of volumes) {
        try {
          // Use docker volume inspect to get the mountpoint
          const { stdout: inspectOutput } = await execAsync(`docker volume inspect ${volumeName}`);
          const volumeData = JSON.parse(inspectOutput);

          if (volumeData && volumeData.length > 0) {
            const mountpoint = volumeData[0].Mountpoint;

            // Get disk usage for the mountpoint using df
            const { stdout: dfOutput } = await execAsync(`df -h "${mountpoint}" | tail -1`);
            const parts = dfOutput.trim().split(/\s+/);

            if (parts.length >= 5) {
              const usagePercent = parseInt(parts[4].replace('%', ''), 10);
              const used = parts[2];
              const available = parts[3];
              const total = parts[1];

              if (usagePercent >= this.config.diskWarningThresholdPercent) {
                log.warn('Docker volume disk usage exceeds threshold', {
                  volume: volumeName,
                  usagePercent: `${usagePercent}%`,
                  used,
                  available,
                  total,
                  threshold: `${this.config.diskWarningThresholdPercent}%`,
                });

                // Log to audit for tracking
                await auditService.log({
                  username: 'system',
                  action: 'maintenance.disk_warning',
                  category: AuditCategory.SYSTEM,
                  details: {
                    volume: volumeName,
                    usagePercent,
                    used,
                    available,
                    total,
                    threshold: this.config.diskWarningThresholdPercent,
                  },
                  success: true,
                });
              } else {
                log.debug('Docker volume disk usage within threshold', {
                  volume: volumeName,
                  usagePercent: `${usagePercent}%`,
                  used,
                  available,
                  total,
                });
              }
            }
          }
        } catch (volumeError) {
          // Log but don't fail - volume might not exist yet
          log.debug('Could not check disk usage for volume', {
            volume: volumeName,
            error: String(volumeError),
          });
        }
      }
    } catch (error) {
      // Don't throw - disk monitoring is optional and shouldn't break maintenance
      log.warn('Disk usage check failed', { error: String(error) });
    }
  }

  /**
   * Check and run weekly maintenance if needed
   */
  async checkAndRunWeeklyMaintenance(): Promise<void> {
    const now = new Date();

    // Run if we've never run, or if it's been more than a week
    if (!this.lastWeeklyRun ||
        (now.getTime() - this.lastWeeklyRun.getTime()) >= this.config.weeklyMaintenanceInterval) {
      await this.runWeeklyMaintenance();
      this.lastWeeklyRun = now;
    }
  }

  /**
   * Run weekly database maintenance tasks
   */
  async runWeeklyMaintenance(): Promise<void> {
    log.info('Running weekly database maintenance');

    const startTime = Date.now();

    try {
      // Run VACUUM ANALYZE on all tables
      log.info('Running VACUUM ANALYZE on database');
      await prisma.$executeRawUnsafe('VACUUM ANALYZE;');

      // Run REINDEX on heavily-updated tables
      const heavyTables = ['audit_logs', 'transactions', 'utxos'];
      for (const table of heavyTables) {
        log.info(`Running REINDEX on table: ${table}`);
        await prisma.$executeRawUnsafe(`REINDEX TABLE "${table}";`);
      }

      const duration = Date.now() - startTime;
      log.info('Weekly database maintenance completed', {
        durationMs: duration,
        tablesReindexed: heavyTables.length
      });

      // Log to audit for tracking
      await auditService.log({
        username: 'system',
        action: 'maintenance.weekly_db_maintenance',
        category: AuditCategory.SYSTEM,
        details: {
          durationMs: duration,
          tablesReindexed: heavyTables
        },
        success: true,
      });
    } catch (error) {
      log.error('Weekly database maintenance failed', { error: String(error) });

      // Log failure to audit
      await auditService.log({
        username: 'system',
        action: 'maintenance.weekly_db_maintenance',
        category: AuditCategory.SYSTEM,
        details: { error: String(error) },
        success: false,
      });

      throw error;
    }
  }

  /**
   * Check and run monthly maintenance if needed
   */
  async checkAndRunMonthlyMaintenance(): Promise<void> {
    const now = new Date();

    // Run if we've never run, or if it's been more than a month
    if (!this.lastMonthlyRun ||
        (now.getTime() - this.lastMonthlyRun.getTime()) >= this.config.monthlyMaintenanceInterval) {
      await this.runMonthlyMaintenance();
      this.lastMonthlyRun = now;
    }
  }

  /**
   * Run monthly cleanup of stale records
   */
  async runMonthlyMaintenance(): Promise<void> {
    log.info('Running monthly stale record cleanup');

    try {
      // Delete push_devices that haven't been used in 90+ days
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 90);

      const stalePushDevicesResult = await prisma.pushDevice.deleteMany({
        where: {
          lastUsedAt: {
            lt: staleDate,
          },
        },
      });

      if (stalePushDevicesResult.count > 0) {
        log.info('Stale push devices cleanup completed', {
          deleted: stalePushDevicesResult.count,
        });
      }

      // Log to audit for tracking
      await auditService.log({
        username: 'system',
        action: 'maintenance.monthly_stale_cleanup',
        category: AuditCategory.SYSTEM,
        details: {
          stalePushDevices: stalePushDevicesResult.count
        },
        success: true,
      });
    } catch (error) {
      log.error('Monthly stale record cleanup failed', { error: String(error) });

      // Log failure to audit
      await auditService.log({
        username: 'system',
        action: 'maintenance.monthly_stale_cleanup',
        category: AuditCategory.SYSTEM,
        details: { error: String(error) },
        success: false,
      });

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
  async triggerCleanup(task: 'all' | 'audit' | 'price' | 'fees' | 'drafts' | 'weekly' | 'monthly'): Promise<number> {
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
      case 'weekly':
        await this.runWeeklyMaintenance();
        return 0;
      case 'monthly':
        await this.runMonthlyMaintenance();
        return 0;
      default:
        throw new Error(`Unknown cleanup task: ${task}`);
    }
  }
}

// Export singleton instance
export const maintenanceService = new MaintenanceService();
