/**
 * Job Queue with Prioritization and Rate Limiting
 *
 * Provides a priority queue for background jobs with rate limiting.
 * Ensures critical operations complete first while preventing overload.
 *
 * ## Features
 *
 * - Priority levels (critical, high, normal, low)
 * - Rate limiting per job type
 * - Concurrency control
 * - Job deduplication
 * - Metrics and monitoring
 *
 * ## Usage
 *
 * ```typescript
 * const queue = createJobQueue('sync');
 *
 * // Add jobs with priority
 * queue.add({
 *   id: 'sync-wallet-123',
 *   type: 'wallet-sync',
 *   priority: 'high',
 *   data: { walletId: '123' },
 *   handler: async (data) => { await syncWallet(data.walletId); }
 * });
 *
 * // Start processing
 * queue.start();
 * ```
 */

import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('JobQueue');

// =============================================================================
// Types
// =============================================================================

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export interface Job<T = unknown> {
  /** Unique job ID (for deduplication) */
  id: string;
  /** Job type (for rate limiting) */
  type: string;
  /** Priority level */
  priority: JobPriority;
  /** Job data */
  data: T;
  /** Job handler */
  handler: (data: T) => Promise<void>;
  /** Max retries (default: 3) */
  maxRetries?: number;
  /** Timeout in ms (default: 60000) */
  timeout?: number;
  /** Created timestamp */
  createdAt?: Date;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  error?: string;
  durationMs: number;
  retries: number;
}

export interface QueueConfig {
  /** Maximum concurrent jobs (default: 5) */
  maxConcurrent: number;
  /** Rate limit per job type per second (default: 10) */
  rateLimit: number;
  /** Default job timeout in ms (default: 60000) */
  defaultTimeout: number;
  /** Default max retries (default: 3) */
  defaultMaxRetries: number;
  /** Retry delay multiplier (exponential backoff) */
  retryDelayMultiplier: number;
  /** Base retry delay in ms */
  baseRetryDelay: number;
}

export interface QueueStats {
  name: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  byPriority: Record<JobPriority, number>;
  avgDurationMs: number;
  rateLimitHits: number;
}

// =============================================================================
// Priority Values
// =============================================================================

const PRIORITY_VALUES: Record<JobPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// =============================================================================
// Internal Job Wrapper
// =============================================================================

// Use `any` for internal job to allow type erasure when storing mixed job types
interface InternalJob {
  id: string;
  type: string;
  priority: JobPriority;
  data: any;
  handler: (data: any) => Promise<void>;
  maxRetries?: number;
  timeout?: number;
  createdAt: Date;
  retries: number;
  priorityValue: number;
}

// =============================================================================
// Job Queue Implementation
// =============================================================================

export class JobQueue {
  private name: string;
  private config: QueueConfig;
  private queue: InternalJob[] = [];
  private running = new Map<string, InternalJob>();
  private completed = 0;
  private failed = 0;
  private totalDuration = 0;
  private rateLimitHits = 0;
  private isRunning = false;
  private processingPromise: Promise<void> | null = null;

  // Rate limiting
  private typeLastRun = new Map<string, number>();
  private typeRunCount = new Map<string, number>();

  // Deduplication
  private pendingJobIds = new Set<string>();

