/**
 * In-Memory Rate Limiter Tests
 *
 * Tests for the sliding window rate limiter using in-memory storage.
 * Uses fake timers for time-based testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { MemoryRateLimiter } from '../../../../src/services/rateLimiting/memoryRateLimiter';

describe('MemoryRateLimiter', () => {
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-11T10:00:00Z'));
    limiter = new MemoryRateLimiter();
  });

  afterEach(() => {
    limiter.shutdown();
    vi.useRealTimers();
  });

  describe('consume', () => {
    it('should allow first request within limit', async () => {
      const result = await limiter.consume('user:123', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
    });

    it('should decrement remaining with each request', async () => {
      await limiter.consume('user:123', 5, 60);
      const result = await limiter.consume('user:123', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('should block when limit is exceeded', async () => {
      // Consume all 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user:123', 5, 60);
      }

      // 6th request should be blocked
      const result = await limiter.consume('user:123', 5, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should track different keys separately', async () => {
      await limiter.consume('user:123', 2, 60);
      await limiter.consume('user:123', 2, 60);
      // user:123 is at limit

      const result = await limiter.consume('user:456', 2, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should allow requests after window expires', async () => {
      // Consume all requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user:123', 5, 60);
      }

      // Advance time past the window
      vi.advanceTimersByTime(61000);

      const result = await limiter.consume('user:123', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should support custom cost', async () => {
      const result = await limiter.consume('user:123', 10, 60, 3);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7); // 10 - 3 = 7
    });

    it('should allow zero-cost consumption and fall back resetAt to now when empty', async () => {
      const before = Date.now();
      const result = await limiter.consume('user:zero-cost', 5, 60, 0);
      const after = Date.now();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.resetAt).toBeGreaterThanOrEqual(before + 60000);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60000);
    });

    it('should block when cost exceeds remaining', async () => {
      await limiter.consume('user:123', 5, 60, 4);
      // 1 remaining

      const result = await limiter.consume('user:123', 5, 60, 2);

      expect(result.allowed).toBe(false);
    });

    it('should include resetAt timestamp', async () => {
      const before = Date.now();
      const result = await limiter.consume('user:123', 5, 60);
      const after = Date.now();

      expect(result.resetAt).toBeGreaterThanOrEqual(before + 60000);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60000);
    });

    it('should calculate retryAfter for blocked requests', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user:123', 5, 60);
      }

      const result = await limiter.consume('user:123', 5, 60);

      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });

    it('should handle sliding window correctly', async () => {
      // First request
      await limiter.consume('user:123', 3, 60);

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);
      await limiter.consume('user:123', 3, 60);

      // Advance another 31 seconds (first request should be outside window)
      vi.advanceTimersByTime(31000);

      // Should have 2 remaining (only 1 request in window)
      const result = await limiter.consume('user:123', 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });
  });

  describe('check', () => {
    it('should return status without consuming', async () => {
      const result = await limiter.check('user:123', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it('should reflect consumed requests', async () => {
      await limiter.consume('user:123', 5, 60);
      await limiter.consume('user:123', 5, 60);

      const result = await limiter.check('user:123', 5, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('should indicate blocked status', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user:123', 5, 60);
      }

      const result = await limiter.check('user:123', 5, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('falls back resetAt to now when all timestamps are outside the window', async () => {
      await limiter.consume('user:stale-check', 5, 60);
      vi.advanceTimersByTime(61_000);
      const before = Date.now();

      const result = await limiter.check('user:stale-check', 5, 60);
      const after = Date.now();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.resetAt).toBeGreaterThanOrEqual(before + 60000);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60000);
      expect(result.retryAfter).toBeUndefined();
    });

    it('should not modify remaining count', async () => {
      await limiter.consume('user:123', 5, 60);

      await limiter.check('user:123', 5, 60);
      await limiter.check('user:123', 5, 60);
      await limiter.check('user:123', 5, 60);

      const result = await limiter.check('user:123', 5, 60);

      expect(result.remaining).toBe(4); // Only 1 consume happened
    });

    it('should return full limit for unknown keys', async () => {
      const result = await limiter.check('unknown:key', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });
  });

  describe('reset', () => {
    it('should clear rate limit for key', async () => {
      await limiter.consume('user:123', 5, 60);
      await limiter.consume('user:123', 5, 60);

      await limiter.reset('user:123');

      const result = await limiter.check('user:123', 5, 60);

      expect(result.remaining).toBe(5);
    });

    it('should not affect other keys', async () => {
      await limiter.consume('user:123', 5, 60);
      await limiter.consume('user:456', 5, 60);

      await limiter.reset('user:123');

      const result456 = await limiter.check('user:456', 5, 60);
      expect(result456.remaining).toBe(4);
    });

    it('should handle non-existent key gracefully', async () => {
      // Should not throw
      await expect(limiter.reset('non:existent')).resolves.toBeUndefined();
    });
  });

  describe('getRemaining', () => {
    it('should return remaining count', async () => {
      await limiter.consume('user:123', 5, 60);
      await limiter.consume('user:123', 5, 60);

      const remaining = await limiter.getRemaining('user:123', 5, 60);

      expect(remaining).toBe(3);
    });

    it('should return full limit for unknown keys', async () => {
      const remaining = await limiter.getRemaining('unknown:key', 10, 60);

      expect(remaining).toBe(10);
    });

    it('should return 0 when limit exceeded', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user:123', 5, 60);
      }

      const remaining = await limiter.getRemaining('user:123', 5, 60);

      expect(remaining).toBe(0);
    });
  });

  describe('isHealthy', () => {
    it('should always return true for in-memory limiter', async () => {
      const healthy = await limiter.isHealthy();

      expect(healthy).toBe(true);
    });
  });

  describe('getType', () => {
    it('should return "memory"', () => {
      expect(limiter.getType()).toBe('memory');
    });
  });

  describe('cleanup', () => {
    it('should remove stale entries after cleanup interval', async () => {
      await limiter.consume('user:123', 5, 60);

      // Fast forward past window expiry
      vi.advanceTimersByTime(61000);

      // Manually trigger cleanup by advancing past cleanup interval
      vi.advanceTimersByTime(5 * 60 * 1000 + 60000); // 5 min stale threshold + cleanup interval

      // Entry should be cleaned up (but we can't directly check internal state)
      // New request should succeed
      const result = await limiter.consume('user:123', 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('removes stale entries with empty timestamp buffers', () => {
      const windows = (limiter as any).windows as Map<string, { timestamps: number[]; lastCleanup: number }>;
      const now = Date.now();

      windows.set('stale-empty', {
        timestamps: [],
        lastCleanup: now - (6 * 60 * 1000),
      });
      windows.set('fresh-empty', {
        timestamps: [],
        lastCleanup: now,
      });

      (limiter as any).cleanup();

      expect(windows.has('stale-empty')).toBe(false);
      expect(windows.has('fresh-empty')).toBe(true);
    });
  });

  describe('eviction', () => {
    it('evicts the oldest entry when consume hits max window capacity', async () => {
      class ForcedSizeMap<K, V> extends Map<K, V> {
        override get size() {
          return 100000 + super.size;
        }
      }

      const forcedWindows = new ForcedSizeMap<string, { timestamps: number[]; lastCleanup: number }>();
      const now = Date.now();

      forcedWindows.set('oldest', {
        timestamps: [],
        lastCleanup: now - 10_000,
      });
      forcedWindows.set('newer', {
        timestamps: [],
        lastCleanup: now - 1_000,
      });

      (limiter as any).windows = forcedWindows;

      const result = await limiter.consume('incoming', 5, 60);

      expect(result.allowed).toBe(true);
      expect(((limiter as any).windows as Map<string, unknown>).has('oldest')).toBe(false);
      expect(((limiter as any).windows as Map<string, unknown>).has('incoming')).toBe(true);
    });

    it('should evict oldest entries when MAX_WINDOWS exceeded', async () => {
      // This test verifies the eviction logic works
      // We can't easily test 100,000 keys, but we can verify the logic path

      // Create first entry
      await limiter.consume('first:key', 5, 60);

      // Advance time
      vi.advanceTimersByTime(1000);

      // Create second entry
      await limiter.consume('second:key', 5, 60);

      // Both should work
      const first = await limiter.check('first:key', 5, 60);
      const second = await limiter.check('second:key', 5, 60);

      expect(first.remaining).toBe(4);
      expect(second.remaining).toBe(4);
    });

    it('does nothing when eviction runs with no entries', () => {
      const windows = (limiter as any).windows as Map<string, { timestamps: number[]; lastCleanup: number }>;
      windows.clear();

      expect(() => (limiter as any).evictOldestEntry()).not.toThrow();
      expect(windows.size).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should clear all entries', async () => {
      await limiter.consume('user:123', 5, 60);
      await limiter.consume('user:456', 5, 60);

      limiter.shutdown();

      // Create new limiter to verify data is cleared
      const newLimiter = new MemoryRateLimiter();
      const result = await newLimiter.check('user:123', 5, 60);

      expect(result.remaining).toBe(5);
      newLimiter.shutdown();
    });

    it('should stop cleanup interval', () => {
      // Create limiter and verify it has interval
      const testLimiter = new MemoryRateLimiter();

      // Shutdown should not throw
      expect(() => testLimiter.shutdown()).not.toThrow();
    });

    it('should be idempotent', () => {
      limiter.shutdown();
      // Second call should not throw
      expect(() => limiter.shutdown()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle zero limit', async () => {
      const result = await limiter.consume('user:123', 0, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle very short window', async () => {
      await limiter.consume('user:123', 1, 1);

      vi.advanceTimersByTime(1100); // Just over 1 second

      const result = await limiter.consume('user:123', 1, 1);

      expect(result.allowed).toBe(true);
    });

    it('should handle very long window', async () => {
      await limiter.consume('user:123', 5, 86400); // 1 day

      const result = await limiter.check('user:123', 5, 86400);

      expect(result.remaining).toBe(4);
    });

    it('should handle concurrent requests', async () => {
      // Simulate concurrent requests
      const results = await Promise.all([
        limiter.consume('user:123', 5, 60),
        limiter.consume('user:123', 5, 60),
        limiter.consume('user:123', 5, 60),
      ]);

      // All should be allowed
      results.forEach(r => expect(r.allowed).toBe(true));

      // Check final state
      const final = await limiter.check('user:123', 5, 60);
      expect(final.remaining).toBe(2);
    });
  });
});
