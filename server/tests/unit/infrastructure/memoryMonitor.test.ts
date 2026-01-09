import { vi } from 'vitest';
/**
 * Memory Monitor Tests
 *
 * Tests for memory pressure monitoring and backpressure.
 */

import {
  getMemoryPressure,
  getLastPressure,
  shouldAllowRequest,
  getMemoryStats,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  updateConfig,
  memoryPressureMiddleware,
} from '../../../src/infrastructure/memoryMonitor';

describe('Memory Monitor', () => {
  afterEach(() => {
    stopMemoryMonitoring();
    // Reset config to defaults
    updateConfig({
      elevatedThreshold: 75,
      criticalThreshold: 90,
      checkIntervalMs: 10000,
      enableGcHints: true,
    });
  });

  describe('getMemoryPressure', () => {
    it('should return memory pressure status', () => {
      const pressure = getMemoryPressure();

      expect(pressure).toHaveProperty('level');
      expect(pressure).toHaveProperty('heapUsedPercent');
      expect(pressure).toHaveProperty('shouldShedLoad');
      expect(pressure).toHaveProperty('heapUsedBytes');
      expect(pressure).toHaveProperty('heapTotalBytes');
      expect(pressure).toHaveProperty('externalBytes');
      expect(pressure).toHaveProperty('rssBytes');

      expect(['normal', 'elevated', 'critical']).toContain(pressure.level);
      expect(pressure.heapUsedPercent).toBeGreaterThanOrEqual(0);
      expect(pressure.heapUsedPercent).toBeLessThanOrEqual(100);
    });

    it('should cache last pressure reading', () => {
      const pressure = getMemoryPressure();
      const lastPressure = getLastPressure();

      expect(lastPressure).toEqual(pressure);
    });
  });

  describe('shouldAllowRequest', () => {
    it('should allow requests under normal conditions', () => {
      // Under normal memory conditions, all requests should be allowed
      const pressure = getMemoryPressure();

      if (pressure.level !== 'critical') {
        expect(shouldAllowRequest('/api/wallets')).toBe(true);
        expect(shouldAllowRequest('/api/transactions')).toBe(true);
      }
    });

    it('should always allow critical endpoints', () => {
      // These should always be allowed regardless of memory pressure
      expect(shouldAllowRequest('/health')).toBe(true);
      expect(shouldAllowRequest('/api/health')).toBe(true);
      expect(shouldAllowRequest('/api/auth/login')).toBe(true);
      expect(shouldAllowRequest('/api/auth/refresh')).toBe(true);
      expect(shouldAllowRequest('/api/auth/logout')).toBe(true);
      expect(shouldAllowRequest('/metrics')).toBe(true);
    });
  });

  describe('getMemoryStats', () => {
    it('should return detailed memory statistics', () => {
      const stats = getMemoryStats();

      expect(stats).toHaveProperty('pressure');
      expect(stats).toHaveProperty('heapStats');
      expect(stats).toHaveProperty('processMemory');

      expect(stats.heapStats).toHaveProperty('total_heap_size');
      expect(stats.heapStats).toHaveProperty('used_heap_size');
      expect(stats.processMemory).toHaveProperty('rss');
      expect(stats.processMemory).toHaveProperty('heapUsed');
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start and stop monitoring', () => {
      startMemoryMonitoring({ checkIntervalMs: 100 });

      // Should not throw when stopping
      expect(() => stopMemoryMonitoring()).not.toThrow();
    });

    it('should warn when starting twice', () => {
      startMemoryMonitoring({ checkIntervalMs: 100 });
      // Starting again should not throw
      expect(() => startMemoryMonitoring({ checkIntervalMs: 100 })).not.toThrow();

      stopMemoryMonitoring();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      // Set very high thresholds so we're always "normal"
      updateConfig({
        elevatedThreshold: 99,
        criticalThreshold: 100,
      });

      const pressure = getMemoryPressure();

      // With 99% elevated threshold, we should be normal
      expect(pressure.level).toBe('normal');
    });
  });

  describe('memoryPressureMiddleware', () => {
    it('should call next for normal requests', () => {
      const req = { path: '/api/wallets' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Set high thresholds to ensure normal state
      updateConfig({ criticalThreshold: 100, elevatedThreshold: 99 });

      memoryPressureMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should always allow health endpoint', () => {
      const req = { path: '/health' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      memoryPressureMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
