import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletWebSocket } from '../../../../components/WalletDetail/hooks/useWalletWebSocket';
import { useWalletEvents } from '../../../../hooks/useWebSocket';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../hooks/useWebSocket', () => ({
  useWalletEvents: vi.fn(),
}));

const addNotification = vi.fn();
vi.mock('../../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({
    addNotification,
  }),
}));

describe('useWalletWebSocket', () => {
  let handlers: Record<string, (data: any) => void>;

  const setWallet = vi.fn();
  const setTransactions = vi.fn();
  const setSyncing = vi.fn();
  const setSyncRetryInfo = vi.fn();
  const fetchData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    vi.mocked(useWalletEvents).mockImplementation((_, cb) => {
      handlers = cb as Record<string, (data: any) => void>;
    });

    renderHook(() =>
      useWalletWebSocket({
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', name: 'Primary Wallet', balance: 10_000 } as any,
        setWallet,
        setTransactions,
        setSyncing,
        setSyncRetryInfo,
        fetchData,
      })
    );
  });

  it('handles transaction events with notification and silent refresh', () => {
    handlers.onTransaction({
      txid: 'tx-1',
      type: 'received',
      amount: 12_345,
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Received',
        duration: 10000,
      })
    );
    expect(fetchData).toHaveBeenCalledWith(true);
  });

  it('updates wallet balance on balance events', () => {
    handlers.onBalance({ balance: 55_000, confirmed: 55_000 });
    expect(setWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wallet-1',
        balance: 55_000,
      })
    );
  });

  it('updates confirmations and emits milestone notifications', () => {
    handlers.onConfirmation({ txid: 'tx-1', confirmations: 3 });

    const updater = setTransactions.mock.calls[0][0] as (txs: any[]) => any[];
    const updated = updater([{ txid: 'tx-1', confirmations: 0 }, { txid: 'tx-2', confirmations: 0 }]);

    expect(updated[0].confirmations).toBe(3);
    expect(updated[1].confirmations).toBe(0);
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        title: 'Transaction Confirmed',
      })
    );
  });

  it('does not emit confirmation notification for non-milestone confirmations', () => {
    handlers.onConfirmation({ txid: 'tx-1', confirmations: 2 });
    expect(addNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'confirmation' })
    );
  });

  it('tracks retry info for retrying sync events', () => {
    handlers.onSync({
      inProgress: true,
      status: 'retrying',
      retryCount: 2,
      maxRetries: 5,
      error: 'temporary failure',
      lastSyncedAt: '2026-03-01T00:00:00.000Z',
    });

    const updater = setWallet.mock.calls[0][0] as (wallet: any) => any;
    const updatedWallet = updater({
      id: 'wallet-1',
      balance: 10_000,
      lastSyncStatus: 'idle',
      lastSyncedAt: null,
    });

    expect(updatedWallet.syncInProgress).toBe(true);
    expect(updatedWallet.lastSyncStatus).toBe('retrying');
    expect(setSyncRetryInfo).toHaveBeenCalledWith({
      retryCount: 2,
      maxRetries: 5,
      error: 'temporary failure',
    });
  });

  it('clears syncing and refreshes on successful sync completion', () => {
    handlers.onSync({
      inProgress: false,
      status: 'success',
      retryCount: 0,
      maxRetries: 5,
    });

    expect(setSyncRetryInfo).toHaveBeenCalledWith(null);
    expect(setSyncing).toHaveBeenCalledWith(false);
    expect(fetchData).toHaveBeenCalledWith(true);
  });
});
