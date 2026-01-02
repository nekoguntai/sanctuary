/**
 * Async Utilities Tests
 *
 * Tests for async utility functions including concurrency limiting,
 * batch processing, timeouts, and retry logic.
 */

import {
  mapWithConcurrency,
  batchProcess,
  withTimeout,
  withRetry,
  sleep,
} from '../../../src/utils/async';

describe('Async Utilities', () => {
  describe('mapWithConcurrency', () => {
    it('should process all items and return results in original order', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await mapWithConcurrency(
        items,
        async (item) => item * 2,
        2
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should respect concurrency limit', async () => {
      let currentConcurrency = 0;
      let maxConcurrency = 0;
      const items = [1, 2, 3, 4, 5, 6];

      await mapWithConcurrency(
        items,
        async (item) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(10);
          currentConcurrency--;
          return item;
        },
        3
      );

      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });

    it('should handle empty array', async () => {
      const results = await mapWithConcurrency([], async (item) => item, 5);
      expect(results).toEqual([]);
    });

    it('should handle single item', async () => {
      const results = await mapWithConcurrency(
        [42],
        async (item) => item * 2,
        5
      );
      expect(results).toEqual([84]);
    });

    it('should pass correct index to function', async () => {
      const items = ['a', 'b', 'c'];
      const results = await mapWithConcurrency(
        items,
        async (item, index) => `${item}${index}`,
        2
      );

      expect(results).toEqual(['a0', 'b1', 'c2']);
    });

    it('should use default concurrency of 5', async () => {
      let maxConcurrency = 0;
      let currentConcurrency = 0;
      const items = Array.from({ length: 10 }, (_, i) => i);

      await mapWithConcurrency(items, async (item) => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await sleep(5);
        currentConcurrency--;
        return item;
      });

      expect(maxConcurrency).toBeLessThanOrEqual(5);
    });

    it('should handle errors in processing function', async () => {
      const items = [1, 2, 3];

      await expect(
        mapWithConcurrency(items, async (item) => {
          if (item === 2) throw new Error('Item 2 failed');
          return item;
        }, 2)
      ).rejects.toThrow('Item 2 failed');
    });

    it('should limit concurrency when fewer items than limit', async () => {
      let maxConcurrency = 0;
      let currentConcurrency = 0;
      const items = [1, 2]; // Only 2 items with limit 5

      await mapWithConcurrency(
        items,
        async (item) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(5);
          currentConcurrency--;
          return item;
        },
        5
      );

      expect(maxConcurrency).toBe(2);
    });
  });

  describe('batchProcess', () => {
    it('should split items into batches', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batchSizes: number[] = [];

      const results = await batchProcess(
        items,
        3,
        async (batch, index) => {
          batchSizes.push(batch.length);
          return batch.map((n) => n * 2);
        }
      );

      expect(batchSizes).toEqual([3, 3, 1]);
      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    });

    it('should handle empty array', async () => {
      const results = await batchProcess([], 5, async (batch) => batch);
      expect(results).toEqual([]);
    });

    it('should handle batch size larger than items', async () => {
      const items = [1, 2, 3];
      const batchCalls: number[] = [];

      const results = await batchProcess(
        items,
        10,
        async (batch, index) => {
          batchCalls.push(index);
          return batch.map((n) => n * 2);
        }
      );

      expect(batchCalls).toEqual([0]); // Only one batch
      expect(results).toEqual([2, 4, 6]);
    });

    it('should respect batch concurrency limit', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      let currentConcurrency = 0;
      let maxConcurrency = 0;

      await batchProcess(
        items,
        5,
        async (batch) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(10);
          currentConcurrency--;
          return batch;
        },
        2
      );

      expect(maxConcurrency).toBeLessThanOrEqual(2);
    });

    it('should pass correct batch index', async () => {
      const items = [1, 2, 3, 4, 5, 6];
      const indices: number[] = [];

      await batchProcess(
        items,
        2,
        async (batch, index) => {
          indices.push(index);
          return batch;
        }
      );

      expect(indices.sort()).toEqual([0, 1, 2]);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        100
      );

      expect(result).toBe('success');
    });

    it('should reject if promise exceeds timeout', async () => {
      await expect(
        withTimeout(sleep(200).then(() => 'late'), 50)
      ).rejects.toThrow('Operation timed out');
    });

    it('should use custom error message', async () => {
      await expect(
        withTimeout(sleep(100), 10, 'Custom timeout message')
      ).rejects.toThrow('Custom timeout message');
    });

    it('should propagate promise rejection', async () => {
      await expect(
        withTimeout(Promise.reject(new Error('Promise error')), 100)
      ).rejects.toThrow('Promise error');
    });

    it('should handle zero timeout', async () => {
      await expect(
        withTimeout(sleep(10), 0)
      ).rejects.toThrow('Operation timed out');
    });

    it('should resolve with correct value type', async () => {
      const result = await withTimeout(
        Promise.resolve({ data: 42 }),
        100
      );

      expect(result).toEqual({ data: 42 });
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should retry on failure and succeed', async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('Not yet');
          return 'success';
        },
        { maxRetries: 3, delayMs: 10 }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retries exceeded', async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error('Always fails');
          },
          { maxRetries: 2, delayMs: 10 }
        )
      ).rejects.toThrow('Always fails');

      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it('should apply exponential backoff', async () => {
      const delays: number[] = [];
      let lastTime = Date.now();

      await withRetry(
        async () => {
          const now = Date.now();
          if (delays.length > 0 || lastTime !== now) {
            delays.push(now - lastTime);
          }
          lastTime = now;
          if (delays.length < 3) throw new Error('Retry');
          return 'done';
        },
        { maxRetries: 3, delayMs: 20, backoffMultiplier: 2 }
      );

      // Delays should increase: ~20ms, ~40ms
      expect(delays.length).toBeGreaterThan(0);
      if (delays.length >= 2) {
        expect(delays[1]).toBeGreaterThan(delays[0]);
      }
    });

    it('should respect shouldRetry callback', async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error('Permanent error');
          },
          {
            maxRetries: 5,
            delayMs: 10,
            shouldRetry: (error) => !error.message.includes('Permanent'),
          }
        )
      ).rejects.toThrow('Permanent error');

      expect(attempts).toBe(1); // Should not retry
    });

    it('should call onRetry callback', async () => {
      const retryLogs: Array<{ error: string; attempt: number }> = [];

      await withRetry(
        async () => {
          if (retryLogs.length < 2) throw new Error('Failing');
          return 'done';
        },
        {
          maxRetries: 3,
          delayMs: 10,
          onRetry: (error, attempt) => {
            retryLogs.push({ error: error.message, attempt });
          },
        }
      );

      expect(retryLogs).toEqual([
        { error: 'Failing', attempt: 1 },
        { error: 'Failing', attempt: 2 },
      ]);
    });

    it('should handle non-Error throws', async () => {
      await expect(
        withRetry(
          async () => {
            throw 'String error';
          },
          { maxRetries: 0 }
        )
      ).rejects.toThrow('String error');
    });

    it('should use default options', async () => {
      let attempts = 0;

      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error('Always fails');
        })
      ).rejects.toThrow('Always fails');

      expect(attempts).toBe(4); // 1 initial + 3 default retries
    });
  });

  describe('sleep', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
      expect(elapsed).toBeLessThan(100);
    });

    it('should resolve with undefined', async () => {
      const result = await sleep(10);
      expect(result).toBeUndefined();
    });

    it('should handle zero delay', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
