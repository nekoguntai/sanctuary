/**
 * WebSocket Server for Real-Time Updates
 *
 * Provides real-time notifications for:
 * - New transactions
 * - Balance updates
 * - Transaction confirmations
 * - New blocks
 * - Mempool updates
 *
 * Also provides a separate /gateway endpoint for push notification gateway
 * with HMAC challenge-response authentication (SEC-001).
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { verifyToken } from '../utils/jwt';
import { Server } from 'http';
import { createLogger } from '../utils/logger';
import { checkWalletAccess } from '../services/wallet';
import config from '../config';

const log = createLogger('WS');

// Timeout for unauthenticated connections (30 seconds)
const AUTH_TIMEOUT_MS = 30000;

// Connection limits to prevent resource exhaustion
const MAX_WEBSOCKET_CONNECTIONS = parseInt(process.env.MAX_WEBSOCKET_CONNECTIONS || '10000', 10);
const MAX_WEBSOCKET_PER_USER = parseInt(process.env.MAX_WEBSOCKET_PER_USER || '10', 10);

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
  type: 'transaction' | 'balance' | 'confirmation' | 'block' | 'newBlock' | 'mempool' | 'sync' | 'log' | 'modelDownload';
  data: any;
  walletId?: string;
  addressId?: string;
}

export class SanctauryWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private subscriptions: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private connectionsPerUser: Map<string, Set<AuthenticatedWebSocket>> = new Map();

  constructor() {
    this.wss = new WebSocketServer({
      noServer: true,
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();

    log.debug('WebSocket server initialized');
  }

  /**
   * Handle HTTP upgrade request
   */
  public handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const client = ws as AuthenticatedWebSocket;
    client.subscriptions = new Set();
    client.isAlive = true;

    // Check total connection limit
    if (this.clients.size >= MAX_WEBSOCKET_CONNECTIONS) {
      log.warn(`Connection rejected: total limit of ${MAX_WEBSOCKET_CONNECTIONS} reached`);
      client.close(1008, 'Server connection limit reached');
      return;
    }

    // Extract and verify JWT token from query or header
    const token = this.extractToken(request);

    log.info(`WebSocket connection attempt from ${request.socket.remoteAddress}`);

    if (token) {
      verifyToken(token)
        .then((decoded) => {
          client.userId = decoded.userId;

          // Check per-user connection limit
          const userConnections = this.connectionsPerUser.get(client.userId);
          if (userConnections && userConnections.size >= MAX_WEBSOCKET_PER_USER) {
            log.warn(`Connection rejected for user ${client.userId}: per-user limit of ${MAX_WEBSOCKET_PER_USER} reached`);
            client.close(1008, `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached`);
            return;
          }

          log.info(`WebSocket client authenticated: ${client.userId}`);

          // Track per-user connection
          if (!this.connectionsPerUser.has(client.userId)) {
            this.connectionsPerUser.set(client.userId, new Set());
          }
          this.connectionsPerUser.get(client.userId)!.add(client);

          // Complete client registration
          this.completeClientRegistration(client);
        })
        .catch((err) => {
          log.error('WebSocket authentication failed', { error: String(err) });
          client.close(1008, 'Authentication failed');
        });
      return; // Return early, client registration happens in promise
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

    // Complete registration (adds to clients set, sets up handlers)
    this.completeClientRegistration(client);
  }

  /**
   * Complete client registration - adds to clients set, sets up handlers, sends welcome
   * Extracted to be callable from both sync and async auth paths
   */
  private completeClientRegistration(client: AuthenticatedWebSocket) {
    this.clients.add(client);

    // Track per-user connections (only if not already tracked from async auth)
    if (client.userId) {
      if (!this.connectionsPerUser.has(client.userId)) {
        this.connectionsPerUser.set(client.userId, new Set());
      }
      // Only add if not already in the set (async auth may have already added)
      const userConns = this.connectionsPerUser.get(client.userId)!;
      if (!userConns.has(client)) {
        userConns.add(client);
      }
    }

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
  private async handleAuth(client: AuthenticatedWebSocket, data: Record<string, unknown> | undefined) {
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
      const decoded = await verifyToken(data.token);
      const userId = decoded.userId;

      // Check per-user connection limit
      const userConnections = this.connectionsPerUser.get(userId);
      if (userConnections && userConnections.size >= MAX_WEBSOCKET_PER_USER) {
        log.warn(`Authentication rejected for user ${userId}: per-user limit of ${MAX_WEBSOCKET_PER_USER} reached`);
        this.sendToClient(client, {
          type: 'error',
          data: { message: `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached` },
        });
        client.close(1008, `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached`);
        return;
      }

      client.userId = userId;
      log.debug(`WebSocket client authenticated via message: ${client.userId}`);

      // Track per-user connection
      if (!this.connectionsPerUser.has(userId)) {
        this.connectionsPerUser.set(userId, new Set());
      }
      this.connectionsPerUser.get(userId)!.add(client);

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

    log.info(`Client subscribed to ${channel} (total subscribers: ${this.subscriptions.get(channel)!.size})`);

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

    // Remove from per-user connection tracking
    if (client.userId) {
      const userConnections = this.connectionsPerUser.get(client.userId);
      if (userConnections) {
        userConnections.delete(client);
        // Clean up empty sets to prevent memory leaks
        if (userConnections.size === 0) {
          this.connectionsPerUser.delete(client.userId);
        }
      }
    }

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

    // Model download is a system-wide event - broadcast to all authenticated clients
    if (event.type === 'modelDownload') {
      channels.push('system');
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
      maxClients: MAX_WEBSOCKET_CONNECTIONS,
      subscriptions: this.subscriptions.size,
      channels: Array.from(this.subscriptions.keys()),
      uniqueUsers: this.connectionsPerUser.size,
      maxPerUser: MAX_WEBSOCKET_PER_USER,
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

export const initializeWebSocketServer = (): SanctauryWebSocketServer => {
  if (wsServer) {
    throw new Error('WebSocket server already initialized');
  }
  wsServer = new SanctauryWebSocketServer();
  return wsServer;
};

export const getWebSocketServer = (): SanctauryWebSocketServer => {
  if (!wsServer) {
    throw new Error('WebSocket server not initialized');
  }
  return wsServer;
};

// ============================================================================
// GATEWAY WEBSOCKET SERVER (SEC-001)
// ============================================================================

/**
 * Gateway WebSocket with HMAC challenge-response authentication
 *
 * SEC-001: Replaces JWT secret sharing with proper HMAC challenge-response.
 *
 * ## Authentication Flow
 *
 * 1. Gateway connects to /gateway WebSocket endpoint
 * 2. Server sends challenge: { type: 'auth_challenge', challenge: <random-hex> }
 * 3. Gateway responds: { type: 'auth_response', response: HMAC-SHA256(challenge, GATEWAY_SECRET) }
 * 4. Server verifies HMAC and sends: { type: 'auth_success' } or closes connection
 */

const GATEWAY_AUTH_TIMEOUT_MS = 10000; // 10 seconds to complete auth

interface GatewayWebSocket extends WebSocket {
  isAuthenticated: boolean;
  authTimeout?: NodeJS.Timeout;
  challenge?: string;
}

/**
 * Gateway WebSocket Server
 *
 * Handles push notification gateway connections with secure authentication.
 */
export class GatewayWebSocketServer {
  private wss: WebSocketServer;
  private gateway: GatewayWebSocket | null = null;

  constructor() {
    this.wss = new WebSocketServer({
      noServer: true,
    });

    this.wss.on('connection', this.handleConnection.bind(this));

    log.debug('Gateway WebSocket server initialized');
  }

  /**
   * Handle HTTP upgrade request
   */
  public handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Handle new gateway connection
   */
  private handleConnection(ws: WebSocket, _request: IncomingMessage) {
    const client = ws as GatewayWebSocket;
    client.isAuthenticated = false;

    // If gateway secret is not configured, reject all connections
    if (!config.gatewaySecret) {
      log.error('Gateway connection rejected: GATEWAY_SECRET not configured');
      client.close(4003, 'Gateway authentication not configured');
      return;
    }

    // Generate challenge
    const challenge = randomBytes(32).toString('hex');
    client.challenge = challenge;

    // Set authentication timeout
    client.authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        log.warn('Gateway authentication timeout');
        client.close(4001, 'Authentication timeout');
      }
    }, GATEWAY_AUTH_TIMEOUT_MS);

    // Send challenge
    this.sendToClient(client, {
      type: 'auth_challenge',
      challenge,
    });

    log.debug('Gateway connected, challenge sent');

    // Handle messages
    client.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    // Handle close
    client.on('close', () => {
      if (client.authTimeout) {
        clearTimeout(client.authTimeout);
      }
      if (this.gateway === client) {
        this.gateway = null;
        log.warn('Gateway disconnected');
      }
    });

    // Handle errors
    client.on('error', (error) => {
      log.error('Gateway WebSocket error:', error);
    });
  }

  /**
   * Handle message from gateway
   */
  private handleMessage(client: GatewayWebSocket, data: Buffer) {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'auth_response') {
        this.handleAuthResponse(client, message.response);
      } else if (client.isAuthenticated) {
        // Handle other message types only if authenticated
        log.debug('Gateway message received', { type: message.type });
      } else {
        log.warn('Unauthenticated gateway message rejected');
        client.close(4002, 'Authentication required');
      }
    } catch (err) {
      log.error('Failed to parse gateway message', { error: String(err) });
    }
  }

  /**
   * Verify HMAC challenge response
   */
  private handleAuthResponse(client: GatewayWebSocket, response: string) {
    if (!client.challenge) {
      log.warn('Auth response without challenge');
      client.close(4002, 'Invalid authentication state');
      return;
    }

    // Calculate expected response
    const expectedResponse = createHmac('sha256', config.gatewaySecret)
      .update(client.challenge)
      .digest('hex');

    // Time-safe comparison
    let isValid = false;
    try {
      const responseBuf = Buffer.from(response, 'hex');
      const expectedBuf = Buffer.from(expectedResponse, 'hex');
      if (responseBuf.length === expectedBuf.length) {
        isValid = timingSafeEqual(responseBuf, expectedBuf);
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      log.warn('Gateway authentication failed: invalid response');
      client.close(4003, 'Authentication failed');
      return;
    }

    // Authentication successful
    client.isAuthenticated = true;
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }
    client.challenge = undefined;

    // Replace existing gateway connection
    if (this.gateway && this.gateway !== client) {
      log.info('Replacing existing gateway connection');
      this.gateway.close(1000, 'Replaced by new connection');
    }
    this.gateway = client;

    this.sendToClient(client, { type: 'auth_success' });
    log.info('Gateway authenticated successfully');
  }

  /**
   * Send message to gateway client
   */
  private sendToClient(client: GatewayWebSocket, message: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Send event to connected gateway
   */
  public sendEvent(event: WebSocketEvent) {
    if (!this.gateway || !this.gateway.isAuthenticated) {
      log.debug('No authenticated gateway to send event');
      return;
    }

    this.sendToClient(this.gateway, {
      type: 'event',
      event,
    });
  }

  /**
   * Check if gateway is connected and authenticated
   */
  public isGatewayConnected(): boolean {
    return this.gateway !== null && this.gateway.isAuthenticated;
  }

  /**
   * Close server
   */
  public close() {
    if (this.gateway) {
      this.gateway.close(1000, 'Server closing');
      this.gateway = null;
    }
    this.wss.close();
  }
}

// Gateway WebSocket server singleton
let gatewayWsServer: GatewayWebSocketServer | null = null;

export const initializeGatewayWebSocketServer = (): GatewayWebSocketServer => {
  if (gatewayWsServer) {
    throw new Error('Gateway WebSocket server already initialized');
  }
  gatewayWsServer = new GatewayWebSocketServer();
  return gatewayWsServer;
};

export const getGatewayWebSocketServer = (): GatewayWebSocketServer | null => {
  return gatewayWsServer;
};
