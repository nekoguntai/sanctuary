import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSet, mockEval, mockExists, mockGetRedisClient, mockIsRedisConnected } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockEval: vi.fn(),
  mockExists: vi.fn(),
  mockGetRedisClient: vi.fn(),
  mockIsRedisConnected: vi.fn(),
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  acquireLock,
  extendLock,
  isLocked,
  releaseLock,
  shutdownDistributedLock,
  type DistributedLock,
} from '../../../src/infrastructure/distributedLock';

describe('distributedLock Redis behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();

    mockGetRedisClient.mockReturnValue({
      set: mockSet,
      eval: mockEval,
      exists: mockExists,
    });
    mockIsRedisConnected.mockReturnValue(true);
  });

  it('acquires a Redis lock when SET NX PX succeeds', async () => {
    mockSet.mockResolvedValueOnce('OK');

    const lock = await acquireLock('redis:acquire', 3000);

    expect(lock).not.toBeNull();
    expect(lock?.isLocal).toBe(false);
    expect(lock?.key).toBe('redis:acquire');
    expect(mockSet).toHaveBeenCalledWith(
      'lock:redis:acquire',
      expect.any(String),
      'PX',
      3000,
      'NX'
    );
  });

  it('returns null when Redis lock already exists', async () => {
    mockSet.mockResolvedValueOnce(null);

    await expect(acquireLock('redis:busy', 3000)).resolves.toBeNull();
  });

  it('falls back to local lock when Redis acquisition throws', async () => {
    mockSet.mockRejectedValueOnce(new Error('redis set failed'));

    const first = await acquireLock('fallback:key', 3000);
    const second = await acquireLock('fallback:key', 3000);

    expect(first).not.toBeNull();
    expect(first?.isLocal).toBe(true);
    expect(second).toBeNull();
  });

  it('releases Redis locks based on eval result and handles eval errors', async () => {
    const lock: DistributedLock = {
      key: 'redis:release',
      token: 'token-1',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    };

    mockEval.mockResolvedValueOnce(1);
    await expect(releaseLock(lock)).resolves.toBe(true);

    mockEval.mockResolvedValueOnce(0);
    await expect(releaseLock(lock)).resolves.toBe(false);

    mockEval.mockRejectedValueOnce(new Error('eval failed'));
    await expect(releaseLock(lock)).resolves.toBe(false);
  });

  it('extends Redis lock TTL based on eval result and handles errors', async () => {
    const lock: DistributedLock = {
      key: 'redis:extend',
      token: 'token-2',
      expiresAt: Date.now() + 1000,
      isLocal: false,
    };

    mockEval.mockResolvedValueOnce(1);
    const extended = await extendLock(lock, 9000);
    expect(extended).not.toBeNull();
    expect(extended?.expiresAt).toBeGreaterThan(lock.expiresAt);

    mockEval.mockResolvedValueOnce(0);
    await expect(extendLock(lock, 9000)).resolves.toBeNull();

    mockEval.mockRejectedValueOnce(new Error('extend failed'));
    await expect(extendLock(lock, 9000)).resolves.toBeNull();
  });

  it('checks lock status with Redis exists and returns false for missing keys', async () => {
    mockExists.mockResolvedValueOnce(1);
    await expect(isLocked('redis:exists')).resolves.toBe(true);

    mockExists.mockResolvedValueOnce(0);
    await expect(isLocked('redis:missing')).resolves.toBe(false);
  });

  it('falls back to local state when Redis exists check fails', async () => {
    mockIsRedisConnected.mockReturnValue(false);
    const local = await acquireLock('local:fallback', 3000);
    expect(local).not.toBeNull();

    mockIsRedisConnected.mockReturnValue(true);
    mockExists.mockRejectedValueOnce(new Error('exists failed'));

    await expect(isLocked('local:fallback')).resolves.toBe(true);
  });
});
