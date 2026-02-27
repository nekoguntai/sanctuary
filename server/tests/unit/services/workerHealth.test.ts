import { vi } from 'vitest';

const getConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/config', () => ({
  getConfig: getConfigMock,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('workerHealth service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('starts with unknown worker status before probing', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://localhost:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    const service = await import('../../../src/services/workerHealth');
    const status = service.getWorkerHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.availability).toBe('unknown');
  });

  it('returns healthy when worker health endpoint reports healthy', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy' }),
    });

    const service = await import('../../../src/services/workerHealth');
    const status = await service.probeWorkerHealth();

    expect(status.healthy).toBe(true);
    expect(status.availability).toBe('healthy');
  });

  it('returns unhealthy when worker health endpoint is unreachable', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    (global as any).fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const service = await import('../../../src/services/workerHealth');
    const status = await service.probeWorkerHealth();

    expect(status.healthy).toBe(false);
    expect(status.availability).toBe('unhealthy');
    expect(status.error).toContain('ECONNREFUSED');
  });

  it('returns degraded-but-available when worker health endpoint reports degraded', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ status: 'degraded' }),
    });

    const service = await import('../../../src/services/workerHealth');
    const status = await service.probeWorkerHealth();

    expect(status.healthy).toBe(true);
    expect(status.availability).toBe('degraded');
    expect(status.error).toContain('degraded');
  });

  it('throws on monitor startup when worker is unavailable', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    (global as any).fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const service = await import('../../../src/services/workerHealth');

    await expect(service.startWorkerHealthMonitor()).rejects.toThrow('Worker is required but unavailable');
  });

  it('does not throw on monitor startup when worker is degraded but reachable', async () => {
    getConfigMock.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 1000,
        healthCheckIntervalMs: 10000,
      },
    });

    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ status: 'degraded' }),
    });

    const service = await import('../../../src/services/workerHealth');

    await expect(service.startWorkerHealthMonitor()).resolves.toBeUndefined();
    service.stopWorkerHealthMonitor();
  });
});
