/**
 * WebSocket Client Service
 *
 * Manages WebSocket connection to backend for real-time updates
 * Handles reconnection, subscriptions, and event dispatching
 */

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
      console.log('WebSocket already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.token = token || null;

    // Connect without token in URL (security: avoid token exposure in logs/history)
    console.log('Connecting to WebSocket:', this.url);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
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
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
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
      console.error('Failed to create WebSocket connection:', err);
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
    console.log('WebSocket disconnected');
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.token || undefined);
    }, delay);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: WebSocketEvent) {
    console.log('WebSocket message:', message);

    // Handle special message types
    switch (message.type) {
      case 'connected':
        console.log('WebSocket connection confirmed');
        break;

      case 'authenticated':
        console.log('WebSocket authenticated:', message.data?.success ? 'success' : 'failed');
        break;

      case 'subscribed':
        console.log('Subscribed to:', message.data?.channel);
        break;

      case 'unsubscribed':
        console.log('Unsubscribed from:', message.data?.channel);
        break;

      case 'event':
        this.dispatchEvent(message);
        break;

      case 'error':
        console.error('WebSocket error message:', message.data);
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.warn('Unknown message type:', message.type);
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
            console.error('Event listener error:', err);
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
            console.error('Channel listener error:', err);
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
          console.error('Wildcard listener error:', err);
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

    console.log('Subscribed to channel:', channel);
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

    console.log('Unsubscribed from channel:', channel);
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
        console.error('Connection listener error:', err);
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
      console.warn('Cannot send message: WebSocket not connected');
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
