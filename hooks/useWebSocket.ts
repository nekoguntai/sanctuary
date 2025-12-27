import { useEffect, useState, useCallback, useRef } from 'react';
import { websocketClient, WebSocketEvent, WebSocketEventType } from '../services/websocket';
import apiClient from '../src/api/client';
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
  const logsRef = useRef<WalletLogEntry[]>([]);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    logsRef.current = [];
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

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
      setLogs(prev => {
        const newLogs = [...prev, entry];
        // Keep only last maxEntries
        if (newLogs.length > maxEntries) {
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
 * when a transaction is confirmed or received
 */
export const useWebSocketQueryInvalidation = () => {
  // Import queryClient dynamically to avoid circular dependencies
  const { connected } = useWebSocket();

  useEffect(() => {
    if (!connected) return;

    // Import queryClient lazily
    let queryClient: import('@tanstack/react-query').QueryClient | null = null;
    import('../providers/QueryProvider').then((module) => {
      queryClient = module.queryClient;
    });

    const handleTransactionEvent = (event: WebSocketEvent) => {
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

    websocketClient.on('transaction', handleTransactionEvent);
    websocketClient.on('confirmation', handleTransactionEvent);
    websocketClient.on('balance', handleTransactionEvent);

    return () => {
      websocketClient.off('transaction', handleTransactionEvent);
      websocketClient.off('confirmation', handleTransactionEvent);
      websocketClient.off('balance', handleTransactionEvent);
    };
  }, [connected]);
};
