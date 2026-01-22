/**
 * Maintenance Jobs for Worker
 *
 * Wraps shared maintenance job definitions so the worker can execute them.
 */

import type { Job } from 'bullmq';
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

// Type for handlers that accept any job data
type AnyJobHandler = (job: Job<unknown>) => Promise<unknown>;

export const maintenanceJobs: WorkerJobHandler<unknown, unknown>[] = [
  {
    name: cleanupAuditLogsJob.name,
    queue: 'maintenance',
    handler: cleanupAuditLogsJob.handler as AnyJobHandler,
    options: cleanupAuditLogsJob.options,
  },
  {
    name: cleanupPriceDataJob.name,
    queue: 'maintenance',
    handler: cleanupPriceDataJob.handler as AnyJobHandler,
    options: cleanupPriceDataJob.options,
  },
  {
    name: cleanupFeeEstimatesJob.name,
    queue: 'maintenance',
    handler: cleanupFeeEstimatesJob.handler as AnyJobHandler,
    options: cleanupFeeEstimatesJob.options,
  },
  {
    name: cleanupExpiredDraftsJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredDraftsJob.handler as AnyJobHandler,
    options: cleanupExpiredDraftsJob.options,
  },
  {
    name: cleanupExpiredTransfersJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTransfersJob.handler as AnyJobHandler,
    options: cleanupExpiredTransfersJob.options,
  },
  {
    name: cleanupExpiredTokensJob.name,
    queue: 'maintenance',
    handler: cleanupExpiredTokensJob.handler as AnyJobHandler,
    options: cleanupExpiredTokensJob.options,
  },
  {
    name: weeklyVacuumJob.name,
    queue: 'maintenance',
    handler: weeklyVacuumJob.handler as AnyJobHandler,
    options: weeklyVacuumJob.options,
  },
  {
    name: monthlyCleanupJob.name,
    queue: 'maintenance',
    handler: monthlyCleanupJob.handler as AnyJobHandler,
    options: monthlyCleanupJob.options,
  },
];
