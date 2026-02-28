import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStartAllServices, mockLogger } = vi.hoisted(() => ({
  mockStartAllServices: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/services/startupManager', () => ({
  startAllServices: mockStartAllServices,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const loadRegistry = async () => {
  vi.resetModules();
  return import('../../../src/services/serviceRegistry');
};

describe('serviceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers and returns services', async () => {
    const registry = await loadRegistry();
    registry.registerService({
      name: 'svc-a',
      start: vi.fn(),
    });
    registry.registerService({
      name: 'svc-b',
      start: vi.fn(),
    });

    expect(registry.getRegisteredServices().map(s => s.name)).toEqual(['svc-a', 'svc-b']);
  });

  it('warns when overwriting an existing service name', async () => {
    const registry = await loadRegistry();
    registry.registerService({ name: 'svc-a', start: vi.fn() });
    registry.registerService({ name: 'svc-a', start: vi.fn() });

    expect(mockLogger.warn).toHaveBeenCalledWith('Overwriting registered service', { name: 'svc-a' });
    expect(registry.getRegisteredServices()).toHaveLength(1);
  });

  it('starts registered services through startupManager', async () => {
    mockStartAllServices.mockResolvedValueOnce([{ name: 'svc-a', success: true }]);
    const registry = await loadRegistry();
    const svcA = { name: 'svc-a', start: vi.fn() };
    const svcB = { name: 'svc-b', start: vi.fn() };
    registry.registerService(svcA);
    registry.registerService(svcB);

    const result = await registry.startRegisteredServices();

    expect(mockStartAllServices).toHaveBeenCalledWith([svcA, svcB]);
    expect(result).toEqual([{ name: 'svc-a', success: true }]);
  });

  it('stops services in reverse order and tolerates stop errors', async () => {
    const stopOrder: string[] = [];
    const registry = await loadRegistry();
    registry.registerService({
      name: 'first',
      start: vi.fn(),
      stop: vi.fn(async () => {
        stopOrder.push('first');
      }),
    });
    registry.registerService({
      name: 'second',
      start: vi.fn(),
      stop: vi.fn(async () => {
        stopOrder.push('second');
        throw new Error('fail-stop');
      }),
    });
    registry.registerService({
      name: 'third',
      start: vi.fn(),
    });

    await registry.stopRegisteredServices();

    expect(stopOrder).toEqual(['second', 'first']);
    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to stop service', {
      name: 'second',
      error: 'fail-stop',
    });
  });
});
