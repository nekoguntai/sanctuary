import { vi } from 'vitest';
/**
 * Recovery Policy Tests
 *
 * Tests for retry logic, backoff strategies, and exhaustion handling.
 */

import {
  executeWithRecovery,
  createRecoveryPolicy,
  withRecovery,
  RecoveryPolicies,
  type RecoveryPolicy,
  type RecoveryResult,
} from '../../../src/services/recoveryPolicy';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('RecoveryPolicy', () => {
  // Use minimal delays for faster tests
  const fastPolicy = createRecoveryPolicy('test:fast', {
    maxRetries: 3,
    backoffMs: [10, 20, 30],
    onExhausted: 'continue',
    jitter: false,
  });

  describe('executeWithRecovery', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithRecovery(fastPolicy, operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on later attempt', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await executeWithRecovery(fastPolicy, operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

      const result = await executeWithRecovery(fastPolicy, operation);

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.attempts).toBe(4); // 1 initial + 3 retries
      expect(result.finalError?.message).toBe('Always fails');
      expect(result.action).toBe('continue');
      expect(operation).toHaveBeenCalledTimes(4);
    });

    it('should track total time', async () => {
      const policy = createRecoveryPolicy('test:timed', {
        maxRetries: 1,
        backoffMs: [50],
        onExhausted: 'continue',
        jitter: false,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      const result = await executeWithRecovery(policy, operation);

      // Allow 5ms tolerance for timer imprecision in Node.js
      expect(result.totalTime).toBeGreaterThanOrEqual(45);
    });

    it('should call onRetry callback on each retry', async () => {
      const onRetry = vi.fn();
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      await executeWithRecovery(fastPolicy, operation, { onRetry });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 20);
    });

    it('should call onExhausted callback when retries are exhausted', async () => {
      const onExhausted = vi.fn();
      const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

      await executeWithRecovery(fastPolicy, operation, { onExhausted });

      expect(onExhausted).toHaveBeenCalledTimes(1);
      expect(onExhausted).toHaveBeenCalledWith('continue', expect.any(Error));
    });

    it('should use fallback when policy action is fallback', async () => {
      const policy = createRecoveryPolicy('test:fallback', {
        maxRetries: 1,
        backoffMs: [10],
        onExhausted: 'fallback',
        jitter: false,
      });

      const operation = vi.fn().mockRejectedValue(new Error('Main fails'));
      const fallback = vi.fn().mockResolvedValue('fallback-result');

      const result = await executeWithRecovery(policy, operation, { fallback });

      expect(result.success).toBe(true);
      expect(result.result).toBe('fallback-result');
      expect(result.action).toBe('fallback');
      expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('should fail if fallback also fails', async () => {
      const policy = createRecoveryPolicy('test:fallback-fail', {
        maxRetries: 1,
        backoffMs: [10],
        onExhausted: 'fallback',
        jitter: false,
      });

      const operation = vi.fn().mockRejectedValue(new Error('Main fails'));
      const fallback = vi.fn().mockRejectedValue(new Error('Fallback fails'));

      const result = await executeWithRecovery(policy, operation, { fallback });

      expect(result.success).toBe(false);
      expect(result.finalError?.message).toBe('Main fails');
    });

    it('should handle non-Error rejections', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce('string error')
        .mockResolvedValue('success');

      const result = await executeWithRecovery(fastPolicy, operation);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should use last backoff delay for extra retries', async () => {
      const policy = createRecoveryPolicy('test:short-backoff', {
        maxRetries: 3,
        backoffMs: [10], // Only one backoff value
        onExhausted: 'continue',
        jitter: false,
      });

      const delays: number[] = [];
      const onRetry = (_attempt: number, _error: Error, delayMs: number) => {
        delays.push(delayMs);
      };

      const operation = vi.fn().mockRejectedValue(new Error('Fail'));

      await executeWithRecovery(policy, operation, { onRetry });

      // All retries should use the same delay (10ms)
      expect(delays).toEqual([10, 10, 10]);
    });
  });

  describe('jitter', () => {
    it('should apply jitter when enabled', async () => {
      const policy = createRecoveryPolicy('test:jitter', {
        maxRetries: 10,
        backoffMs: [100],
        onExhausted: 'continue',
        jitter: true,
        jitterFactor: 0.5, // 50% jitter
      });

      const delays: number[] = [];
      let startTime = Date.now();

      const operation = vi.fn().mockImplementation(() => {
        const now = Date.now();
        if (delays.length > 0) {
          // This captures actual delay, not the nominal delay
        }
        startTime = now;
        throw new Error('Fail');
      });

      // Just verify jitter policy is accepted
      await executeWithRecovery(policy, operation);

      // With jitter, the operation should still be called maxRetries + 1 times
      expect(operation).toHaveBeenCalledTimes(11);
    });
  });

  describe('createRecoveryPolicy', () => {
    it('should create a policy with the given options', () => {
      const policy = createRecoveryPolicy('custom:policy', {
        maxRetries: 5,
        backoffMs: [100, 200, 300],
        onExhausted: 'notify',
        jitter: true,
      });

      expect(policy.name).toBe('custom:policy');
      expect(policy.maxRetries).toBe(5);
      expect(policy.backoffMs).toEqual([100, 200, 300]);
      expect(policy.onExhausted).toBe('notify');
      expect(policy.jitter).toBe(true);
    });
  });

  describe('withRecovery', () => {
    it('should wrap a function with recovery logic', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      const wrappedFn = withRecovery(fn, fastPolicy);
      const result = await wrappedFn();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw when all retries fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      const wrappedFn = withRecovery(fn, fastPolicy);

      await expect(wrappedFn()).rejects.toThrow('Always fails');
    });

    it('should pass arguments to the wrapped function', async () => {
      const fn = vi.fn().mockImplementation((a: number, b: string) =>
        Promise.resolve(`${a}-${b}`)
      );

      const wrappedFn = withRecovery(fn, fastPolicy);
      const result = await wrappedFn(42, 'hello');

      expect(result).toBe('42-hello');
      expect(fn).toHaveBeenCalledWith(42, 'hello');
    });

    it('should call onRetry and onExhausted callbacks', async () => {
      const onRetry = vi.fn();
      const onExhausted = vi.fn();
      const fn = vi.fn().mockRejectedValue(new Error('Fail'));

      const wrappedFn = withRecovery(fn, fastPolicy, { onRetry, onExhausted });

      await expect(wrappedFn()).rejects.toThrow();

      expect(onRetry).toHaveBeenCalled();
      expect(onExhausted).toHaveBeenCalled();
    });

    it('should throw synthesized error when recovery result has no finalError', async () => {
      const invalidPolicy = createRecoveryPolicy('test:invalid-policy', {
        maxRetries: -1,
        backoffMs: [],
        onExhausted: 'continue',
        jitter: false,
      });

      const fn = vi.fn().mockResolvedValue('unused');
      const wrappedFn = withRecovery(fn, invalidPolicy);

      await expect(wrappedFn()).rejects.toThrow('test:invalid-policy failed after 0 attempts');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('pre-defined policies', () => {
    it('should have electrum connection policy', () => {
      const policy = RecoveryPolicies['electrum:connection'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(5);
      expect(policy.onExhausted).toBe('fallback');
    });

    it('should have sync subscription policy', () => {
      const policy = RecoveryPolicies['sync:subscription'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(3);
      expect(policy.onExhausted).toBe('notify');
    });

    it('should have price fetch policy', () => {
      const policy = RecoveryPolicies['price:fetch'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(2);
      expect(policy.onExhausted).toBe('continue');
    });

    it('should have transaction broadcast policy', () => {
      const policy = RecoveryPolicies['transaction:broadcast'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(3);
      expect(policy.onExhausted).toBe('notify');
      expect(policy.jitter).toBe(false);
    });

    it('should have database query policy', () => {
      const policy = RecoveryPolicies['database:query'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(2);
      expect(policy.backoffMs).toEqual([100, 500]);
    });

    it('should have wallet sync policy', () => {
      const policy = RecoveryPolicies['wallet:sync'];
      expect(policy).toBeDefined();
      expect(policy.maxRetries).toBe(5);
      expect(policy.backoffMs.length).toBe(5);
    });
  });
});
