/**
 * WorkerJobQueue Tests
 *
 * Tests for the BullMQ-based worker job queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mock objects that will be shared
let mockQueueInstance: ReturnType<typeof createMockQueue>;
let mockWorkerInstance: ReturnType<typeof createMockWorker>;
let mockQueueEventsInstance: ReturnType<typeof createMockQueueEvents>;

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    addBulk: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount: vi.fn().mockResolvedValue(0),
    getCompletedCount: vi.fn().mockResolvedValue(0),
    getFailedCount: vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    isPaused: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWorker() {
  return {
    on: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockQueueEvents() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock BullMQ with factory that creates instances
vi.mock('bullmq', () => {
  // Create mock constructors that return fresh instances
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
    addBulk = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    getRepeatableJobs = vi.fn().mockResolvedValue([]);
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    isPaused = vi.fn().mockResolvedValue(false);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockWorker {
    on = vi.fn();
    isRunning = vi.fn().mockReturnValue(true);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockQueueEvents {
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    QueueEvents: MockQueueEvents,
  };
});

// Mock Redis
vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: vi.fn(() => ({
    options: {
      host: 'localhost',
      port: 6379,
    },
  })),
  isRedisConnected: vi.fn(() => true),
}));

// Mock distributed lock
vi.mock('../../../src/infrastructure/distributedLock', () => ({
  acquireLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

import { WorkerJobQueue } from '../../../src/worker/workerJobQueue';
import type { WorkerJobHandler } from '../../../src/worker/jobs/types';

describe('WorkerJobQueue', () => {
  let queue: WorkerJobQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new WorkerJobQueue({
      concurrency: 3,
      queues: ['sync', 'notifications'],
    });
  });

  describe('constructor', () => {
    it('should create queue with provided config', () => {
      const customQueue = new WorkerJobQueue({
        concurrency: 5,
        queues: ['test'],
        prefix: 'custom:prefix',
      });

      expect(customQueue).toBeDefined();
    });

    it('should use default prefix if not provided', () => {
      expect(queue).toBeDefined();
      // The default prefix 'sanctuary:worker' is set internally
    });
  });

  describe('initialize', () => {
    it('should create queues and workers', async () => {
      await queue.initialize();

      // Should have initialized successfully (no errors)
      expect(queue.isHealthy()).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await queue.initialize();
      const firstHealth = queue.isHealthy();

      await queue.initialize(); // Second call should be no-op
      const secondHealth = queue.isHealthy();

      expect(firstHealth).toBe(true);
      expect(secondHealth).toBe(true);
    });

    it('should throw if Redis is not connected', async () => {
      const { isRedisConnected } = await import('../../../src/infrastructure');
      vi.mocked(isRedisConnected).mockReturnValueOnce(false);

      const newQueue = new WorkerJobQueue({
        concurrency: 1,
        queues: ['test'],
      });

      await expect(newQueue.initialize()).rejects.toThrow('Redis is required');
    });
  });

  describe('registerHandler', () => {
    it('should register a job handler', async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<{ id: string }, { success: boolean }> = {
        name: 'test-job',
        queue: 'sync',
        handler: vi.fn().mockResolvedValue({ success: true }),
      };

      queue.registerHandler('sync', handler);

      expect(queue.getRegisteredJobs()).toContain('sync:test-job');
    });

    it('should warn when overwriting existing handler', async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<unknown, unknown> = {
        name: 'test-job',
        queue: 'sync',
        handler: vi.fn(),
      };

      queue.registerHandler('sync', handler);
      queue.registerHandler('sync', handler); // Register again

      // Should still work, just logs a warning
      expect(queue.getRegisteredJobs()).toContain('sync:test-job');
    });
  });

  describe('addJob', () => {
    it('should add a job to the queue', async () => {
      await queue.initialize();

      const job = await queue.addJob('sync', 'test-job', { id: '123' });

      expect(job).toBeDefined();
    });

    it('should return null for non-existent queue', async () => {
      await queue.initialize();

      const job = await queue.addJob('nonexistent', 'test-job', {});

      expect(job).toBeNull();
    });

    it('should pass job options', async () => {
      await queue.initialize();

      const job = await queue.addJob('sync', 'test-job', { id: '123' }, {
        priority: 1,
        delay: 1000,
      });

      expect(job).toBeDefined();
    });
  });

  describe('addBulkJobs', () => {
    it('should add multiple jobs at once', async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs('sync', [
        { name: 'job1', data: { id: '1' } },
        { name: 'job2', data: { id: '2' } },
      ]);

      expect(jobs).toHaveLength(2);
    });

    it('should return empty array for non-existent queue', async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs('nonexistent', [
        { name: 'job1', data: {} },
      ]);

      expect(jobs).toEqual([]);
    });
  });

  describe('scheduleRecurring', () => {
    it('should schedule a recurring job', async () => {
      await queue.initialize();

      const job = await queue.scheduleRecurring(
        'sync',
        'check-stale',
        {},
        '*/5 * * * *'
      );

      expect(job).toBeDefined();
    });
  });

  describe('getHealth', () => {
    it('should return health status for all queues', async () => {
      await queue.initialize();

      const health = await queue.getHealth();

      expect(health.healthy).toBe(true);
      expect(health.queues).toHaveProperty('sync');
      expect(health.queues).toHaveProperty('notifications');
      expect(health.queues.sync).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      });
    });
  });

  describe('isHealthy', () => {
    it('should return false when not initialized', () => {
      expect(queue.isHealthy()).toBe(false);
    });

    it('should return true when all workers are running', async () => {
      await queue.initialize();

      expect(queue.isHealthy()).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should close all workers, events, and queues', async () => {
      await queue.initialize();

      await queue.shutdown();

      // After shutdown, isHealthy should return false
      expect(queue.isHealthy()).toBe(false);
    });

    it('should only shutdown once', async () => {
      await queue.initialize();

      await queue.shutdown();
      await queue.shutdown(); // Second call should be no-op

      // No errors means it handled gracefully
      expect(queue.isHealthy()).toBe(false);
    });
  });

  describe('getRegisteredJobs', () => {
    it('should return empty array initially', async () => {
      await queue.initialize();

      expect(queue.getRegisteredJobs()).toEqual([]);
    });

    it('should return registered job names', async () => {
      await queue.initialize();

      queue.registerHandler('sync', {
        name: 'job1',
        queue: 'sync',
        handler: vi.fn(),
      });

      queue.registerHandler('notifications', {
        name: 'job2',
        queue: 'notifications',
        handler: vi.fn(),
      });

      const jobs = queue.getRegisteredJobs();
      expect(jobs).toContain('sync:job1');
      expect(jobs).toContain('notifications:job2');
    });
  });
});
