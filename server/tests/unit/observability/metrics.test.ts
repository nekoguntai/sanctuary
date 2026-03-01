import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  metricsService,
  normalizePath,
  recordCircuitBreakerState,
  recordCacheOperation,
  updateJobQueueMetrics,
} from '../../../src/observability/metrics';

describe('observability/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsService.reset();
  });

  it('initializes once and exposes registry helpers', async () => {
    metricsService.initialize();
    metricsService.initialize(); // no-op second call

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('Metrics service initialized');

    const contentType = metricsService.getContentType();
    expect(contentType).toContain('text/plain');

    const registry = metricsService.getRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe('function');

    const resetSpy = vi.spyOn(registry, 'resetMetrics');
    metricsService.reset();
    expect(resetSpy).toHaveBeenCalled();

    await expect(metricsService.getMetrics()).resolves.toEqual(expect.any(String));
  });

  it('normalizes UUIDs, numeric IDs, bitcoin addresses, and txids', () => {
    const path =
      '/api/wallets/123e4567-e89b-12d3-a456-426614174000' +
      '/devices/42/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' +
      '/tx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(normalizePath(path)).toBe(
      '/api/wallets/:id/devices/:id/address/:address/tx/:txid'
    );
  });

  it('records circuit breaker, cache operations, and queue depth metrics', async () => {
    recordCircuitBreakerState('electrum', 'open');
    recordCacheOperation('get', 'hit');
    updateJobQueueMetrics('sync', 3, 2, 1, 4);

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain('sanctuary_circuit_breaker_state{service="electrum"} 2');
    expect(metricsText).toContain('sanctuary_cache_operations_total{type="get",result="hit"} 1');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="waiting"} 3');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="active"} 2');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="delayed"} 1');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="failed"} 4');
  });
});
