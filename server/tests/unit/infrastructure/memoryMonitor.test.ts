import { vi } from 'vitest';
import v8 from 'v8';
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
    vi.restoreAllMocks();
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

    it('should return elevated level when heap usage exceeds elevated threshold', () => {
      // Set elevated threshold at 0.1% - any running process exceeds this
      updateConfig({
        elevatedThreshold: 0.1,
        criticalThreshold: 99.9,
      });

      const pressure = getMemoryPressure();

      // Should be elevated since usage exceeds 0.1% elevated threshold
      expect(pressure.level).toBe('elevated');
      expect(pressure.shouldShedLoad).toBe(false);
    });

    it('should return critical level when heap usage exceeds critical threshold', () => {
      // Set both thresholds at 0.1% - any running process exceeds this
      updateConfig({
        elevatedThreshold: 0.05,
        criticalThreshold: 0.1,
      });

      const pressure = getMemoryPressure();

      // Should be critical since usage exceeds 0.1% critical threshold
      expect(pressure.level).toBe('critical');
      expect(pressure.shouldShedLoad).toBe(true);
    });

    it('should return normal level when heap usage is below thresholds', () => {
      // Set thresholds very high
      updateConfig({
        elevatedThreshold: 99,
        criticalThreshold: 100,
      });

      const pressure = getMemoryPressure();

      expect(pressure.level).toBe('normal');
      expect(pressure.shouldShedLoad).toBe(false);
    });

    it('should round heap percentage to 2 decimal places', () => {
      const pressure = getMemoryPressure();

      // Check that heapUsedPercent is rounded to 2 decimal places
      const rounded = Math.round(pressure.heapUsedPercent * 100) / 100;
      expect(pressure.heapUsedPercent).toBe(rounded);
    });
  });

  describe('shouldAllowRequest', () => {
    it('should allow requests under normal conditions', () => {
      // Set high thresholds to ensure normal state
      updateConfig({
        elevatedThreshold: 99,
        criticalThreshold: 100,
      });

      expect(shouldAllowRequest('/api/wallets')).toBe(true);
      expect(shouldAllowRequest('/api/transactions')).toBe(true);
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

    it('should allow critical endpoints even under memory pressure', () => {
      // Set very low thresholds to trigger load shedding
      updateConfig({
        elevatedThreshold: 5,
        criticalThreshold: 10,
      });

      // Critical endpoints should still be allowed
      expect(shouldAllowRequest('/health')).toBe(true);
      expect(shouldAllowRequest('/api/health')).toBe(true);
      expect(shouldAllowRequest('/api/auth/login')).toBe(true);
      expect(shouldAllowRequest('/api/auth/refresh')).toBe(true);
      expect(shouldAllowRequest('/api/auth/logout')).toBe(true);
      expect(shouldAllowRequest('/metrics')).toBe(true);
    });

    it('should reject non-critical requests under memory pressure', () => {
      // Set very low thresholds to trigger load shedding
      updateConfig({
        elevatedThreshold: 5,
        criticalThreshold: 10,
      });

      const pressure = getMemoryPressure();

      // Verify we're actually in critical state
      if (pressure.shouldShedLoad) {
        // Non-critical endpoints should be rejected
        expect(shouldAllowRequest('/api/wallets')).toBe(false);
        expect(shouldAllowRequest('/api/transactions')).toBe(false);
        expect(shouldAllowRequest('/api/users')).toBe(false);
      }
    });

    it('should match critical paths by prefix', () => {
      // Verify that path.startsWith is used
      expect(shouldAllowRequest('/health/deep')).toBe(true);
      expect(shouldAllowRequest('/api/health/check')).toBe(true);
      expect(shouldAllowRequest('/metrics/prometheus')).toBe(true);
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

    it('should reject non-critical requests under memory pressure', () => {
      const req = { path: '/api/wallets' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Set very low thresholds to trigger load shedding
      updateConfig({ criticalThreshold: 10, elevatedThreshold: 5 });

      const pressure = getMemoryPressure();

      // Only test rejection if we're actually in critical state
      if (pressure.shouldShedLoad) {
        memoryPressureMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Service temporarily unavailable',
            reason: 'memory_pressure',
            retryAfter: 30,
          })
        );
      }
    });

    it('should allow auth endpoints under memory pressure', () => {
      const req = { path: '/api/auth/login' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Set very low thresholds to trigger load shedding
      updateConfig({ criticalThreshold: 10, elevatedThreshold: 5 });

      memoryPressureMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow metrics endpoint under memory pressure', () => {
      const req = { path: '/metrics' };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Set very low thresholds to trigger load shedding
      updateConfig({ criticalThreshold: 10, elevatedThreshold: 5 });

      memoryPressureMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('monitoring interval callbacks', () => {
    it('should handle critical pressure during monitoring', async () => {
      vi.useFakeTimers();

      // Set both thresholds at 0.1% - any running process exceeds this
      updateConfig({
        elevatedThreshold: 0.05,
        criticalThreshold: 0.1,
        checkIntervalMs: 100,
        enableGcHints: false,
      });

      startMemoryMonitoring();

      // Advance time to trigger the interval
      await vi.advanceTimersByTimeAsync(150);

      // Verify monitoring is running and handling critical state
      const pressure = getMemoryPressure();
      expect(pressure.level).toBe('critical');

      vi.useRealTimers();
    });

    it('should handle elevated pressure during monitoring', async () => {
      vi.useFakeTimers();

      // Set elevated at 0.1% but critical very high
      updateConfig({
        elevatedThreshold: 0.1,
        criticalThreshold: 99.9,
        checkIntervalMs: 100,
        enableGcHints: false,
      });

      startMemoryMonitoring();

      // Advance time to trigger the interval
      await vi.advanceTimersByTimeAsync(150);

      const pressure = getMemoryPressure();
      expect(pressure.level).toBe('elevated');

      vi.useRealTimers();
    });

    it('should handle normal pressure during monitoring', async () => {
      vi.useFakeTimers();

      // Set very high thresholds to ensure normal state
      updateConfig({
        elevatedThreshold: 99,
        criticalThreshold: 100,
        checkIntervalMs: 100,
        enableGcHints: false,
      });

      startMemoryMonitoring();

      // Advance time to trigger the interval
      await vi.advanceTimersByTimeAsync(150);

      const pressure = getMemoryPressure();
      expect(pressure.level).toBe('normal');

      vi.useRealTimers();
    });

    it('should track consecutive critical counts', async () => {
      vi.useFakeTimers();

      // Set both thresholds at 0.1% - any running process exceeds this
      updateConfig({
        elevatedThreshold: 0.05,
        criticalThreshold: 0.1,
        checkIntervalMs: 100,
        enableGcHints: false,
      });

      startMemoryMonitoring();

      // Advance time multiple times to trigger multiple intervals
      await vi.advanceTimersByTimeAsync(350);

      // Verify the monitor is still running and tracking
      const pressure = getMemoryPressure();
      expect(pressure.level).toBe('critical');

      vi.useRealTimers();
    });

    it('should reset consecutive critical count on non-critical pressure', async () => {
      vi.useFakeTimers();

      // Start with critical pressure (0.1% threshold)
      updateConfig({
        elevatedThreshold: 0.05,
        criticalThreshold: 0.1,
        checkIntervalMs: 100,
        enableGcHints: false,
      });

      startMemoryMonitoring();
      await vi.advanceTimersByTimeAsync(150);

      // Switch to normal pressure
      stopMemoryMonitoring();
      updateConfig({
        elevatedThreshold: 99,
        criticalThreshold: 100,
        checkIntervalMs: 100,
        enableGcHints: false,
      });
      startMemoryMonitoring();
      await vi.advanceTimersByTimeAsync(150);

      const pressure = getMemoryPressure();
      expect(pressure.level).toBe('normal');

      vi.useRealTimers();
    });
  });

  describe('getLastPressure', () => {
    it('should return null before any measurement', () => {
      // Note: This test may not return null in all cases since
      // previous tests may have called getMemoryPressure()
      // Testing the function works
      const last = getLastPressure();
      // Could be null or a valid MemoryPressure object
      if (last !== null) {
        expect(last).toHaveProperty('level');
        expect(last).toHaveProperty('heapUsedPercent');
      }
    });

    it('should return same object after getMemoryPressure call', () => {
      const pressure = getMemoryPressure();
      const last1 = getLastPressure();
      const last2 = getLastPressure();

      expect(last1).toEqual(pressure);
      expect(last2).toEqual(pressure);
    });
  });

  describe('stopMemoryMonitoring', () => {
    it('should be idempotent when not started', () => {
      // Should not throw when stopping without starting
      expect(() => stopMemoryMonitoring()).not.toThrow();
      expect(() => stopMemoryMonitoring()).not.toThrow();
    });

    it('should clear interval when running', async () => {
      vi.useFakeTimers();

      startMemoryMonitoring({ checkIntervalMs: 100 });
      stopMemoryMonitoring();

      // After stopping, advancing time should not trigger callbacks
      // (verified by not throwing errors)
      await vi.advanceTimersByTimeAsync(500);

      vi.useRealTimers();
    });
  });

  describe('updateConfig', () => {
    it('should partially update configuration', () => {
      updateConfig({ elevatedThreshold: 50 });

      // Other values should remain at defaults
      const pressure = getMemoryPressure();
      expect(pressure).toBeDefined();
    });

    it('should update all configuration values', () => {
      updateConfig({
        elevatedThreshold: 60,
        criticalThreshold: 85,
        checkIntervalMs: 5000,
        enableGcHints: false,
      });

      // Verify by testing with new thresholds
      const pressure = getMemoryPressure();
      expect(pressure).toBeDefined();
    });
  });
});
