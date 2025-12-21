/**
 * useWebSocket Hook Tests
 *
 * Tests for WebSocket hooks that manage real-time connections and subscriptions.
 * Covers connection lifecycle, authentication, subscription management, and event handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Store connection change callbacks for testing
let connectionChangeCallbacks: Set<(connected: boolean) => void> = new Set();
let eventCallbacks: Map<string, Set<(event: any) => void>> = new Map();

// Mock the WebSocket client
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockIsConnected = vi.fn();
const mockGetState = vi.fn();
const mockOnConnectionChange = vi.fn();
const mockOffConnectionChange = vi.fn();

vi.mock('../../services/websocket', () => ({
  websocketClient: {
    connect: (...args: any[]) => mockConnect(...args),
    disconnect: (...args: any[]) => mockDisconnect(...args),
    subscribe: (...args: any[]) => mockSubscribe(...args),
    unsubscribe: (...args: any[]) => mockUnsubscribe(...args),
    on: (...args: any[]) => mockOn(...args),
    off: (...args: any[]) => mockOff(...args),
    isConnected: (...args: any[]) => mockIsConnected(...args),
    getState: (...args: any[]) => mockGetState(...args),
    onConnectionChange: (...args: any[]) => mockOnConnectionChange(...args),
    offConnectionChange: (...args: any[]) => mockOffConnectionChange(...args),
  },
  WebSocketEvent: {},
  WebSocketEventType: {},
}));

// Mock the API client
const mockGetToken = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    getToken: (...args: any[]) => mockGetToken(...args),
  },
}));

// Import hooks after mocks
import {
  useWebSocket,
  useWebSocketEvent,
  useWalletEvents,
  useWalletLogs,
  useModelDownloadProgress,
} from '../../hooks/useWebSocket';

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    // Default mock implementations
    mockIsConnected.mockReturnValue(false);
    mockGetState.mockReturnValue('disconnected');
    mockGetToken.mockReturnValue('test-token-123');

    // Store callbacks when registered
    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

    mockOffConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.delete(callback);
    });

    mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
      if (!eventCallbacks.has(eventType)) {
        eventCallbacks.set(eventType, new Set());
      }
      eventCallbacks.get(eventType)!.add(callback);
    });

    mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
      const callbacks = eventCallbacks.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection Lifecycle', () => {
    it('should connect on mount when not already connected', () => {
      mockIsConnected.mockReturnValue(false);

      renderHook(() => useWebSocket());

      expect(mockOnConnectionChange).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith('test-token-123');
    });

    it('should not connect if already connected', () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(mockConnect).not.toHaveBeenCalled();
      expect(result.current.connected).toBe(true);
      expect(result.current.state).toBe('connected');
    });

    it('should connect with undefined token when token is null', () => {
      mockGetToken.mockReturnValue(null);
      mockIsConnected.mockReturnValue(false);

      renderHook(() => useWebSocket());

      expect(mockConnect).toHaveBeenCalledWith(undefined);
    });

    it('should disconnect on unmount', () => {
      mockIsConnected.mockReturnValue(false);

      const { unmount } = renderHook(() => useWebSocket());

      unmount();

      expect(mockOffConnectionChange).toHaveBeenCalledTimes(1);
    });

    it('should update connected state on connection change', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('disconnected');

      // Simulate connection
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      act(() => {
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
        expect(result.current.state).toBe('connected');
      });
    });

    it('should update connected state on disconnection', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(true);

      // Simulate disconnection
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      act(() => {
        connectionChangeCallbacks.forEach(cb => cb(false));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(false);
        expect(result.current.state).toBe('disconnected');
      });
    });

    it('should handle reconnection', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      // First connection
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Disconnect
      act(() => {
        mockIsConnected.mockReturnValue(false);
        mockGetState.mockReturnValue('disconnected');
        connectionChangeCallbacks.forEach(cb => cb(false));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(false);
      });

      // Reconnect
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
        expect(result.current.state).toBe('connected');
      });
    });

    it('should update state periodically via interval', async () => {
      vi.useFakeTimers();

      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.state).toBe('disconnected');

      // Change state
      mockGetState.mockReturnValue('connecting');

      // Fast-forward 1 second (interval period)
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.state).toBe('connecting');

      vi.useRealTimers();
    });

    it('should clear interval on unmount', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = renderHook(() => useWebSocket());

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Subscription Management', () => {
    it('should subscribe to a channel', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribe('wallet:123');
      });

      expect(mockSubscribe).toHaveBeenCalledWith('wallet:123');
    });

    it('should unsubscribe from a channel', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.unsubscribe('wallet:123');
      });

      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:123');
    });

    it('should subscribe to all wallet channels', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribeWallet('wallet-abc');
      });

      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-abc');
      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-abc:transaction');
      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-abc:balance');
      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-abc:confirmation');
      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-abc:sync');
      expect(mockSubscribe).toHaveBeenCalledTimes(5);
    });

    it('should unsubscribe from all wallet channels', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.unsubscribeWallet('wallet-xyz');
      });

      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-xyz');
      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-xyz:transaction');
      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-xyz:balance');
      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-xyz:confirmation');
      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-xyz:sync');
      expect(mockUnsubscribe).toHaveBeenCalledTimes(5);
    });

    it('should maintain stable subscribe callback reference', () => {
      const { result, rerender } = renderHook(() => useWebSocket());

      const firstSubscribe = result.current.subscribe;

      rerender();

      const secondSubscribe = result.current.subscribe;

      expect(firstSubscribe).toBe(secondSubscribe);
    });

    it('should maintain stable unsubscribe callback reference', () => {
      const { result, rerender } = renderHook(() => useWebSocket());

      const firstUnsubscribe = result.current.unsubscribe;

      rerender();

      const secondUnsubscribe = result.current.unsubscribe;

      expect(firstUnsubscribe).toBe(secondUnsubscribe);
    });
  });

  describe('State Management', () => {
    it('should return initial disconnected state', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('disconnected');
    });

    it('should return connecting state', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('connecting');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('connecting');
    });

    it('should return connected state', () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(true);
      expect(result.current.state).toBe('connected');
    });
  });
});

describe('useWebSocketEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCallbacks.clear();

    mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
      if (!eventCallbacks.has(eventType)) {
        eventCallbacks.set(eventType, new Set());
      }
      eventCallbacks.get(eventType)!.add(callback);
    });

    mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
      const callbacks = eventCallbacks.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    });
  });

  it('should register event listener on mount', () => {
    const callback = vi.fn();

    renderHook(() => useWebSocketEvent('transaction', callback));

    expect(mockOn).toHaveBeenCalledWith('transaction', callback);
  });

  it('should unregister event listener on unmount', () => {
    const callback = vi.fn();

    const { unmount } = renderHook(() => useWebSocketEvent('balance', callback));

    unmount();

    expect(mockOff).toHaveBeenCalledWith('balance', callback);
  });

  it('should handle wildcard event type', () => {
    const callback = vi.fn();

    renderHook(() => useWebSocketEvent('*', callback));

    expect(mockOn).toHaveBeenCalledWith('*', callback);
  });

  it('should re-register when event type changes', () => {
    const callback = vi.fn();

    const { rerender } = renderHook<void, { eventType: 'transaction' | 'balance' | 'sync' }>(
      ({ eventType }) => useWebSocketEvent(eventType, callback),
      { initialProps: { eventType: 'transaction' } }
    );

    expect(mockOn).toHaveBeenCalledWith('transaction', callback);

    rerender({ eventType: 'balance' });

    expect(mockOff).toHaveBeenCalledWith('transaction', callback);
    expect(mockOn).toHaveBeenCalledWith('balance', callback);
  });

  it('should re-register when deps change', () => {
    const callback = vi.fn();

    const { rerender } = renderHook(
      ({ deps }) => useWebSocketEvent('sync', callback, deps),
      { initialProps: { deps: ['value1'] } }
    );

    expect(mockOn).toHaveBeenCalledWith('sync', callback);
    const firstCallCount = mockOn.mock.calls.length;

    // Change deps should trigger re-registration
    rerender({ deps: ['value2'] });

    expect(mockOff).toHaveBeenCalledWith('sync', callback);
    expect(mockOn).toHaveBeenCalledTimes(firstCallCount + 1);
    expect(mockOn).toHaveBeenCalledWith('sync', callback);
  });
});

describe('useWalletEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockIsConnected.mockReturnValue(true);
    mockGetState.mockReturnValue('connected');

    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

    mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
      if (!eventCallbacks.has(eventType)) {
        eventCallbacks.set(eventType, new Set());
      }
      eventCallbacks.get(eventType)!.add(callback);
    });

    mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
      const callbacks = eventCallbacks.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    });
  });

  it('should subscribe to wallet on mount', () => {
    const callbacks = {
      onTransaction: vi.fn(),
      onBalance: vi.fn(),
    };

    renderHook(() => useWalletEvents('wallet-123', callbacks));

    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123');
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:transaction');
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:balance');
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:confirmation');
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:sync');
  });

  it('should unsubscribe from wallet on unmount', () => {
    const callbacks = {
      onTransaction: vi.fn(),
    };

    const { unmount } = renderHook(() => useWalletEvents('wallet-456', callbacks));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456');
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:transaction');
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:balance');
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:confirmation');
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:sync');
  });

  it('should not subscribe when walletId is undefined', () => {
    const callbacks = {
      onTransaction: vi.fn(),
    };

    renderHook(() => useWalletEvents(undefined, callbacks));

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should call onTransaction callback when transaction event is received', async () => {
    const onTransaction = vi.fn();
    const callbacks = { onTransaction };

    renderHook(() => useWalletEvents('wallet-789', callbacks));

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx123', amount: 1000 },
    };

    act(() => {
      eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
    });

    await waitFor(() => {
      expect(onTransaction).toHaveBeenCalledWith(transactionEvent.data);
    });
  });

  it('should call onBalance callback when balance event is received', async () => {
    const onBalance = vi.fn();
    const callbacks = { onBalance };

    renderHook(() => useWalletEvents('wallet-abc', callbacks));

    const balanceEvent = {
      event: 'balance',
      data: { balance: 5000, confirmed: 5000 },
    };

    act(() => {
      eventCallbacks.get('balance')?.forEach(cb => cb(balanceEvent));
    });

    await waitFor(() => {
      expect(onBalance).toHaveBeenCalledWith(balanceEvent.data);
    });
  });

  it('should call onConfirmation callback when confirmation event is received', async () => {
    const onConfirmation = vi.fn();
    const callbacks = { onConfirmation };

    renderHook(() => useWalletEvents('wallet-def', callbacks));

    const confirmationEvent = {
      event: 'confirmation',
      data: { txid: 'tx456', confirmations: 3 },
    };

    act(() => {
      eventCallbacks.get('confirmation')?.forEach(cb => cb(confirmationEvent));
    });

    await waitFor(() => {
      expect(onConfirmation).toHaveBeenCalledWith(confirmationEvent.data);
    });
  });

  it('should call onSync callback when sync event is received', async () => {
    const onSync = vi.fn();
    const callbacks = { onSync };

    renderHook(() => useWalletEvents('wallet-ghi', callbacks));

    const syncEvent = {
      event: 'sync',
      data: { progress: 0.75, status: 'syncing' },
    };

    act(() => {
      eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
    });

    await waitFor(() => {
      expect(onSync).toHaveBeenCalledWith(syncEvent.data);
    });
  });

  it('should use latest callbacks without resubscribing', async () => {
    const onTransaction1 = vi.fn();
    const onTransaction2 = vi.fn();

    const { rerender } = renderHook(
      ({ callbacks }) => useWalletEvents('wallet-jkl', callbacks),
      { initialProps: { callbacks: { onTransaction: onTransaction1 } } }
    );

    // Clear subscribe calls from initial mount
    mockSubscribe.mockClear();

    // Update callbacks
    rerender({ callbacks: { onTransaction: onTransaction2 } });

    // Should not resubscribe
    expect(mockSubscribe).not.toHaveBeenCalled();

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx789' },
    };

    act(() => {
      eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
    });

    // Should use new callback
    await waitFor(() => {
      expect(onTransaction1).not.toHaveBeenCalled();
      expect(onTransaction2).toHaveBeenCalledWith(transactionEvent.data);
    });
  });

  it('should resubscribe when walletId changes', () => {
    const callbacks = { onTransaction: vi.fn() };

    const { rerender } = renderHook(
      ({ walletId }) => useWalletEvents(walletId, callbacks),
      { initialProps: { walletId: 'wallet-old' } }
    );

    mockSubscribe.mockClear();
    mockUnsubscribe.mockClear();

    rerender({ walletId: 'wallet-new' });

    // Should unsubscribe from old wallet
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-old');
    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-old:transaction');

    // Should subscribe to new wallet
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-new');
    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-new:transaction');
  });
});

describe('useWalletLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
      if (!eventCallbacks.has(eventType)) {
        eventCallbacks.set(eventType, new Set());
      }
      eventCallbacks.get(eventType)!.add(callback);
    });

    mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
      const callbacks = eventCallbacks.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    });
  });

  it('should subscribe to wallet log channel when enabled', () => {
    renderHook(() => useWalletLogs('wallet-123', { enabled: true }));

    expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:log');
  });

  it('should not subscribe when walletId is undefined', () => {
    renderHook(() => useWalletLogs(undefined));

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should not subscribe when disabled', () => {
    renderHook(() => useWalletLogs('wallet-123', { enabled: false }));

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useWalletLogs('wallet-456'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:log');
  });

  it('should accumulate log entries', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-789'));

    const logEvent1 = {
      event: 'log',
      channel: 'wallet:wallet-789:log',
      data: {
        id: 'log-1',
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info',
        module: 'wallet',
        message: 'First log',
      },
    };

    const logEvent2 = {
      event: 'log',
      channel: 'wallet:wallet-789:log',
      data: {
        id: 'log-2',
        timestamp: '2025-01-01T00:01:00Z',
        level: 'debug',
        module: 'sync',
        message: 'Second log',
      },
    };

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(logEvent1));
    });

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1);
      expect(result.current.logs[0]).toEqual(logEvent1.data);
    });

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(logEvent2));
    });

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(2);
      expect(result.current.logs[1]).toEqual(logEvent2.data);
    });
  });

  it('should ignore log events from other wallets', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-abc'));

    const logEvent = {
      event: 'log',
      channel: 'wallet:wallet-xyz:log', // Different wallet
      data: {
        id: 'log-1',
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info',
        module: 'wallet',
        message: 'Other wallet log',
      },
    };

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
    });

    // Should not add log from different wallet
    expect(result.current.logs).toHaveLength(0);
  });

  it('should ignore non-log events', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-def'));

    const transactionEvent = {
      event: 'transaction',
      channel: 'wallet:wallet-def:log',
      data: { txid: 'tx123' },
    };

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(transactionEvent));
    });

    expect(result.current.logs).toHaveLength(0);
  });

  it('should respect maxEntries limit', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-ghi', { maxEntries: 3 }));

    const createLog = (id: number) => ({
      event: 'log',
      channel: 'wallet:wallet-ghi:log',
      data: {
        id: `log-${id}`,
        timestamp: `2025-01-01T00:${String(id).padStart(2, '0')}:00Z`,
        level: 'info' as const,
        module: 'wallet',
        message: `Log ${id}`,
      },
    });

    // Add 5 logs
    for (let i = 1; i <= 5; i++) {
      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(createLog(i)));
      });
    }

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(3);
      // Should keep only the last 3
      expect(result.current.logs[0].id).toBe('log-3');
      expect(result.current.logs[1].id).toBe('log-4');
      expect(result.current.logs[2].id).toBe('log-5');
    });
  });

  it('should clear logs when clearLogs is called', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-jkl'));

    const logEvent = {
      event: 'log',
      channel: 'wallet:wallet-jkl:log',
      data: {
        id: 'log-1',
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info' as const,
        module: 'wallet',
        message: 'Test log',
      },
    };

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
    });

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1);
    });

    act(() => {
      result.current.clearLogs();
    });

    expect(result.current.logs).toHaveLength(0);
  });

  it('should toggle pause state', () => {
    const { result } = renderHook(() => useWalletLogs('wallet-mno'));

    expect(result.current.isPaused).toBe(false);

    act(() => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(true);

    act(() => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(false);
  });

  it('should not add logs when paused', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-pqr'));

    act(() => {
      result.current.togglePause();
    });

    const logEvent = {
      event: 'log',
      channel: 'wallet:wallet-pqr:log',
      data: {
        id: 'log-1',
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info' as const,
        module: 'wallet',
        message: 'Paused log',
      },
    };

    act(() => {
      eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
    });

    // Should not add log when paused
    expect(result.current.logs).toHaveLength(0);
  });

  it('should use default maxEntries of 500', async () => {
    const { result } = renderHook(() => useWalletLogs('wallet-stu'));

    // This just checks that the hook renders without error
    expect(result.current.logs).toEqual([]);
  });
});

describe('useModelDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockIsConnected.mockReturnValue(true);
    mockGetState.mockReturnValue('connected');
    mockGetToken.mockReturnValue('test-token');

    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

    mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
      if (!eventCallbacks.has(eventType)) {
        eventCallbacks.set(eventType, new Set());
      }
      eventCallbacks.get(eventType)!.add(callback);
    });

    mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
      const callbacks = eventCallbacks.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
      }
    });
  });

  it('should subscribe to system channel when connected', () => {
    mockIsConnected.mockReturnValue(true);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).toHaveBeenCalledWith('system');
  });

  it('should not subscribe when disconnected', () => {
    mockIsConnected.mockReturnValue(false);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should unsubscribe from system channel on unmount', () => {
    mockIsConnected.mockReturnValue(true);

    const { unmount } = renderHook(() => useModelDownloadProgress());

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledWith('system');
  });

  it('should receive modelDownload events and update progress', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const progressEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'downloading' as const,
        completed: 50000000,
        total: 100000000,
        percent: 50,
        digest: 'sha256:abc123',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(progressEvent.data);
    });
  });

  it('should call onProgress callback when provided', async () => {
    mockIsConnected.mockReturnValue(true);

    const onProgress = vi.fn();
    renderHook(() => useModelDownloadProgress(onProgress));

    const progressEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:3b',
        status: 'pulling' as const,
        completed: 0,
        total: 200000000,
        percent: 0,
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
    });

    await waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith(progressEvent.data);
    });
  });

  it('should ignore non-modelDownload events', async () => {
    mockIsConnected.mockReturnValue(true);

    const onProgress = vi.fn();
    const { result } = renderHook(() => useModelDownloadProgress(onProgress));

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx123' },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(transactionEvent));
    });

    // Should not update progress or call callback
    expect(result.current.progress).toBeNull();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('should handle events for different models', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const model1Event = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'downloading' as const,
        completed: 25000000,
        total: 100000000,
        percent: 25,
      },
    };

    const model2Event = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:3b',
        status: 'complete' as const,
        completed: 200000000,
        total: 200000000,
        percent: 100,
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(model1Event));
    });

    await waitFor(() => {
      expect(result.current.progress?.model).toBe('llama3.2:1b');
    });

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(model2Event));
    });

    await waitFor(() => {
      expect(result.current.progress?.model).toBe('llama3.2:3b');
      expect(result.current.progress?.status).toBe('complete');
    });
  });

  it('should handle error status', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const errorEvent = {
      event: 'modelDownload',
      data: {
        model: 'invalid-model',
        status: 'error' as const,
        completed: 0,
        total: 0,
        percent: 0,
        error: 'Model not found',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(errorEvent));
    });

    await waitFor(() => {
      expect(result.current.progress?.status).toBe('error');
      expect(result.current.progress?.error).toBe('Model not found');
    });
  });

  it('should handle verifying status', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const verifyingEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'verifying' as const,
        completed: 100000000,
        total: 100000000,
        percent: 100,
        digest: 'sha256:xyz789',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(verifyingEvent));
    });

    await waitFor(() => {
      expect(result.current.progress?.status).toBe('verifying');
      expect(result.current.progress?.digest).toBe('sha256:xyz789');
    });
  });

  it('should return null progress initially', () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    expect(result.current.progress).toBeNull();
  });

  it('should subscribe when connection is established', async () => {
    mockIsConnected.mockReturnValue(false);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).not.toHaveBeenCalled();

    // Simulate connection
    act(() => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');
      connectionChangeCallbacks.forEach(cb => cb(true));
    });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('system');
    });
  });
});
