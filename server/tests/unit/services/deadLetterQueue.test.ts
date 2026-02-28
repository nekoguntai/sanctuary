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