  constructor(name: string, config: Partial<QueueConfig> = {}) {
    this.name = name;
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 5,
      rateLimit: config.rateLimit ?? 10,
      defaultTimeout: config.defaultTimeout ?? 60000,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      retryDelayMultiplier: config.retryDelayMultiplier ?? 2,
      baseRetryDelay: config.baseRetryDelay ?? 1000,
    };
  }

  /**
   * Add a job to the queue
   * Returns false if job with same ID already exists
   */
  add<T>(job: Job<T>): boolean {
    // Check for duplicate
    if (this.pendingJobIds.has(job.id) || this.running.has(job.id)) {
      log.debug('Job already queued or running', { jobId: job.id, queue: this.name });
      return false;
    }

    const internalJob: InternalJob = {
      id: job.id,
      type: job.type,
      priority: job.priority,
      data: job.data,
      handler: job.handler as (data: any) => Promise<void>,
      createdAt: job.createdAt || new Date(),
      retries: 0,
      priorityValue: PRIORITY_VALUES[job.priority],
      maxRetries: job.maxRetries ?? this.config.defaultMaxRetries,
      timeout: job.timeout ?? this.config.defaultTimeout,
    };

    // Insert in priority order
    const insertIndex = this.queue.findIndex(
      (j) => j.priorityValue < internalJob.priorityValue
    );

    if (insertIndex === -1) {
      this.queue.push(internalJob);
    } else {
      this.queue.splice(insertIndex, 0, internalJob);
    }

    this.pendingJobIds.add(job.id);

    log.debug('Job added to queue', {
      jobId: job.id,
      type: job.type,
      priority: job.priority,
      queue: this.name,
      position: insertIndex === -1 ? this.queue.length : insertIndex + 1,
    });

    // Trigger processing if running
    if (this.isRunning) {
      this.processNext();
    }

    return true;
  }

  /**
   * Upgrade priority of an existing job
   */
  upgradePriority(jobId: string, newPriority: JobPriority): boolean {
    const index = this.queue.findIndex((j) => j.id === jobId);
    if (index === -1) return false;

    const job = this.queue[index];
    const newPriorityValue = PRIORITY_VALUES[newPriority];

    if (newPriorityValue <= job.priorityValue) {
      return false; // Can only upgrade, not downgrade
    }

    // Remove from current position
    this.queue.splice(index, 1);

    // Update priority
    job.priority = newPriority;
    job.priorityValue = newPriorityValue;

    // Re-insert in new position
    const insertIndex = this.queue.findIndex((j) => j.priorityValue < newPriorityValue);
    if (insertIndex === -1) {
      this.queue.push(job);
    } else {
      this.queue.splice(insertIndex, 0, job);
    }

    log.debug('Job priority upgraded', { jobId, newPriority, queue: this.name });
    return true;
  }

  /**
   * Start processing jobs
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    log.info('Job queue started', { queue: this.name });
    this.processNext();
  }

  /**
   * Stop processing new jobs (running jobs complete)
   */
  stop(): void {
    this.isRunning = false;
    log.info('Job queue stopped', { queue: this.name });
  }

  /**
   * Wait for all running jobs to complete
   */
  async drain(): Promise<void> {
    this.stop();
    while (this.running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Clear all pending jobs
   */
  clear(): number {
    const count = this.queue.length;
    this.queue = [];
    this.pendingJobIds.clear();
    log.info('Job queue cleared', { queue: this.name, clearedCount: count });
    return count;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const byPriority: Record<JobPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    for (const job of this.queue) {
      byPriority[job.priority]++;
    }

    return {
      name: this.name,
      pending: this.queue.length,
      running: this.running.size,
      completed: this.completed,
      failed: this.failed,
      byPriority,
      avgDurationMs: this.completed > 0 ? this.totalDuration / this.completed : 0,
      rateLimitHits: this.rateLimitHits,
    };
  }

  /**
   * Process next job if capacity available
   */
  private processNext(): void {
    if (!this.isRunning) return;
    if (this.running.size >= this.config.maxConcurrent) return;
    if (this.queue.length === 0) return;

    // Find next job that passes rate limit
    let jobIndex = -1;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.checkRateLimit(this.queue[i].type)) {
        jobIndex = i;
        break;
      }
    }

    if (jobIndex === -1) {
      // All jobs are rate limited, schedule retry
      this.rateLimitHits++;
      setTimeout(() => this.processNext(), 100);
      return;
    }

    const job = this.queue.splice(jobIndex, 1)[0];
    this.pendingJobIds.delete(job.id);
    this.running.set(job.id, job);

    // Record rate limit
    this.recordRateLimit(job.type);

    // Execute job
    this.executeJob(job);

    // Try to process more
    setImmediate(() => this.processNext());
  }

  /**
   * Execute a single job
   */
  private async executeJob(job: InternalJob): Promise<void> {
    const start = Date.now();

    try {
      // Create timeout with proper cleanup
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });

      try {
        // Execute with timeout
        await Promise.race([job.handler(job.data), timeoutPromise]);
      } finally {
        // Always clear timeout to prevent timer leak
        if (timeoutId) clearTimeout(timeoutId);
      }

      const duration = Date.now() - start;
      this.totalDuration += duration;
      this.completed++;

      log.debug('Job completed', {
        jobId: job.id,
        type: job.type,
        durationMs: duration,
        queue: this.name,
      });
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = getErrorMessage(error, 'Unknown error');

      log.warn('Job failed', {
        jobId: job.id,
        type: job.type,
        error: errorMsg,
        retries: job.retries,
        maxRetries: job.maxRetries,
        queue: this.name,
      });

      // Retry if allowed
      if (job.retries < (job.maxRetries || 0)) {
        job.retries++;
        const delay = this.config.baseRetryDelay *
          Math.pow(this.config.retryDelayMultiplier, job.retries - 1);

        setTimeout(() => {
          if (this.isRunning) {
            this.pendingJobIds.add(job.id);
            // Re-add at front of same priority
            const insertIndex = this.queue.findIndex(
              (j) => j.priorityValue < job.priorityValue
            );
            if (insertIndex === -1) {
              this.queue.push(job);
            } else {
              this.queue.splice(insertIndex, 0, job);
            }
            this.processNext();
          }
        }, delay);
      } else {
        this.failed++;
      }
    } finally {
      this.running.delete(job.id);
      this.processNext();
    }
  }

  /**
   * Check if job type passes rate limit
   */
  private checkRateLimit(type: string): boolean {
    const now = Date.now();
    const lastRun = this.typeLastRun.get(type) || 0;
    const count = this.typeRunCount.get(type) || 0;

    // Reset count if more than 1 second since last run
    if (now - lastRun > 1000) {
      return true;
    }

    return count < this.config.rateLimit;
  }

  /**
   * Record a job run for rate limiting
   */
  private recordRateLimit(type: string): void {
    const now = Date.now();
    const lastRun = this.typeLastRun.get(type) || 0;

    if (now - lastRun > 1000) {
      // Reset counter
      this.typeRunCount.set(type, 1);
    } else {
      // Increment counter
      const count = this.typeRunCount.get(type) || 0;
      this.typeRunCount.set(type, count + 1);
    }

    this.typeLastRun.set(type, now);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

const queues = new Map<string, JobQueue>();

/**
 * Create or get a named job queue
 */
export function createJobQueue(name: string, config?: Partial<QueueConfig>): JobQueue {
  if (queues.has(name)) {
    return queues.get(name)!;
  }

  const queue = new JobQueue(name, config);
  queues.set(name, queue);
  return queue;
}

/**
 * Get an existing job queue
 */
export function getJobQueue(name: string): JobQueue | undefined {
  return queues.get(name);
}

/**
 * Get all queue stats
 */
export function getAllQueueStats(): QueueStats[] {
  return Array.from(queues.values()).map((q) => q.getStats());
}

/**
 * Shutdown all queues
 */
export async function shutdownAllQueues(): Promise<void> {
  log.info('Shutting down all job queues');
  const drainPromises = Array.from(queues.values()).map((q) => q.drain());
  await Promise.all(drainPromises);
  queues.clear();
}
