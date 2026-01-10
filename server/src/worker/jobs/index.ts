/**
 * Worker Job Definitions Index
 *
 * All job handlers for the background worker.
 */

export { syncJobs } from './syncJobs';
export { notificationJobs } from './notificationJobs';

import type { WorkerJobQueue } from '../workerJobQueue';
import type { WorkerJobHandler } from './types';
import { syncJobs } from './syncJobs';
import { notificationJobs } from './notificationJobs';

/**
 * Register all job handlers with the worker queue
 */
export function registerWorkerJobs(queue: WorkerJobQueue): void {
  const allJobs: WorkerJobHandler<unknown, unknown>[] = [
    ...syncJobs,
    ...notificationJobs,
  ];

  for (const job of allJobs) {
    queue.registerHandler(job.queue, job);
  }
}
