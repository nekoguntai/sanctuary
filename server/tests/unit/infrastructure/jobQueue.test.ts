/**
 * Job Queue Tests
 *
 * Tests for the job queue with prioritization and rate limiting.
 */

import {
  JobQueue,
  createJobQueue,
  getJobQueue,
  getAllQueueStats,
  shutdownAllQueues,
  Job,
  JobPriority,
} from '../../../src/infrastructure/jobQueue';

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue('test', {
      maxConcurrent: 2,
      rateLimit: 100,
      defaultTimeout: 5000,
      defaultMaxRetries: 2,
      baseRetryDelay: 10,
      retryDelayMultiplier: 2,
    });
  });

  afterEach(async () => {
    await queue.drain();
  });

  describe('add', () => {
    it('should add jobs to the queue', () => {
      const job: Job<{ id: string }> = {
        id: 'job-1',
        type: 'test',
        priority: 'normal',
        data: { id: '1' },
        handler: jest.fn().mockResolvedValue(undefined),
      };

      const result = queue.add(job);

      expect(result).toBe(true);
      expect(queue.getStats().pending).toBe(1);
    });

    it('should reject duplicate job IDs', () => {
      const job: Job<{ id: string }> = {
        id: 'job-1',
        type: 'test',
        priority: 'normal',
        data: { id: '1' },
        handler: jest.fn().mockResolvedValue(undefined),
      };

      queue.add(job);
      const result = queue.add(job);

      expect(result).toBe(false);
      expect(queue.getStats().pending).toBe(1);
    });

    it('should order jobs by priority', () => {
      const lowJob: Job = {
        id: 'low',
        type: 'test',
        priority: 'low',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      };

      const highJob: Job = {
        id: 'high',
        type: 'test',
        priority: 'high',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      };

      const criticalJob: Job = {
        id: 'critical',
        type: 'test',
        priority: 'critical',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      };

      // Add in reverse priority order
      queue.add(lowJob);
      queue.add(highJob);
      queue.add(criticalJob);

      const stats = queue.getStats();
      expect(stats.byPriority.critical).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.low).toBe(1);
    });
  });

  describe('processing', () => {
    it('should process jobs when started', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      queue.add({
        id: 'job-1',
        type: 'test',
        priority: 'normal',
        data: { value: 42 },
        handler,
      });

      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith({ value: 42 });
      expect(queue.getStats().completed).toBe(1);
    });

    it('should respect concurrency limit', async () => {
      const activeJobs = new Set<string>();
      let maxConcurrent = 0;

      const handler = async (data: { id: string }) => {
        activeJobs.add(data.id);
        maxConcurrent = Math.max(maxConcurrent, activeJobs.size);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeJobs.delete(data.id);
      };

      for (let i = 0; i < 5; i++) {
        queue.add({
          id: `job-${i}`,
          type: 'test',
          priority: 'normal',
          data: { id: `job-${i}` },
          handler,
        });
      }

      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(queue.getStats().completed).toBe(5);
    });

    it('should process higher priority jobs first', async () => {
      const executionOrder: string[] = [];

      const handler = async (data: { id: string }) => {
        executionOrder.push(data.id);
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      // Add low priority first
      queue.add({
        id: 'low',
        type: 'test',
        priority: 'low',
        data: { id: 'low' },
        handler,
      });

      // Add high priority second
      queue.add({
        id: 'high',
        type: 'test',
        priority: 'high',
        data: { id: 'high' },
        handler,
      });

      // Use concurrency 1 to ensure serial execution
      const serialQueue = new JobQueue('serial-test', { maxConcurrent: 1 });
      serialQueue.add({
        id: 'low',
        type: 'test',
        priority: 'low',
        data: { id: 'low' },
        handler,
      });
      serialQueue.add({
        id: 'high',
        type: 'test',
        priority: 'high',
        data: { id: 'high' },
        handler,
      });

      serialQueue.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await serialQueue.drain();

      // High priority should execute before low
      expect(executionOrder.indexOf('high')).toBeLessThan(executionOrder.indexOf('low'));
    });
  });

  describe('retry', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0;
      const handler = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Simulated failure');
        }
      });

      queue.add({
        id: 'retry-job',
        type: 'test',
        priority: 'normal',
        data: {},
        handler,
        maxRetries: 3,
      });

      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(handler).toHaveBeenCalledTimes(2);
      expect(queue.getStats().completed).toBe(1);
    });

    it('should mark job as failed after max retries', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Always fails'));

      queue.add({
        id: 'fail-job',
        type: 'test',
        priority: 'normal',
        data: {},
        handler,
        maxRetries: 2,
      });

      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(handler).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(queue.getStats().failed).toBe(1);
    });
  });

  describe('timeout', () => {
    it('should timeout long-running jobs', async () => {
      const handler = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      );

      queue.add({
        id: 'slow-job',
        type: 'test',
        priority: 'normal',
        data: {},
        handler,
        timeout: 50,
        maxRetries: 0,
      });

      queue.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(queue.getStats().failed).toBe(1);
    });
  });

  describe('upgradePriority', () => {
    it('should upgrade job priority', () => {
      queue.add({
        id: 'upgrade-job',
        type: 'test',
        priority: 'low',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      });

      const result = queue.upgradePriority('upgrade-job', 'high');

      expect(result).toBe(true);
      expect(queue.getStats().byPriority.high).toBe(1);
      expect(queue.getStats().byPriority.low).toBe(0);
    });

    it('should not downgrade priority', () => {
      queue.add({
        id: 'downgrade-job',
        type: 'test',
        priority: 'high',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      });

      const result = queue.upgradePriority('downgrade-job', 'low');

      expect(result).toBe(false);
      expect(queue.getStats().byPriority.high).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all pending jobs', () => {
      for (let i = 0; i < 5; i++) {
        queue.add({
          id: `job-${i}`,
          type: 'test',
          priority: 'normal',
          data: {},
          handler: jest.fn().mockResolvedValue(undefined),
        });
      }

      const count = queue.clear();

      expect(count).toBe(5);
      expect(queue.getStats().pending).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      queue.add({
        id: 'job-1',
        type: 'test',
        priority: 'high',
        data: {},
        handler: jest.fn().mockResolvedValue(undefined),
      });

      const stats = queue.getStats();

      expect(stats.name).toBe('test');
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(0);
      expect(stats.byPriority.high).toBe(1);
    });
  });
});

describe('Queue Factory', () => {
  afterEach(async () => {
    await shutdownAllQueues();
  });

  it('should create named queues', () => {
    const queue1 = createJobQueue('queue1');
    const queue2 = createJobQueue('queue2');

    expect(queue1).not.toBe(queue2);
    expect(getJobQueue('queue1')).toBe(queue1);
    expect(getJobQueue('queue2')).toBe(queue2);
  });

  it('should return existing queue for same name', () => {
    const queue1 = createJobQueue('shared');
    const queue2 = createJobQueue('shared');

    expect(queue1).toBe(queue2);
  });

  it('should get all queue stats', () => {
    createJobQueue('stats1');
    createJobQueue('stats2');

    const allStats = getAllQueueStats();

    expect(allStats.length).toBe(2);
    expect(allStats.map((s) => s.name)).toContain('stats1');
    expect(allStats.map((s) => s.name)).toContain('stats2');
  });
});
