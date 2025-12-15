/**
 * WebSocket Client Service
 *
 * Manages WebSocket connection to backend for real-time updates
 * Handles reconnection, subscriptions, and event dispatching
 */

// Conditional logging - only in development mode
// Use type assertion for Vite's import.meta.env
const isDev = (import.meta as any).env?.DEV ?? false;
const log = {
  debug: (...args: unknown[]) => isDev && console.log('[WS]', ...args),
  warn: (...args: unknown[]) => isDev && console.warn('[WS]', ...args),
  error: (...args: unknown[]) => console.error('[WS]', ...args), // Always log errors
};

export type WebSocketEventType =
  | 'transaction'
  | 'balance'
  | 'confirmation'
  | 'block'
  | 'mempool'
  | 'sync'
  | 'log'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface WebSocketEvent {
  type: string;
  event?: WebSocketEventType;
  data: any;
  channel?: string;
  timestamp?: number;
}

export type EventCallback = (event: WebSocketEvent) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000; // Start with 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;

  private subscriptions: Set<string> = new Set();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to WebSocket server
   */
  connect(token?: string) {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      log.debug('Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.token = token || null;

    // Connect without token in URL (security: avoid token exposure in logs/history)
    log.debug('Connecting to:', this.url);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        log.debug('Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Send authentication message if we have a token
        // This avoids exposing token in URL query parameters
        if (this.token) {
          this.sendAuthMessage(this.token);
        }

        // Resubscribe to channels
        this.resubscribe();

        // Notify connection listeners
        this.notifyConnectionListeners(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketEvent = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          log.error('Failed to parse message:', err);
        }
      };

      this.ws.onerror = (error) => {
        log.error('Connection error:', error);
        this.isConnecting = false;
      };

      this.ws.onclose = (event) => {
        log.debug('Closed:', event.code, event.reason);
        this.isConnecting = false;
        this.ws = null;

        // Notify connection listeners
        this.notifyConnectionListeners(false);

        // Attempt reconnection
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      log.error('Failed to create connection:', err);
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.subscriptions.clear();
    log.debug('Disconnected');
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    log.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.token || undefined);
    }, delay);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: WebSocketEvent) {
    // Handle special message types
    switch (message.type) {
      case 'connected':
        log.debug('Connection confirmed');
        break;

      case 'authenticated':
        log.debug('Authenticated:', message.data?.success ? 'success' : 'failed');
        break;

      case 'subscribed':
        log.debug('Subscribed to:', message.data?.channel);
        break;

      case 'unsubscribed':
        log.debug('Unsubscribed from:', message.data?.channel);
        break;

      case 'event':
        this.dispatchEvent(message);
        break;

      case 'error':
        log.error('Server error:', message.data);
        break;

      case 'pong':
        // Heartbeat response - silent
        break;

      default:
        log.warn('Unknown message type:', message.type);
    }
  }

  /**
   * Dispatch event to listeners
   */
  private dispatchEvent(message: WebSocketEvent) {
    const { event, channel } = message;

    // Notify event-specific listeners
    if (event) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        for (const callback of listeners) {
          try {
            callback(message);
          } catch (err) {
            log.error('Event listener error:', err);
          }
        }
      }
    }

    // Notify channel-specific listeners
    if (channel) {
      const listeners = this.eventListeners.get(`channel:${channel}`);
      if (listeners) {
        for (const callback of listeners) {
          try {
            callback(message);
          } catch (err) {
            log.error('Channel listener error:', err);
          }
        }
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      for (const callback of wildcardListeners) {
        try {
          callback(message);
        } catch (err) {
          log.error('Wildcard listener error:', err);
        }
      }
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string) {
    if (this.subscriptions.has(channel)) {
      return;
    }

    this.subscriptions.add(channel);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'subscribe',
        data: { channel },
      });
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string) {
    if (!this.subscriptions.has(channel)) {
      return;
    }

    this.subscriptions.delete(channel);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'unsubscribe',
        data: { channel },
      });
    }
  }

  /**
   * Resubscribe to all channels after reconnection
   */
  private resubscribe() {
    for (const channel of this.subscriptions) {
      this.send({
        type: 'subscribe',
        data: { channel },
      });
    }
  }

  /**
   * Add event listener
   */
  on(eventType: WebSocketEventType | '*', callback: EventCallback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(eventType: WebSocketEventType | '*', callback: EventCallback) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Add connection status listener
   */
  onConnectionChange(callback: (connected: boolean) => void) {
    this.connectionListeners.add(callback);
  }

  /**
   * Remove connection status listener
   */
  offConnectionChange(callback: (connected: boolean) => void) {
    this.connectionListeners.delete(callback);
  }

  /**
   * Notify connection listeners
   */
  private notifyConnectionListeners(connected: boolean) {
    for (const callback of this.connectionListeners) {
      try {
        callback(connected);
      } catch (err) {
        log.error('Connection listener error:', err);
      }
    }
  }

  /**
   * Send message to server
   */
  private send(message: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      log.warn('Cannot send: not connected');
    }
  }

  /**
   * Send authentication message to server
   * This authenticates the connection without exposing token in URL
   */
  private sendAuthMessage(token: string) {
    this.send({
      type: 'auth',
      data: { token },
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getState(): 'connecting' | 'connected' | 'disconnected' {
    if (this.isConnecting) return 'connecting';
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }
}

// Auto-detect WebSocket URL based on current host
const getWebSocketUrl = (): string => {
  // If VITE_WS_URL is set, use it
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // Otherwise, build URL from current location (works with nginx proxy)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
};

// Create singleton instance
export const websocketClient = new WebSocketClient(getWebSocketUrl());
