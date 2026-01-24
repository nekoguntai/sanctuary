import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueInstances: any[] = [];
const workerInstances: any[] = [];
const queueEventsInstances: any[] = [];

class MockQueue {
  name: string;
  opts: any;
  add = vi.fn(async (name: string, data: any, options?: any) => ({
    id: `${name}-job`,
    name,
    data,
    opts: options,
  }));
  addBulk = vi.fn(async (jobs: Array<{ name: string; data: any; options?: any }>) =>
    jobs.map((job, index) => ({
      id: `${job.name}-${index}`,
      name: job.name,
      data: job.data,
      opts: job.options,
    }))
  );
  getRepeatableJobs = vi.fn(async () => []);
  getJob = vi.fn(async () => null);
  getWaitingCount = vi.fn(async () => 0);
  getActiveCount = vi.fn(async () => 0);
  getCompletedCount = vi.fn(async () => 0);
  getFailedCount = vi.fn(async () => 0);
  getDelayedCount = vi.fn(async () => 0);
  isPaused = vi.fn(async () => false);
  pause = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  clean = vi.fn(async () => []);
  close = vi.fn(async () => undefined);

  constructor(name: string, opts: any) {
    this.name = name;
    this.opts = opts;
    queueInstances.push(this);
  }
}

class MockWorker {
  name: string;
  processor: any;
  opts: any;
  handlers: Record<string, any> = {};
  close = vi.fn(async () => undefined);

  constructor(name: string, processor: any, opts: any) {
    this.name = name;
    this.processor = processor;
    this.opts = opts;
    workerInstances.push(this);
  }

  on(event: string, handler: any) {
    this.handlers[event] = handler;
    return this;
  }
}

class MockQueueEvents {
  name: string;
  opts: any;
  close = vi.fn(async () => undefined);

  constructor(name: string, opts: any) {
    this.name = name;
    this.opts = opts;
    queueEventsInstances.push(this);
  }
}

const mockGetRedisClient = vi.fn();
const mockIsRedisConnected = vi.fn();

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
}));

vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/tracing', () => ({
  withSpan: vi.fn(async (_name: string, fn: (span: { setAttribute: (k: string, v: any) => void }) => any) =>
    fn({ setAttribute: vi.fn() })
  ),
}));

const loadJobQueueService = async (config: Record<string, any> = {}) => {
  const module = await import('../../../src/jobs/jobQueue');
  const instance = module.default;
  const JobQueueService = (instance as any).constructor;
  return new JobQueueService(config);
};

const createRedisClient = () => ({
  options: {
    host: '127.0.0.1',
    port: 6379,
    password: 'secret',
    db: 2,
  },
});

describe('JobQueueService', () => {
  beforeEach(() => {
    queueInstances.length = 0;
    workerInstances.length = 0;
    queueEventsInstances.length = 0;
    vi.clearAllMocks();
  });

  it('throws if Redis is not available', async () => {
    mockGetRedisClient.mockReturnValue(null);
    mockIsRedisConnected.mockReturnValue(false);
    const queue = await loadJobQueueService();

    await expect(queue.initialize()).rejects.toThrow('Redis not available');
  });

  it('initializes queue, worker, and events with config', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService({ prefix: 'test:jobs', concurrency: 7 });

    await queue.initialize();

    expect(queueInstances).toHaveLength(1);
    expect(workerInstances).toHaveLength(1);
    expect(queueEventsInstances).toHaveLength(1);

    expect(queueInstances[0].opts.prefix).toBe('test:jobs');
    expect(workerInstances[0].opts.prefix).toBe('test:jobs');
    expect(workerInstances[0].opts.concurrency).toBe(7);
  });

  it('tracks processing count during handler execution', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();

    await queue.initialize();

    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    queue.register({
      name: 'sample-job',
      handler: vi.fn(async () => handlerPromise),
    });

    const processor = workerInstances[0].processor;
    const job = { id: 'job-1', name: 'sample-job', attemptsMade: 0 };

    const runPromise = processor(job);
    expect(queue.getProcessingCount()).toBe(1);

    resolveHandler!();
    await runPromise;
    expect(queue.getProcessingCount()).toBe(0);
  });

  it('returns null when adding a job without an initialized queue', async () => {
    const queue = await loadJobQueueService();
    const result = await queue.add('test', { ok: true });
    expect(result).toBeNull();
  });

  it('returns empty array when adding bulk jobs without an initialized queue', async () => {
    const queue = await loadJobQueueService();
    const result = await queue.addBulk([{ name: 'test', data: { ok: true } }]);
    expect(result).toEqual([]);
  });

  it('skips scheduling when repeatable job already exists', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const repeatableId = 'repeat:cleanup:0 0 * * *:UTC:limit=5';
    queueInstances[0].getRepeatableJobs.mockResolvedValue([
      { name: 'cleanup', id: repeatableId },
    ]);

    const result = await queue.schedule('cleanup', {}, { cron: '0 0 * * *', timezone: 'UTC', limit: 5 });
    expect(result).toBeNull();
    expect(queueInstances[0].add).not.toHaveBeenCalled();
  });

  it('schedules cron jobs with deterministic jobId and repeat options', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    await queue.schedule('cleanup', {}, { cron: '0 0 * * *', timezone: 'UTC', limit: 5 });

    expect(queueInstances[0].add).toHaveBeenCalledWith(
      'cleanup',
      {},
      expect.objectContaining({
        jobId: 'repeat:cleanup:0 0 * * *:UTC:limit=5',
        repeat: {
          pattern: '0 0 * * *',
          tz: 'UTC',
          limit: 5,
        },
      })
    );
  });

  it('returns job status details', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const job = {
      id: 'job-123',
      name: 'test',
      data: { value: 1 },
      progress: 25,
      returnvalue: { ok: true },
      failedReason: null,
      attemptsMade: 1,
      processedOn: 10,
      finishedOn: 20,
      getState: vi.fn(async () => 'completed'),
    };

    queueInstances[0].getJob.mockResolvedValue(job);

    const status = await queue.getJobStatus('job-123');
    expect(status).toEqual({
      id: 'job-123',
      name: 'test',
      data: { value: 1 },
      status: 'completed',
      progress: 25,
      returnvalue: { ok: true },
      failedReason: null,
      attemptsMade: 1,
      processedOn: 10,
      finishedOn: 20,
    });
  });

  it('returns false when removing a missing job', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getJob.mockResolvedValue(null);
    const result = await queue.removeJob('missing');
    expect(result).toBe(false);
  });

  it('reports health status from queue counts', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getWaitingCount.mockResolvedValue(2);
    queueInstances[0].getActiveCount.mockResolvedValue(1);
    queueInstances[0].getCompletedCount.mockResolvedValue(3);
    queueInstances[0].getFailedCount.mockResolvedValue(4);
    queueInstances[0].getDelayedCount.mockResolvedValue(5);
    queueInstances[0].isPaused.mockResolvedValue(true);

    const health = await queue.getHealth();
    expect(health).toEqual({
      healthy: true,
      queueName: 'main',
      waiting: 2,
      active: 1,
      completed: 3,
      failed: 4,
      delayed: 5,
      paused: true,
    });
  });

  it('shuts down worker, events, and queue', async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    expect(queue.isAvailable()).toBe(true);
    await queue.shutdown();

    expect(workerInstances[0].close).toHaveBeenCalled();
    expect(queueEventsInstances[0].close).toHaveBeenCalled();
    expect(queueInstances[0].close).toHaveBeenCalled();
    expect(queue.isAvailable()).toBe(false);
  });
});
