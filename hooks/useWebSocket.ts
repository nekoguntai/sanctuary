import { useEffect, useState, useCallback } from 'react';
import { websocketClient, WebSocketEvent, WebSocketEventType } from '../services/websocket';

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
