import { useEffect, useState, useCallback, useRef } from 'react';
import { websocketClient, WebSocketEvent, WebSocketEventType } from '../services/websocket';
import apiClient from '../src/api/client';
import { getWalletLogs } from '../src/api/sync';
import { getQueryClient } from '../providers/QueryProvider';
import type {
  WebSocketTransactionData,
  WebSocketBalanceData,
  WebSocketConfirmationData,
  WebSocketSyncData,
} from '../src/types';

// Log entry type matching backend WalletLogEntry
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WalletLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface UseWebSocketReturn {
  connected: boolean;
  state: 'connecting' | 'connected' | 'disconnected';
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  subscribeWallet: (walletId: string) => void;
  unsubscribeWallet: (walletId: string) => void;
}

/**
 * React hook for WebSocket connection and subscriptions
 *
 * Automatically connects to WebSocket server and manages connection state
 */
export const useWebSocket = (): UseWebSocketReturn => {
  const [connected, setConnected] = useState(websocketClient.isConnected());
  const [state, setState] = useState(websocketClient.getState());

  useEffect(() => {
    // Handle connection state changes
    const handleConnectionChange = (isConnected: boolean) => {
      setConnected(isConnected);
      setState(websocketClient.getState());
    };

    websocketClient.onConnectionChange(handleConnectionChange);

    // Connect if not already connected
    if (!websocketClient.isConnected()) {
      const token = apiClient.getToken();
      websocketClient.connect(token || undefined);
    } else {
      setConnected(true);
      setState('connected');
    }

    // Update state periodically
    const interval = setInterval(() => {
      setState(websocketClient.getState());
    }, 1000);

    return () => {
      websocketClient.offConnectionChange(handleConnectionChange);
      clearInterval(interval);
    };
  }, []);

  const subscribe = useCallback((channel: string) => {
    websocketClient.subscribe(channel);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    websocketClient.unsubscribe(channel);
  }, []);

  const subscribeWallet = useCallback((walletId: string) => {
    websocketClient.subscribe(`wallet:${walletId}`);
    websocketClient.subscribe(`wallet:${walletId}:transaction`);
    websocketClient.subscribe(`wallet:${walletId}:balance`);
    websocketClient.subscribe(`wallet:${walletId}:confirmation`);
    websocketClient.subscribe(`wallet:${walletId}:sync`);
  }, []);

  const unsubscribeWallet = useCallback((walletId: string) => {
    websocketClient.unsubscribe(`wallet:${walletId}`);
    websocketClient.unsubscribe(`wallet:${walletId}:transaction`);
    websocketClient.unsubscribe(`wallet:${walletId}:balance`);
    websocketClient.unsubscribe(`wallet:${walletId}:confirmation`);
    websocketClient.unsubscribe(`wallet:${walletId}:sync`);
  }, []);

  return {
    connected,
    state,
    subscribe,
    unsubscribe,
    subscribeWallet,
    unsubscribeWallet,
  };
};

/**
 * Hook for subscribing to specific event types
 */
export const useWebSocketEvent = (
  eventType: WebSocketEventType | '*',
  callback: (event: WebSocketEvent) => void,
  deps: unknown[] = []
) => {
  useEffect(() => {
    websocketClient.on(eventType, callback);

    return () => {
      websocketClient.off(eventType, callback);
    };
  }, [eventType, ...deps]);
};

/**
 * Hook for subscribing to wallet events
 * Uses refs for callbacks to avoid re-subscribing when callbacks change
 */
