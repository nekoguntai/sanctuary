/**
 * Lock Coordination Tests
 *
 * Tests for the distributed lock refresh logic in the Electrum subscription manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAcquireLock,
  mockExtendLock,
  mockReleaseLock,
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockExtendLock: vi.fn(),
  mockReleaseLock: vi.fn(),
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { startLockRefresh } from '../../../src/worker/electrumManager/lockCoordination';

describe('lockCoordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops lock refresh when getLock returns null', async () => {
    const getLock = vi.fn().mockReturnValue(null);
    const setLock = vi.fn();
    const onLockLost = vi.fn().mockResolvedValue(undefined);

    const timer = startLockRefresh(getLock, setLock, onLockLost);

    // Advance past the refresh interval (60 seconds)
    await vi.advanceTimersByTimeAsync(61_000);

    expect(getLock).toHaveBeenCalled();
    // extendLock should NOT have been called because lock was null
    expect(mockExtendLock).not.toHaveBeenCalled();
    expect(setLock).not.toHaveBeenCalled();
    expect(onLockLost).not.toHaveBeenCalled();

    clearInterval(timer);
  });
});
