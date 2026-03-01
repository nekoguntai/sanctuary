import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type LoadedPrismaModule = {
  mod: typeof import('../../../src/models/prisma');
  connectMock: Mock;
  disconnectMock: Mock;
  queryRawMock: Mock;
  observeMock: Mock;
  prismaCtorOptions: any;
  logger: {
    info: Mock;
    warn: Mock;
    error: Mock;
    debug: Mock;
  };
  middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | null;
  onHandlers: Record<string, (...args: any[]) => any>;
  processOnSpy: ReturnType<typeof vi.spyOn>;
};

async function loadPrismaModule(): Promise<LoadedPrismaModule> {
  vi.resetModules();

  let middleware: ((params: any, next: (params: any) => Promise<any>) => Promise<any>) | null = null;
  let prismaCtorOptions: any = null;
  const connectMock = vi.fn();
  const disconnectMock = vi.fn();
  const queryRawMock = vi.fn();
  const observeMock = vi.fn();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const onHandlers: Record<string, (...args: any[]) => any> = {};

  vi.doMock('@prisma/client', () => ({
    PrismaClient: class MockPrismaClient {
      constructor(config: any) {
        prismaCtorOptions = config;
      }
      $use(fn: (params: any, next: (params: any) => Promise<any>) => Promise<any>): void {
        middleware = fn;
      }
      $connect = connectMock;
      $disconnect = disconnectMock;
      $queryRaw = queryRawMock;
    },
  }));

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => logger,
  }));

  vi.doMock('../../../src/utils/errors', () => ({
    getErrorMessage: (error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    },
  }));

  vi.doMock('../../../src/observability/metrics', () => ({
    dbQueryDuration: {
      observe: observeMock,
    },
  }));

  const processOnSpy = vi
    .spyOn(process, 'on')
    .mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      onHandlers[event] = handler;
      return process;
    }) as any);

  const mod = await import('../../../src/models/prisma');

  return {
    mod,
    connectMock,
    disconnectMock,
    queryRawMock,
    observeMock,
    prismaCtorOptions,
    logger,
    middleware,
    onHandlers,
    processOnSpy,
  };
}

