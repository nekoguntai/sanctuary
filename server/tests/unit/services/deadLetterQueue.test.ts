import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockGetDistributedCache,
  mockCache,
  mockLog,
} = vi.hoisted(() => ({
  mockGetDistributedCache: vi.fn(),
  mockCache: {
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedCache: mockGetDistributedCache,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import {
  deadLetterQueue,
  recordSyncFailure,
  recordPushFailure,
  recordElectrumFailure,
  recordTransactionFailure,
} from '../../../src/services/deadLetterQueue';

async function clearDlq() {
  for (const entry of deadLetterQueue.getAll()) {
    await deadLetterQueue.remove(entry.id);
  }
  (deadLetterQueue as any).entries = new Map();
}

describe('deadLetterQueue', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetDistributedCache.mockReturnValue(mockCache);
    deadLetterQueue.stop();
    await clearDlq();
  });

  afterEach(async () => {
    deadLetterQueue.stop();
    await clearDlq();
  });

  it('starts/stops cleanup interval and calls unref()', () => {
    const timer = { unref: vi.fn() } as any;
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    deadLetterQueue.start();
    deadLetterQueue.start();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(timer.unref).toHaveBeenCalledTimes(1);

    deadLetterQueue.stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  });

  it('runs cleanup when interval callback fires', () => {
    const timer = { unref: vi.fn() } as any;
    let intervalCallback: (() => void) | null = null;
    vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallback = cb;
      return timer;
    }) as any);
    const cleanupSpy = vi.spyOn(deadLetterQueue as any, 'cleanup');

    deadLetterQueue.start();
    expect(intervalCallback).not.toBeNull();
    intervalCallback?.();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('adds and updates entries with Redis persistence', async () => {
    const id = await deadLetterQueue.add(
      'sync',
      'wallet_sync',
      { walletId: 'w1' },
      new Error('sync failed'),
      3
    );

    expect(id).toContain('sync-');
    expect(deadLetterQueue.get(id)).toEqual(expect.objectContaining({
      category: 'sync',
      operation: 'wallet_sync',
      attempts: 3,
      error: 'sync failed',
    }));
    expect(mockCache.set).toHaveBeenCalled();

    await deadLetterQueue.update(id, 'retry failed', 4);
    expect(deadLetterQueue.get(id)).toEqual(expect.objectContaining({
      attempts: 4,
      error: 'retry failed',
    }));
  });

  it('captures error stack when update receives an Error instance', async () => {
    const id = await deadLetterQueue.add('sync', 'wallet_sync', { walletId: 'w1' }, 'initial', 1);
    const err = new Error('update failed');

    await deadLetterQueue.update(id, err, 2);

    expect(deadLetterQueue.get(id)).toEqual(expect.objectContaining({
      attempts: 2,
      error: 'update failed',
      errorStack: expect.stringContaining('update failed'),
    }));
  });

  it('evicts oldest entry when size limit is reached', async () => {
    const entries = new Map(
      Array.from({ length: 1000 }, (_, index) => [
        `old-${index}`,
        {
          id: `old-${index}`,
          category: 'other',
          operation: `op-${index}`,
          payload: {},
          error: 'old',
          attempts: 1,
          firstFailedAt: new Date('2025-01-01T00:00:00.000Z'),
          lastFailedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      ])
    );
    (deadLetterQueue as any).entries = entries;

    const id = await deadLetterQueue.add('sync', 'new-op', { walletId: 'w1' }, 'new', 1);

    expect(deadLetterQueue.get('old-0')).toBeUndefined();
    expect(deadLetterQueue.get(id)).toBeDefined();
    expect(deadLetterQueue.getAll().length).toBe(1000);
  });

  it('handles LRU eviction edge case when oldest map key is falsy', async () => {
    const baseEntry = {
      category: 'other',
      operation: 'op',
      payload: {},
      error: 'old',
      attempts: 1,
      firstFailedAt: new Date('2025-01-01T00:00:00.000Z'),
      lastFailedAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const entries = new Map<any, any>([
      [undefined, { id: 'undefined-key', ...baseEntry }],
    ]);
    for (let index = 0; index < 999; index++) {
      entries.set(`old-${index}`, { id: `old-${index}`, ...baseEntry });
    }
    (deadLetterQueue as any).entries = entries;

    await deadLetterQueue.add('sync', 'new-op', { walletId: 'w1' }, 'new', 1);

    expect((deadLetterQueue as any).entries.has(undefined)).toBe(true);
    expect(deadLetterQueue.getAll().length).toBe(1001);
  });

  it('ignores updates for missing entries', async () => {
    await expect(deadLetterQueue.update('missing-id', 'x', 1)).resolves.toBeUndefined();
  });

  it('supports category filtering, sorted listing, and stats', async () => {
    const id1 = await deadLetterQueue.add('sync', 'op1', { a: 1 }, 'err1', 1);
    const id2 = await deadLetterQueue.add('push', 'op2', { b: 2 }, 'err2', 2);

    const e1 = deadLetterQueue.get(id1)!;
    const e2 = deadLetterQueue.get(id2)!;
    e1.lastFailedAt = new Date('2025-01-01T00:00:00.000Z');
    e2.lastFailedAt = new Date('2025-01-02T00:00:00.000Z');
    e1.firstFailedAt = new Date('2025-01-01T00:00:00.000Z');
    e2.firstFailedAt = new Date('2025-01-02T00:00:00.000Z');

    expect(deadLetterQueue.getByCategory('sync')).toHaveLength(1);
    expect(deadLetterQueue.getAll().map((e) => e.id)).toEqual([id2, id1]);
    expect(deadLetterQueue.getAll(1)).toHaveLength(1);

    expect(deadLetterQueue.getStats()).toEqual(expect.objectContaining({
      total: 2,
      byCategory: expect.objectContaining({ sync: 1, push: 1 }),
      oldest: new Date('2025-01-01T00:00:00.000Z'),
      newest: new Date('2025-01-02T00:00:00.000Z'),
    }));
  });

  it('retains newest timestamp when later entries are older', async () => {
    const id1 = await deadLetterQueue.add('sync', 'op1', { a: 1 }, 'err1', 1);
    const id2 = await deadLetterQueue.add('push', 'op2', { b: 2 }, 'err2', 2);

    const e1 = deadLetterQueue.get(id1)!;
    const e2 = deadLetterQueue.get(id2)!;
    e1.firstFailedAt = new Date('2025-01-01T00:00:00.000Z');
    e1.lastFailedAt = new Date('2025-01-03T00:00:00.000Z');
    e2.firstFailedAt = new Date('2025-01-02T00:00:00.000Z');
    e2.lastFailedAt = new Date('2025-01-01T12:00:00.000Z');

    const stats = deadLetterQueue.getStats();
    expect(stats.oldest).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    expect(stats.newest).toEqual(new Date('2025-01-03T00:00:00.000Z'));
  });

  it('removes entries and clears categories', async () => {
    const id1 = await deadLetterQueue.add('electrum', 'connect', { host: 'h' }, 'err', 1);
    const id2 = await deadLetterQueue.add('electrum', 'connect2', { host: 'h2' }, 'err', 2);
    const id3 = await deadLetterQueue.add('sync', 'sync1', { walletId: 'w' }, 'err', 1);

    await expect(deadLetterQueue.remove(id1)).resolves.toBe(true);
    await expect(deadLetterQueue.remove('missing')).resolves.toBe(false);
    expect(mockCache.delete).toHaveBeenCalledWith(expect.stringContaining(id1));

    const cleared = await deadLetterQueue.clearCategory('electrum');
    expect(cleared).toBe(1);
    expect(deadLetterQueue.get(id2)).toBeUndefined();
    expect(deadLetterQueue.get(id3)).toBeDefined();
  });

  it('cleans up expired entries', async () => {
    const id = await deadLetterQueue.add('other', 'old-op', {}, 'old', 1);
    const entry = deadLetterQueue.get(id)!;
    entry.lastFailedAt = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000));

    (deadLetterQueue as any).cleanup();
    expect(deadLetterQueue.get(id)).toBeUndefined();
  });

  it('cleanup removes only expired entries and keeps recent ones', async () => {
    const expiredId = await deadLetterQueue.add('other', 'expired-op', {}, 'old', 1);
    const recentId = await deadLetterQueue.add('other', 'recent-op', {}, 'new', 1);
    const expiredEntry = deadLetterQueue.get(expiredId)!;
    const recentEntry = deadLetterQueue.get(recentId)!;

    expiredEntry.lastFailedAt = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000));
    recentEntry.lastFailedAt = new Date();

    (deadLetterQueue as any).cleanup();
    expect(deadLetterQueue.get(expiredId)).toBeUndefined();
    expect(deadLetterQueue.get(recentId)).toBeDefined();
  });

  it('handles redis persistence/delete/load failures gracefully', async () => {
    mockCache.set.mockRejectedValueOnce(new Error('set failed'));
    const id = await deadLetterQueue.add('sync', 'op', {}, 'err', 1);
    expect(deadLetterQueue.get(id)).toBeDefined();

    mockCache.delete.mockRejectedValueOnce(new Error('delete failed'));
    await expect(deadLetterQueue.remove(id)).resolves.toBe(true);

    mockGetDistributedCache.mockReturnValue(null);
    await expect(deadLetterQueue.loadFromRedis()).resolves.toBeUndefined();

    mockGetDistributedCache.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    await expect(deadLetterQueue.loadFromRedis()).resolves.toBeUndefined();
  });

  it('skips Redis persistence/removal when distributed cache is unavailable', async () => {
    mockGetDistributedCache.mockReturnValue(null);

    const id = await deadLetterQueue.add('sync', 'op', {}, 'err', 1);
    expect(deadLetterQueue.get(id)).toBeDefined();
    await expect(deadLetterQueue.remove(id)).resolves.toBe(true);
  });

  it('logs restoration-skipped debug message when redis cache exists', async () => {
    mockGetDistributedCache.mockReturnValue(mockCache);

    await expect(deadLetterQueue.loadFromRedis()).resolves.toBeUndefined();

    expect(mockLog.debug).toHaveBeenCalledWith(
      'Redis DLQ restoration skipped - using in-memory primary'
    );
  });

  it('records convenience failure categories', async () => {
    const syncId = await recordSyncFailure('wallet-1', 'sync down', 2, { network: 'testnet' });
    const pushId = await recordPushFailure('user-1', '123456789012345678901234', 'push down', 3, { title: 'x' });
    const electrumId = await recordElectrumFailure('host', 50001, 'conn down', 4);
    const txId = await recordTransactionFailure('wallet-1', 'a'.repeat(64), 'broadcast down', 5);

    expect(deadLetterQueue.get(syncId)).toEqual(expect.objectContaining({
      category: 'sync',
      operation: 'wallet_sync',
    }));
    expect(deadLetterQueue.get(pushId)).toEqual(expect.objectContaining({
      category: 'push',
      payload: expect.objectContaining({
        token: '12345678901234567890...',
      }),
    }));
    expect(deadLetterQueue.get(electrumId)?.category).toBe('electrum');
    expect(deadLetterQueue.get(txId)?.category).toBe('transaction');
  });
});
