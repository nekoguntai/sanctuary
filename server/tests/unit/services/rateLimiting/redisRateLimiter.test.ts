import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisRateLimiter } from '../../../../src/services/rateLimiting/redisRateLimiter';

describe('RedisRateLimiter', () => {
  const redis = {
    eval: vi.fn(),
    del: vi.fn(),
    ping: vi.fn(),
  };
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    limiter = new RedisRateLimiter(redis as any, 'test:');
  });

  it('consume returns allowed result and no retryAfter', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    redis.eval.mockResolvedValueOnce([1, 4, 7000]);

    const result = await limiter.consume('user-1', 5, 6, 1);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      'test:user-1',
      6000,
      1000,
      5,
      1
    );
    expect(result).toEqual({
      allowed: true,
      remaining: 4,
      limit: 5,
      resetAt: 7000,
      retryAfter: undefined,
    });
  });

  it('consume returns retryAfter when blocked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    redis.eval.mockResolvedValueOnce([0, 0, 5000]);

    const result = await limiter.consume('user-1', 5, 6, 1);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(4);
  });

  it('consume fails open when redis eval throws', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    redis.eval.mockRejectedValueOnce(new Error('redis down'));

    const result = await limiter.consume('user-1', 5, 6, 1);

    expect(result).toEqual({
      allowed: true,
      remaining: 5,
      limit: 5,
      resetAt: 7000,
    });
  });

  it('check returns allowed result', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    redis.eval.mockResolvedValueOnce([1, 3, 9000]);

    const result = await limiter.check('user-1', 5, 7);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('Check if would be allowed'),
      1,
      'test:user-1',
      7000,
      2000,
      5
    );
    expect(result).toEqual({
      allowed: true,
      remaining: 3,
      limit: 5,
      resetAt: 9000,
      retryAfter: undefined,
    });
  });

  it('check fails open when redis eval throws', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    redis.eval.mockRejectedValueOnce(new Error('redis down'));

    const result = await limiter.check('user-1', 6, 8);

    expect(result).toEqual({
      allowed: true,
      remaining: 6,
      limit: 6,
      resetAt: 11000,
    });
  });

  it('reset removes both rate-limit and sequence keys', async () => {
    redis.del.mockResolvedValueOnce(2);

    await limiter.reset('user-1');

    expect(redis.del).toHaveBeenCalledWith('test:user-1', 'test:user-1:seq');
  });

  it('getRemaining delegates to check', async () => {
    const checkSpy = vi.spyOn(limiter, 'check').mockResolvedValueOnce({
      allowed: true,
      remaining: 2,
      limit: 5,
      resetAt: 1234,
    });

    const remaining = await limiter.getRemaining('user-1', 5, 60);

    expect(checkSpy).toHaveBeenCalledWith('user-1', 5, 60);
    expect(remaining).toBe(2);
  });

  it('isHealthy returns true on PONG and false on errors', async () => {
    redis.ping.mockResolvedValueOnce('PONG');
    const healthy = await limiter.isHealthy();

    redis.ping.mockResolvedValueOnce('NOPE');
    const unhealthy = await limiter.isHealthy();

    redis.ping.mockRejectedValueOnce(new Error('down'));
    const unhealthyOnError = await limiter.isHealthy();

    expect(healthy).toBe(true);
    expect(unhealthy).toBe(false);
    expect(unhealthyOnError).toBe(false);
  });

  it('reports backend type as redis', () => {
    expect(limiter.getType()).toBe('redis');
  });
});