export const useWalletEvents = (
  walletId: string | undefined,
  callbacks: {
    onTransaction?: (data: WebSocketTransactionData) => void;
    onBalance?: (data: WebSocketBalanceData) => void;
    onConfirmation?: (data: WebSocketConfirmationData) => void;
    onSync?: (data: WebSocketSyncData) => void;
  }
) => {
  const { subscribeWallet, unsubscribeWallet } = useWebSocket();

  // Use refs to store callbacks to avoid re-subscribing when callbacks change
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!walletId) return;

    // Subscribe to wallet
    subscribeWallet(walletId);

    // Setup event handlers - use ref to get latest callbacks
    const handleEvent = (event: WebSocketEvent) => {
      const cbs = callbacksRef.current;
      if (event.event === 'transaction' && cbs.onTransaction) {
        cbs.onTransaction(event.data as WebSocketTransactionData);
      } else if (event.event === 'balance' && cbs.onBalance) {
        cbs.onBalance(event.data as WebSocketBalanceData);
      } else if (event.event === 'confirmation' && cbs.onConfirmation) {
        cbs.onConfirmation(event.data as WebSocketConfirmationData);
      } else if (event.event === 'sync' && cbs.onSync) {
        cbs.onSync(event.data as WebSocketSyncData);
      }
    };

    websocketClient.on('transaction', handleEvent);
    websocketClient.on('balance', handleEvent);
    websocketClient.on('confirmation', handleEvent);
    websocketClient.on('sync', handleEvent);

    return () => {
      unsubscribeWallet(walletId);
      websocketClient.off('transaction', handleEvent);
      websocketClient.off('balance', handleEvent);
      websocketClient.off('confirmation', handleEvent);
      websocketClient.off('sync', handleEvent);
    };
  }, [walletId, subscribeWallet, unsubscribeWallet]);
};

/**
 * Hook for subscribing to wallet log events
 * Returns array of log entries that accumulates in real-time
 * Fetches historical logs from the server when enabled
 */
