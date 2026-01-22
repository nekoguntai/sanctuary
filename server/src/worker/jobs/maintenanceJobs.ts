/**
 * Maintenance Jobs for Worker
 *
 * Wraps shared maintenance job definitions so the worker can execute them.
 */

import type { WorkerJobHandler } from './types';
import {
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
  cleanupExpiredDraftsJob,
  cleanupExpiredTransfersJob,
  cleanupExpiredTokensJob,
  weeklyVacuumJob,
  monthlyCleanupJob,
} from '../../jobs/definitions/maintenance';

export const maintenanceJobs: WorkerJobHandler<unknown, unknown>[] = [
  {
    name: cleanupAuditLogsJob.name,
    queue: 'maintenance',
    handler: cleanupAuditLogsJob.handler,
    options: cleanupAuditLogsJob.options,
  },
  {
    name: cleanupPriceDataJob.name,
    queue: 'maintenance',
    handler: cleanupPriceDataJob.handler,
    options: cleanupPriceDataJob.options,
  },
  {
    name: cleanupFeeEstimatesJob.name,
    queue: 'maintenance',
    handler: cleanupFeeEstimatesJob.handler,
    options: cleanupFeeEstimatesJob.options,
  },
  {
    name: cleanupExpiredDraftsJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredDraftsJob.handler,
    options: cleanupExpiredDraftsJob.options,
  },
  {
    name: cleanupExpiredTransfersJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTransfersJob.handler,
    options: cleanupExpiredTransfersJob.options,
  },
  {
    name: cleanupExpiredTokensJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTokensJob.handler,
    options: cleanupExpiredTokensJob.options,
  },
  {
    name: weeklyVacuumJob.name,
    queue: 'maintenance',
    handler: weeklyVacuumJob.handler,
    options: weeklyVacuumJob.options,
  },
  {
    name: monthlyCleanupJob.name,
    queue: 'maintenance',
    handler: monthlyCleanupJob.handler,
    options: monthlyCleanupJob.options,
  },
];
