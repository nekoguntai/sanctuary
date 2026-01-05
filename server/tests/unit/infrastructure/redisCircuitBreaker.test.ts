/**
 * Redis Circuit Breaker Tests
 *
 * Tests for the circuit breaker pattern implementation.
 */

import {
  CircuitBreaker,
  withRedisCircuitBreaker,
  getRedisCircuitBreakerStats,
  resetRedisCircuitBreaker,
  forceRedisCircuitBreakerState,
} from '../../../src/infrastructure/redisCircuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeout: 100,
      successThreshold: 2,
    });
  });

  describe('closed state', () => {
    it('should execute primary function when closed', async () => {
      const primary = jest.fn().mockResolvedValue('primary-result');
      const fallback = jest.fn().mockResolvedValue('fallback-result');

      const result = await breaker.execute(primary, fallback, 'test-op');

      expect(result).toBe('primary-result');
      expect(primary).toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      expect(breaker.getStats().state).toBe('closed');
    });

    it('should use fallback on primary failure but stay closed', async () => {
      const primary = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback-result');

      const result = await breaker.execute(primary, fallback, 'test-op');

      expect(result).toBe('fallback-result');
      expect(breaker.getStats().state).toBe('closed');
      expect(breaker.getStats().failures).toBe(1);
    });

    it('should open after reaching failure threshold', async () => {
      const primary = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback-result');

      // Execute until threshold reached
      for (let i = 0; i < 3; i++) {
        await breaker.execute(primary, fallback, 'test-op');
      }

      expect(breaker.getStats().state).toBe('open');
    });
  });

  describe('open state', () => {
    beforeEach(async () => {
      // Force circuit to open state
      const failing = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      for (let i = 0; i < 3; i++) {
        await breaker.execute(failing, fallback, 'test');
      }
    });

    it('should skip primary and use fallback immediately', async () => {
      const primary = jest.fn().mockResolvedValue('primary');
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await breaker.execute(primary, fallback, 'test-op');

      expect(result).toBe('fallback');
      expect(primary).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });

    it('should transition to half-open after recovery timeout', async () => {
      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      const primary = jest.fn().mockResolvedValue('primary');
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await breaker.execute(primary, fallback, 'test-op');

      // Should try primary (half-open state)
      expect(result).toBe('primary');
      expect(primary).toHaveBeenCalled();
    });
  });

  describe('half-open state', () => {
    beforeEach(async () => {
      // Force to open, then wait for half-open
      const failing = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      for (let i = 0; i < 3; i++) {
        await breaker.execute(failing, fallback, 'test');
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    it('should close after success threshold', async () => {
      const primary = jest.fn().mockResolvedValue('primary');
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Execute success threshold times
      for (let i = 0; i < 2; i++) {
        await breaker.execute(primary, fallback, 'test-op');
      }

      expect(breaker.getStats().state).toBe('closed');
    });

    it('should reopen on failure', async () => {
      const primary = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await breaker.execute(primary, fallback, 'test-op');

      expect(breaker.getStats().state).toBe('open');
    });
  });

  describe('stats', () => {
    it('should track call statistics', async () => {
      const primary = jest.fn().mockResolvedValue('primary');
      const fallback = jest.fn().mockResolvedValue('fallback');

      await breaker.execute(primary, fallback, 'test');
      await breaker.execute(primary, fallback, 'test');

      const stats = breaker.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.successes).toBe(0); // Only tracked in half-open
    });

    it('should track fallback calls', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      for (let i = 0; i < 3; i++) {
        await breaker.execute(failing, fallback, 'test');
      }

      const stats = breaker.getStats();
      expect(stats.fallbackCalls).toBe(3);
    });
  });

  describe('forceState', () => {
    it('should force circuit to specific state', () => {
      breaker.forceState('open');
      expect(breaker.getStats().state).toBe('open');

      breaker.forceState('half_open');
      expect(breaker.getStats().state).toBe('half_open');

      breaker.forceState('closed');
      expect(breaker.getStats().state).toBe('closed');
    });
  });

  describe('reset', () => {
    it('should reset all statistics', async () => {
      const failing = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      for (let i = 0; i < 3; i++) {
        await breaker.execute(failing, fallback, 'test');
      }

      breaker.reset();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failures).toBe(0);
      expect(stats.totalCalls).toBe(0);
      expect(stats.fallbackCalls).toBe(0);
    });
  });
});

describe('Global Redis Circuit Breaker', () => {
  beforeEach(() => {
    resetRedisCircuitBreaker();
  });

  it('should provide global circuit breaker function', async () => {
    const primary = jest.fn().mockResolvedValue('redis-value');
    const fallback = jest.fn().mockResolvedValue('local-value');

    const result = await withRedisCircuitBreaker(primary, fallback, 'cache-get');

    expect(result).toBe('redis-value');
    expect(primary).toHaveBeenCalled();
  });

  it('should track global stats', async () => {
    const primary = jest.fn().mockResolvedValue('value');
    const fallback = jest.fn().mockResolvedValue('fallback');

    await withRedisCircuitBreaker(primary, fallback, 'test');

    const stats = getRedisCircuitBreakerStats();
    expect(stats.totalCalls).toBeGreaterThanOrEqual(1);
  });

  it('should allow forcing global state', () => {
    forceRedisCircuitBreakerState('open');
    expect(getRedisCircuitBreakerStats().state).toBe('open');
  });
});