export const useWalletLogs = (
  walletId: string | undefined,
  options: {
    maxEntries?: number;
    enabled?: boolean;
  } = {}
) => {
  const { maxEntries = 500, enabled = true } = options;
  const [logs, setLogs] = useState<WalletLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const logsRef = useRef<WalletLogEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    logsRef.current = [];
    seenIdsRef.current.clear();
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  // Fetch historical logs when enabled
  useEffect(() => {
    if (!walletId || !enabled) return;

    let cancelled = false;
    setIsLoading(true);

    getWalletLogs(walletId)
      .then(historicalLogs => {
        if (cancelled) return;

        // Initialize with historical logs
        setLogs(historicalLogs);

        // Track seen IDs to avoid duplicates with real-time updates
        seenIdsRef.current = new Set(historicalLogs.map(log => log.id));
      })
      .catch(err => {
        // Silently fail - logs are optional
        console.warn('Failed to fetch historical logs:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletId, enabled]);

  // Subscribe to real-time log events
  useEffect(() => {
    if (!walletId || !enabled) return;

    const channel = `wallet:${walletId}:log`;

    // Subscribe to the log channel
    websocketClient.subscribe(channel);

    // Handle log events
    const handleLog = (event: WebSocketEvent) => {
      if (event.event !== 'log') return;

      // Check if this is for our wallet
      const eventChannel = event.channel;
      if (eventChannel !== channel) return;

      // Don't add if paused
      if (isPaused) return;

      const entry = event.data as WalletLogEntry;

      // Skip if we've already seen this entry (from historical fetch)
      if (seenIdsRef.current.has(entry.id)) return;
      seenIdsRef.current.add(entry.id);

      setLogs(prev => {
        const newLogs = [...prev, entry];
        // Keep only last maxEntries
        if (newLogs.length > maxEntries) {
          // Also clean up seenIds for removed entries
          const removedLogs = newLogs.slice(0, newLogs.length - maxEntries);
          for (const removed of removedLogs) {
            seenIdsRef.current.delete(removed.id);
          }
          return newLogs.slice(-maxEntries);
        }
        return newLogs;
      });
    };

    websocketClient.on('log', handleLog);

    return () => {
      websocketClient.unsubscribe(channel);
      websocketClient.off('log', handleLog);
    };
  }, [walletId, enabled, maxEntries, isPaused]);

  return {
    logs,
    isPaused,
    isLoading,
    clearLogs,
    togglePause,
  };
};

// Model download progress type
export interface ModelDownloadProgress {
  model: string;
  status: 'pulling' | 'downloading' | 'verifying' | 'complete' | 'error';
  completed: number;
  total: number;
  percent: number;
  digest?: string;
  error?: string;
}

/**
 * Hook for subscribing to model download progress events
 * Used in AISettings to show real-time progress during model pulls
 */
export const useModelDownloadProgress = (
  onProgress?: (progress: ModelDownloadProgress) => void
): { progress: ModelDownloadProgress | null } => {
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);

  // Use the main useWebSocket hook to ensure connection is established
  const { connected } = useWebSocket();

  useEffect(() => {
    // Only subscribe when connected
    if (!connected) {
      return;
    }

    // Subscribe to system channel to receive model download events
    websocketClient.subscribe('system');

    const handleProgress = (event: WebSocketEvent) => {
      // Events come with type='event' and event='modelDownload'
      if (event.event !== 'modelDownload') return;

      const data = event.data as ModelDownloadProgress;
      setProgress(data);
      onProgress?.(data);
    };

    websocketClient.on('modelDownload', handleProgress);

    return () => {
      websocketClient.off('modelDownload', handleProgress);
      websocketClient.unsubscribe('system');
    };
  }, [connected, onProgress]);

  return { progress };
};

/**
 * Hook to invalidate React Query cache when WebSocket events are received
 * This ensures that Dashboard pending transactions update immediately
 * when a transaction is confirmed, received, or when a new block arrives.
 *
 * BLOCK CONFIRMATION SPEED:
 * Previously, confirmations only updated when the backend finished processing
 * all wallets and sent individual 'confirmation' events. This was slow compared
 * to Sparrow Wallet which updates immediately on new blocks.
 *
 * Now we subscribe to 'blocks' channel and listen for 'newBlock' events,
 * which are broadcast immediately when Electrum notifies of a new block.
 * This triggers an immediate cache invalidation, making the UI react
 * as fast as Sparrow does.
 */
export const useWebSocketQueryInvalidation = () => {
  const { connected, subscribe, unsubscribe } = useWebSocket();

  useEffect(() => {
    if (!connected) return;

    // Subscribe to global channels
    subscribe('blocks');
    subscribe('sync:all');
    subscribe('transactions:all');

    const handleTransactionEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;

      // Invalidate pending transactions when any transaction event occurs
      if (event.event === 'transaction' || event.event === 'confirmation') {
        // Invalidate pending transactions query (Dashboard block visualization)
        queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
        // Also invalidate recent transactions query
        queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      }

      // Invalidate wallet balance when balance changes
      if (event.event === 'balance') {
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      }
    };

    // Handle new block events - immediately refresh confirmations
    const handleNewBlock = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'newBlock') return;

      // Invalidate pending transactions to show updated confirmations
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      // Also refresh wallets since UTXOs may have new confirmations
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
    };

    // Handle sync events - directly update wallet cache for immediate UI response
    // This ensures all pages (Dashboard, WalletList, WalletDetail) see sync status changes
    const handleSyncEvent = (event: WebSocketEvent) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;
      if (event.event !== 'sync') return;

      const { walletId, inProgress, status } = event.data as {
        walletId: string;
        inProgress: boolean;
        status?: string;
      };

      if (!walletId) return;

      // Directly update wallet list cache
      queryClient.setQueryData(['wallets', 'list'], (oldData: any[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((wallet: any) =>
          wallet.id === walletId
            ? {
                ...wallet,
                syncInProgress: inProgress,
                ...(status && { lastSyncStatus: status }),
                ...(!inProgress && { lastSyncedAt: new Date().toISOString() }),
              }
            : wallet
        );
      });

      // Also update individual wallet cache if it exists
      queryClient.setQueryData(['wallets', 'detail', walletId], (oldData: any | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          syncInProgress: inProgress,
          ...(status && { lastSyncStatus: status }),
          ...(!inProgress && { lastSyncedAt: new Date().toISOString() }),
        };
      });
    };

    websocketClient.on('transaction', handleTransactionEvent);
    websocketClient.on('confirmation', handleTransactionEvent);
    websocketClient.on('balance', handleTransactionEvent);
    websocketClient.on('newBlock', handleNewBlock);
    websocketClient.on('sync', handleSyncEvent);

    return () => {
      unsubscribe('blocks');
      unsubscribe('sync:all');
      unsubscribe('transactions:all');
      websocketClient.off('transaction', handleTransactionEvent);
      websocketClient.off('confirmation', handleTransactionEvent);
      websocketClient.off('balance', handleTransactionEvent);
      websocketClient.off('newBlock', handleNewBlock);
      websocketClient.off('sync', handleSyncEvent);
    };
  }, [connected, subscribe, unsubscribe]);
};