describe('models/prisma behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connectWithRetry succeeds immediately when connection works', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock.mockResolvedValue(undefined);

    await expect(mod.connectWithRetry()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('initializes PrismaClient with verbose logs in development', async () => {
    process.env.NODE_ENV = 'development';
    const { prismaCtorOptions, processOnSpy } = await loadPrismaModule();

    expect(prismaCtorOptions).toEqual({
      log: ['query', 'error', 'warn'],
    });
    processOnSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('connectWithRetry retries and succeeds on a later attempt', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined);

    const promise = mod.connectWithRetry();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(connectMock).toHaveBeenCalledTimes(2);
    processOnSpy.mockRestore();
  });

  it('connectWithRetry throws after max retries', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock.mockRejectedValue(new Error('connection failed'));

    const promise = expect(mod.connectWithRetry()).rejects.toThrow('connection failed');
    await vi.runAllTimersAsync();
    await promise;

    expect(connectMock).toHaveBeenCalledTimes(5);
    processOnSpy.mockRestore();
  });

  it('checkDatabaseHealth and getDatabaseInfo return success/failure states', async () => {
    const { mod, queryRawMock, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('health down'))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('info down'));

    await expect(mod.checkDatabaseHealth()).resolves.toBe(true);
    await expect(mod.checkDatabaseHealth()).resolves.toBe(false);

    const healthyInfo = await mod.getDatabaseInfo();
    expect(healthyInfo.connected).toBe(true);
    expect(healthyInfo.latencyMs).toBeTypeOf('number');

    const unhealthyInfo = await mod.getDatabaseInfo();
    expect(unhealthyInfo.connected).toBe(false);
    expect(unhealthyInfo.error).toBe('info down');
    processOnSpy.mockRestore();
  });

  it('middleware records query metrics and slow-query warnings', async () => {
    const { middleware, observeMock, logger, processOnSpy } = await loadPrismaModule();
    expect(middleware).not.toBeNull();

    const nowSpy = vi.spyOn(Date, 'now').mockImplementationOnce(() => 0).mockImplementationOnce(() => 150);

    await expect(
      middleware!(
        { model: 'Wallet', action: 'findMany' },
        async () => ({ ok: true })
      )
    ).resolves.toEqual({ ok: true });

    expect(observeMock).toHaveBeenCalledWith({ operation: 'select' }, 0.15);
    expect(logger.warn).toHaveBeenCalledWith('Slow query (150ms): Wallet.findMany', {
      model: 'Wallet',
      action: 'findMany',
      duration: 150,
    });

    nowSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('middleware falls back to unknown operation when action is missing', async () => {
    const { middleware, observeMock, processOnSpy } = await loadPrismaModule();
    expect(middleware).not.toBeNull();

    await middleware!(
      { model: 'Wallet' },
      async () => ({ ok: true })
    );

    expect(observeMock).toHaveBeenCalledWith({ operation: 'other' }, expect.any(Number));
    processOnSpy.mockRestore();
  });

  it('caps latency window at configured size', async () => {
    const { mod, middleware, processOnSpy } = await loadPrismaModule();

    for (let i = 0; i < 101; i++) {
      await middleware!({ model: 'Wallet', action: 'findMany' }, async () => ({ i }));
    }

    const metrics = mod.getPoolHealthMetrics();
    expect(metrics.queryCount).toBe(100);
    processOnSpy.mockRestore();
  });

  it('pool health metrics report healthy/degraded/unhealthy and respect threshold config', async () => {
    const { mod, middleware, processOnSpy } = await loadPrismaModule();
    expect(mod.getPoolHealthMetrics()).toEqual({
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      queryCount: 0,
      status: 'healthy',
    });

    const nowSpy1 = vi.spyOn(Date, 'now').mockImplementationOnce(() => 0).mockImplementationOnce(() => 120);
    await middleware!({ model: 'Wallet', action: 'findUnique' }, async () => ({ ok: true }));
    nowSpy1.mockRestore();

    mod.configurePoolHealthThresholds({ warningThresholdMs: 100, criticalThresholdMs: 500 });
    expect(mod.getPoolHealthMetrics().status).toBe('degraded');

    mod.configurePoolHealthThresholds({ criticalThresholdMs: 110 });
    const unhealthy = mod.getPoolHealthMetrics();
    expect(unhealthy.status).toBe('unhealthy');
    expect(unhealthy.warning).toContain('critical threshold');
    processOnSpy.mockRestore();
  });

  it('can update only warning threshold without changing critical threshold', async () => {
    const { mod, processOnSpy } = await loadPrismaModule();

    mod.configurePoolHealthThresholds({ warningThresholdMs: 42 });
    expect(mod.getPoolHealthMetrics().status).toBe('healthy');

    processOnSpy.mockRestore();
  });

  it('disconnect waits for active middleware query to drain before disconnecting', async () => {
    const { mod, middleware, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    let resolveQuery: ((value: unknown) => void) | undefined;
    const inflight = middleware!(
      { model: 'Wallet', action: 'findMany' },
      async () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }) as any
    );

    const disconnectPromise = mod.disconnect();
    await vi.advanceTimersByTimeAsync(250);
    resolveQuery?.({ ok: true });
    await inflight;
    await vi.runAllTimersAsync();
    await disconnectPromise;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('disconnect force-closes when active queries do not drain before timeout', async () => {
    const { mod, middleware, disconnectMock, logger, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    void middleware!(
      { model: 'Wallet', action: 'findMany' },
      async () => new Promise(() => undefined) as any
    );

    const disconnectPromise = mod.disconnect();
    await vi.advanceTimersByTimeAsync(10_250);
    await disconnectPromise;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Force disconnecting with 1 queries still active');
    processOnSpy.mockRestore();
  });

  it('disconnects immediately when there are no active queries', async () => {
    const { mod, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    await mod.disconnect();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('startDatabaseHealthCheck runs checks, reconnects when unhealthy, and can be stopped', async () => {
    const { mod, queryRawMock, disconnectMock, connectMock, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(1);
    disconnectMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue(undefined);

    mod.startDatabaseHealthCheck(100);
    mod.startDatabaseHealthCheck(100); // should no-op when already running
    await vi.advanceTimersByTimeAsync(120);

    expect(queryRawMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalled();

    mod.stopDatabaseHealthCheck();
    const callsBefore = queryRawMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(queryRawMock.mock.calls.length).toBe(callsBefore);
    processOnSpy.mockRestore();
  });

  it('logs reconnection failure and health restoration after consecutive failures', async () => {
    const { mod, queryRawMock, connectMock, disconnectMock, logger, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(1);
    disconnectMock.mockResolvedValue(undefined);
    connectMock.mockRejectedValue(new Error('reconnect failed'));

    mod.startDatabaseHealthCheck(100);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(logger.error).toHaveBeenCalledWith('Database reconnection failed', {
      error: 'reconnect failed',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Database health restored after 1 consecutive failures'
    );

    mod.stopDatabaseHealthCheck();
    processOnSpy.mockRestore();
  });

  it('does not start a second reconnect while one reconnect attempt is in progress', async () => {
    const { mod, queryRawMock, connectMock, disconnectMock, processOnSpy } = await loadPrismaModule();
    queryRawMock.mockRejectedValue(new Error('db still down'));
    disconnectMock.mockResolvedValue(undefined);

    let resolveConnect: (() => void) | undefined;
    connectMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveConnect = resolve;
      })
    );

    mod.startDatabaseHealthCheck(10);
    await vi.advanceTimersByTimeAsync(20); // First unhealthy check -> starts reconnect
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    // Restart monitor while reconnect promise is still pending
    mod.stopDatabaseHealthCheck();
    mod.startDatabaseHealthCheck(10);
    await vi.advanceTimersByTimeAsync(20); // Should not trigger another reconnect
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    resolveConnect?.();
    await vi.advanceTimersByTimeAsync(50);
    mod.stopDatabaseHealthCheck();
    processOnSpy.mockRestore();
  });

  it('stopDatabaseHealthCheck is a no-op when monitoring was never started', async () => {
    const { mod, processOnSpy } = await loadPrismaModule();

    expect(() => mod.stopDatabaseHealthCheck()).not.toThrow();

    processOnSpy.mockRestore();
  });

  it('beforeExit handler stops health checks and disconnects prisma', async () => {
    const { mod, onHandlers, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    mod.startDatabaseHealthCheck(100);
    await onHandlers.beforeExit?.();

    expect(disconnectMock).toHaveBeenCalled();
    processOnSpy.mockRestore();
  });
});
