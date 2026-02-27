import { vi } from 'vitest';

const {
  mockGetConfig,
  mockLogger,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

describe('workerHealth monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;

    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10000,
      },
    });
  });

  afterEach(async () => {
    const mod = await import('../../../src/services/workerHealth');
    await mod.stopWorkerHealthMonitor();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('starts monitor and reports healthy worker', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 'healthy',
        components: { redis: true, jobQueue: true, electrum: true },
        timestamp: '2026-02-27T00:00:00.000Z',
      }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.status).toBe('healthy');
    expect(status.failures).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on startup when initial health check fails', async () => {
    mockFetch.mockRejectedValue(new Error('connect failed'));

    const mod = await import('../../../src/services/workerHealth');

    await expect(mod.startWorkerHealthMonitor()).rejects.toThrow(
      /Worker health check failed at startup/
    );

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
    expect(status.healthy).toBe(false);
    expect(status.status).toBe('unreachable');
    expect(status.failures).toBeGreaterThan(0);
  });

  it('marks worker degraded when periodic check returns degraded status', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          status: 'healthy',
          components: { redis: true, jobQueue: true, electrum: true },
          timestamp: '2026-02-27T00:00:00.000Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          status: 'degraded',
          components: { redis: true, jobQueue: false, electrum: true },
          timestamp: '2026-02-27T00:00:10.000Z',
        }),
      });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    await vi.advanceTimersByTimeAsync(10000);

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.status).toBe('degraded');
    expect(status.failures).toBe(1);
    expect(status.worker?.status).toBe('degraded');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops monitor and prevents further polling', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 'healthy',
      }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    const callsAfterStart = mockFetch.mock.calls.length;

    await mod.stopWorkerHealthMonitor();
    await vi.advanceTimersByTimeAsync(30000);

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(callsAfterStart);
  });
});
