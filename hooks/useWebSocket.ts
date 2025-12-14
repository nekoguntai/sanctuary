import { useEffect, useState, useCallback, useRef } from 'react';
import { websocketClient, WebSocketEvent, WebSocketEventType } from '../services/websocket';

// Log entry type matching backend WalletLogEntry
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WalletLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, any>;
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
      const token = localStorage.getItem('sanctuary_token');
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
  deps: any[] = []
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
 */
export const useWalletEvents = (
  walletId: string | undefined,
  callbacks: {
    onTransaction?: (data: any) => void;
    onBalance?: (data: any) => void;
    onConfirmation?: (data: any) => void;
    onSync?: (data: any) => void;
  }
) => {
  const { subscribeWallet, unsubscribeWallet } = useWebSocket();

  useEffect(() => {
    if (!walletId) return;

    // Subscribe to wallet
    subscribeWallet(walletId);

    // Setup event handlers
    const handleEvent = (event: WebSocketEvent) => {
      if (event.event === 'transaction' && callbacks.onTransaction) {
        callbacks.onTransaction(event.data);
      } else if (event.event === 'balance' && callbacks.onBalance) {
        callbacks.onBalance(event.data);
      } else if (event.event === 'confirmation' && callbacks.onConfirmation) {
        callbacks.onConfirmation(event.data);
      } else if (event.event === 'sync' && callbacks.onSync) {
        callbacks.onSync(event.data);
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
  }, [walletId, subscribeWallet, unsubscribeWallet, callbacks.onTransaction, callbacks.onBalance, callbacks.onConfirmation, callbacks.onSync]);
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
