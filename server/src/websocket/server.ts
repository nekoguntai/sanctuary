/**
 * WebSocket Server for Real-Time Updates
 *
 * Provides real-time notifications for:
 * - New transactions
 * - Balance updates
 * - Transaction confirmations
 * - New blocks
 * - Mempool updates
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '../utils/jwt';
import { Server } from 'http';
import { createLogger } from '../utils/logger';
import { checkWalletAccess } from '../services/wallet';

const log = createLogger('WS');

// Timeout for unauthenticated connections (30 seconds)
const AUTH_TIMEOUT_MS = 30000;

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  subscriptions: Set<string>;
  isAlive: boolean;
  authTimeout?: NodeJS.Timeout;
}

export interface WebSocketMessage {
  type: 'auth' | 'subscribe' | 'unsubscribe' | 'ping' | 'pong';
  data?: Record<string, unknown>;
}

export interface WebSocketEvent {
  type: 'transaction' | 'balance' | 'confirmation' | 'block' | 'newBlock' | 'mempool' | 'sync' | 'log';
  data: any;
  walletId?: string;
  addressId?: string;
}

export class SanctauryWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private subscriptions: Map<string, Set<AuthenticatedWebSocket>> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();

    log.debug('WebSocket server initialized on /ws');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const client = ws as AuthenticatedWebSocket;
    client.subscriptions = new Set();
    client.isAlive = true;

    // Extract and verify JWT token from query or header
    const token = this.extractToken(request);

    if (token) {
      try {
        const decoded = verifyToken(token);
        client.userId = decoded.userId;
        log.debug(`WebSocket client authenticated: ${client.userId}`);
      } catch (err) {
        log.error('WebSocket authentication failed', { error: String(err) });
        client.close(1008, 'Authentication failed');
        return;
      }
    } else {
      log.debug('WebSocket client connected without authentication');
      // Allow unauthenticated connections but limit functionality
      // Set timeout to close if they don't authenticate
      client.authTimeout = setTimeout(() => {
        if (!client.userId) {
          log.debug('Closing unauthenticated connection due to timeout');
          client.close(4001, 'Authentication timeout');
        }
      }, AUTH_TIMEOUT_MS);
    }

    this.clients.add(client);

    // Setup message handler
    client.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    // Setup pong handler for heartbeat
    client.on('pong', () => {
      client.isAlive = true;
    });

    // Setup close handler
    client.on('close', () => {
      this.handleDisconnect(client);
    });

    // Setup error handler
    client.on('error', (error) => {
      log.error('WebSocket error:', error);
      this.handleDisconnect(client);
    });

    // Send welcome message
    this.sendToClient(client, {
      type: 'connected',
      data: {
        authenticated: !!client.userId,
        subscriptions: Array.from(client.subscriptions),
      },
    });
  }

  /**
   * Extract JWT token from request
   *
   * SECURITY NOTE: Token in query parameter is supported for backwards compatibility
   * but is discouraged. The frontend client uses 'auth' message after connection instead.
   * Query parameter support may be removed in a future version.
   */
  private extractToken(request: IncomingMessage): string | null {
    // Try Authorization header first (preferred)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Fallback to query parameter (deprecated - avoid using in new code)
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const tokenParam = url.searchParams.get('token');
    if (tokenParam) {
      log.debug('Client using deprecated query parameter auth');
      return tokenParam;
    }

    return null;
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: AuthenticatedWebSocket, data: Buffer) {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'auth':
          this.handleAuth(client, message.data);
          break;

        case 'subscribe':
          this.handleSubscribe(client, message.data);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(client, message.data);
          break;

        case 'ping':
          this.sendToClient(client, { type: 'pong' });
          break;

        default:
          log.warn('Unknown message type', { type: message.type });
      }
    } catch (err) {
      log.error('Failed to parse WebSocket message', { error: String(err) });
    }
  }

  /**
   * Handle authentication via message (more secure than URL token)
   */
  private handleAuth(client: AuthenticatedWebSocket, data: Record<string, unknown> | undefined) {
    if (!data?.token || typeof data.token !== 'string') {
      this.sendToClient(client, {
        type: 'error',
        data: { message: 'Authentication token required' },
      });
      return;
    }

    // Don't allow re-authentication
    if (client.userId) {
      this.sendToClient(client, {
        type: 'authenticated',
        data: { success: true, userId: client.userId, message: 'Already authenticated' },
      });
      return;
    }

    try {
      const decoded = verifyToken(data.token);
      client.userId = decoded.userId;
      log.debug(`WebSocket client authenticated via message: ${client.userId}`);

      // Clear authentication timeout
      if (client.authTimeout) {
        clearTimeout(client.authTimeout);
        client.authTimeout = undefined;
      }

      this.sendToClient(client, {
        type: 'authenticated',
        data: { success: true, userId: client.userId },
      });
    } catch (err) {
      log.error('WebSocket authentication failed', { error: String(err) });
      this.sendToClient(client, {
        type: 'error',
        data: { message: 'Authentication failed' },
      });
    }
  }

  /**
   * Handle subscription request
   * SECURITY: Validates that user has access to wallet-specific channels
   */
  private async handleSubscribe(client: AuthenticatedWebSocket, data: Record<string, unknown> | undefined) {
    if (!data?.channel || typeof data.channel !== 'string') {
      log.warn('Subscribe request missing channel');
      return;
    }

    const { channel } = data;

    // Validate subscription based on authentication
    if (channel.startsWith('wallet:') && !client.userId) {
      this.sendToClient(client, {
        type: 'error',
        data: { message: 'Authentication required for wallet subscriptions' },
      });
      return;
    }

    // Validate wallet access for wallet-specific channels
    if (channel.startsWith('wallet:') && client.userId) {
      const walletIdMatch = channel.match(/^wallet:([a-f0-9-]+)/);
      if (walletIdMatch) {
        const walletId = walletIdMatch[1];
        const hasAccess = await checkWalletAccess(walletId, client.userId);
        if (!hasAccess) {
          log.warn(`User ${client.userId} denied access to wallet ${walletId}`);
          this.sendToClient(client, {
            type: 'error',
            data: { message: 'Access denied to this wallet' },
          });
          return;
        }
      }
    }

    // Add to subscriptions
    client.subscriptions.add(channel);

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(client);

    log.debug(`Client subscribed to ${channel}`);

    this.sendToClient(client, {
      type: 'subscribed',
      data: { channel },
    });
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(client: AuthenticatedWebSocket, data: Record<string, unknown> | undefined) {
    if (!data?.channel || typeof data.channel !== 'string') return;

    const { channel } = data;
    client.subscriptions.delete(channel);

    const subscribers = this.subscriptions.get(channel);
    if (subscribers) {
      subscribers.delete(client);
      if (subscribers.size === 0) {
        this.subscriptions.delete(channel);
      }
    }

    log.debug(`Client unsubscribed from ${channel}`);

    this.sendToClient(client, {
      type: 'unsubscribed',
      data: { channel },
    });
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(client: AuthenticatedWebSocket) {
    // Clear any pending auth timeout
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }

    this.clients.delete(client);

    // Remove from all subscriptions
    for (const [channel, subscribers] of this.subscriptions.entries()) {
      subscribers.delete(client);
      if (subscribers.size === 0) {
        this.subscriptions.delete(channel);
      }
    }

    log.debug('WebSocket client disconnected');
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: AuthenticatedWebSocket, message: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast event to all subscribers
   */
  public broadcast(event: WebSocketEvent) {
    const channels = this.getChannelsForEvent(event);

    for (const channel of channels) {
      const subscribers = this.subscriptions.get(channel);
      if (subscribers) {
        const message = {
          type: 'event',
          event: event.type,
          data: event.data,
          channel,
          timestamp: Date.now(),
        };

        for (const client of subscribers) {
          this.sendToClient(client, message);
        }
      }
    }
  }

  /**
   * Get channels that should receive this event
   */
  private getChannelsForEvent(event: WebSocketEvent): string[] {
    const channels: string[] = [];

    // Global channels
    if (event.type === 'block') {
      channels.push('blocks');
    }

    if (event.type === 'mempool') {
      channels.push('mempool');
    }

    // Wallet-specific channels
    if (event.walletId) {
      channels.push(`wallet:${event.walletId}`);
      channels.push(`wallet:${event.walletId}:${event.type}`);
    }

    // Address-specific channels
    if (event.addressId) {
      channels.push(`address:${event.addressId}`);
    }

    return channels;
  }

  /**
   * Heartbeat to detect dead connections
   */
  private startHeartbeat() {
    const interval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          log.debug('Terminating dead connection');
          client.terminate();
          this.handleDisconnect(client);
          continue;
        }

        client.isAlive = false;
        client.ping();
      }
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * Get statistics
   */
  public getStats() {
    return {
      clients: this.clients.size,
      subscriptions: this.subscriptions.size,
      channels: Array.from(this.subscriptions.keys()),
    };
  }

  /**
   * Close server
   */
  public close() {
    for (const client of this.clients) {
      client.close(1000, 'Server closing');
    }
    this.wss.close();
  }
}

// Export singleton instance (will be initialized in main server)
let wsServer: SanctauryWebSocketServer | null = null;

export const initializeWebSocketServer = (httpServer: Server): SanctauryWebSocketServer => {
  if (wsServer) {
    throw new Error('WebSocket server already initialized');
  }
  wsServer = new SanctauryWebSocketServer(httpServer);
  return wsServer;
};

export const getWebSocketServer = (): SanctauryWebSocketServer => {
  if (!wsServer) {
    throw new Error('WebSocket server not initialized');
  }
  return wsServer;
};
