/**
 * Client WebSocket Server
 *
 * Handles real-time WebSocket connections for browser clients.
 * Provides:
 * - JWT authentication (via header, query param, or message)
 * - Channel subscriptions with wallet access validation
 * - Rate limiting with grace period for connection setup
 * - Bounded message queues with backpressure handling
 * - Cross-instance broadcasting via Redis
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '../utils/jwt';
import { createLogger } from '../utils/logger';
import { checkWalletAccess } from '../services/accessControl';
import { redisBridge } from './redisBridge';
import { parseClientMessage } from './schemas';
import {
  websocketConnections,
  websocketMessagesTotal,
  websocketRateLimitHits,
  websocketSubscriptions,
  websocketConnectionDuration,
} from '../observability/metrics';
import {
  AUTH_TIMEOUT_MS,
  MAX_WEBSOCKET_CONNECTIONS,
  MAX_WEBSOCKET_PER_USER,
  MAX_MESSAGES_PER_SECOND,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  RATE_LIMIT_GRACE_PERIOD_MS,
  GRACE_PERIOD_MESSAGE_LIMIT,
  MAX_RATE_LIMIT_EVENTS,
  MAX_QUEUE_SIZE,
  QUEUE_OVERFLOW_POLICY,
  RateLimitEvent,
  AuthenticatedWebSocket,
  WebSocketEvent,
} from './types';

const log = createLogger('WS');

// ============================================================================
// Rate Limit Event Tracking
// ============================================================================

/** Buffer of recent rate limit events for admin visibility */
const rateLimitEvents: RateLimitEvent[] = [];

/** Track dropped messages for observability */
let droppedMessagesTotal = 0;

/**
 * Record a rate limit event for admin visibility
 */
function recordRateLimitEvent(
  userId: string | null,
  reason: RateLimitEvent['reason'],
  details: string
): void {
  rateLimitEvents.unshift({
    timestamp: new Date().toISOString(),
    userId,
    reason,
    details,
  });
  // Keep only the most recent events
  if (rateLimitEvents.length > MAX_RATE_LIMIT_EVENTS) {
    rateLimitEvents.pop();
  }
}

/**
 * Get recent rate limit events (used by admin API)
 */
export function getRateLimitEvents(): RateLimitEvent[] {
  return [...rateLimitEvents];
}

// ============================================================================
// Client WebSocket Server
// ============================================================================

/**
 * WebSocket server for browser clients
 *
 * Features:
 * - Authentication via JWT (header, query param, or auth message)
 * - Channel-based subscriptions with wallet access validation
 * - Rate limiting with initial grace period
 * - Bounded message queues with configurable overflow policy
 * - Heartbeat for dead connection detection
 */
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
    client.messageCount = 0;
    client.lastMessageReset = Date.now();
    client.connectionTime = Date.now();
    client.totalMessageCount = 0;
    // Initialize bounded message queue
    client.messageQueue = [];
    client.isProcessingQueue = false;
    client.droppedMessages = 0;

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
          client.closeReason = 'auth_timeout';
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

    // Track WebSocket connection metric
    websocketConnections.inc({ type: 'main' });

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
      log.error('WebSocket error', { error });
      client.closeReason = 'error';
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
    // Track incoming WebSocket message metric
    websocketMessagesTotal.inc({ type: 'main', direction: 'in' });

    const now = Date.now();
    client.totalMessageCount++;

    // Check if we're still in the grace period (allows initial auth + subscription burst)
    const inGracePeriod = (now - client.connectionTime) < RATE_LIMIT_GRACE_PERIOD_MS;

    if (inGracePeriod) {
      // During grace period, only check total message limit (more lenient)
      if (client.totalMessageCount > GRACE_PERIOD_MESSAGE_LIMIT) {
        log.warn('Grace period message limit exceeded, closing connection', {
          userId: client.userId,
          totalMessageCount: client.totalMessageCount,
        });
        // Record metric and event
        websocketRateLimitHits.inc({ reason: 'grace_period_exceeded' });
        recordRateLimitEvent(
          client.userId || null,
          'grace_period_exceeded',
          `${client.totalMessageCount}/${GRACE_PERIOD_MESSAGE_LIMIT} messages during setup`
        );
        // Notify user before disconnecting
        this.sendToClient(client, {
          type: 'error',
          data: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Message limit exceeded during connection setup (${client.totalMessageCount}/${GRACE_PERIOD_MESSAGE_LIMIT})`,
            hint: 'Consider using batch subscriptions or increase WS_GRACE_PERIOD_LIMIT',
          },
        });
        client.closeReason = 'rate_limit';
        client.close(1008, 'Rate limit exceeded');
        return;
      }
    } else {
      // After grace period, enforce strict per-second rate limiting
      if (now - client.lastMessageReset >= 1000) {
        // Reset counter every second
        client.messageCount = 0;
        client.lastMessageReset = now;
      }

      client.messageCount++;
      if (client.messageCount > MAX_MESSAGES_PER_SECOND) {
        log.warn('Rate limit exceeded, closing connection', {
          userId: client.userId,
          messageCount: client.messageCount,
        });
        // Record metric and event
        websocketRateLimitHits.inc({ reason: 'per_second_exceeded' });
        recordRateLimitEvent(
          client.userId || null,
          'per_second_exceeded',
          `${client.messageCount}/${MAX_MESSAGES_PER_SECOND} messages/sec`
        );
        // Notify user before disconnecting
        this.sendToClient(client, {
          type: 'error',
          data: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Message rate limit exceeded (${client.messageCount}/${MAX_MESSAGES_PER_SECOND} per second)`,
            hint: 'Reduce message frequency or increase MAX_WS_MESSAGES_PER_SECOND',
          },
        });
        client.closeReason = 'rate_limit';
        client.close(1008, 'Rate limit exceeded');
        return;
      }
    }

    const result = parseClientMessage(data.toString());

    if (!result.success) {
      log.warn('Invalid WebSocket message', { error: result.error });
      return;
    }

    const message = result.data;

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

      case 'subscribe_batch':
        this.handleSubscribeBatch(client, message.data);
        break;

      case 'unsubscribe_batch':
        this.handleUnsubscribeBatch(client, message.data);
        break;

      case 'ping':
        this.sendToClient(client, { type: 'pong' });
        break;

      case 'pong':
        // Client pong response, no action needed
        break;
    }
  }

  /**
   * Handle authentication via message (more secure than URL token)
   */
  private async handleAuth(client: AuthenticatedWebSocket, data: { token: string }) {
    const { token } = data;

    // Don't allow re-authentication
    if (client.userId) {
      this.sendToClient(client, {
        type: 'authenticated',
        data: { success: true, userId: client.userId, message: 'Already authenticated' },
      });
      return;
    }

    try {
      const decoded = await verifyToken(token);
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
  private async handleSubscribe(client: AuthenticatedWebSocket, data: { channel: string }) {
    const { channel } = data;

    // Check subscription limit
    if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
      log.warn('Subscription limit exceeded', {
        userId: client.userId,
        subscriptionCount: client.subscriptions.size,
        channel,
      });
      // Record metric and event
      websocketRateLimitHits.inc({ reason: 'subscription_limit' });
      recordRateLimitEvent(
        client.userId || null,
        'subscription_limit',
        `${client.subscriptions.size}/${MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions`
      );
      this.sendToClient(client, {
        type: 'error',
        data: {
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
          message: `Subscription limit of ${MAX_SUBSCRIPTIONS_PER_CONNECTION} exceeded`,
          current: client.subscriptions.size,
          limit: MAX_SUBSCRIPTIONS_PER_CONNECTION,
          hint: 'Consider using fewer subscriptions or increase MAX_WS_SUBSCRIPTIONS',
        },
      });
      return;
    }

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
        const access = await checkWalletAccess(walletId, client.userId);
        if (!access.hasAccess) {
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

    // Track subscription gauge
    websocketSubscriptions.inc();

    log.info(`Client subscribed to ${channel} (total subscribers: ${this.subscriptions.get(channel)!.size})`);

    this.sendToClient(client, {
      type: 'subscribed',
      data: { channel },
    });
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(client: AuthenticatedWebSocket, data: { channel: string }) {
    const { channel } = data;

    // Only process if actually subscribed
    if (!client.subscriptions.has(channel)) return;

    client.subscriptions.delete(channel);

    const subscribers = this.subscriptions.get(channel);
    if (subscribers) {
      subscribers.delete(client);
      if (subscribers.size === 0) {
        this.subscriptions.delete(channel);
      }
    }

    // Track subscription gauge
    websocketSubscriptions.dec();

    log.debug(`Client unsubscribed from ${channel}`);

    this.sendToClient(client, {
      type: 'unsubscribed',
      data: { channel },
    });
  }

  /**
   * Handle batch subscribe request (scalable subscription for many channels)
   * Reduces message count from O(N) to O(1) for N channels
   */
  private async handleSubscribeBatch(client: AuthenticatedWebSocket, data: { channels: string[] }) {
    const { channels } = data;
    const subscribed: string[] = [];
    const errors: { channel: string; reason: string }[] = [];

    for (const channel of channels) {
      // Check subscription limit
      if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
        errors.push({ channel, reason: 'Subscription limit reached' });
        continue;
      }

      // Skip if already subscribed
      if (client.subscriptions.has(channel)) {
        subscribed.push(channel);
        continue;
      }

      // Validate subscription based on authentication
      if (channel.startsWith('wallet:') && !client.userId) {
        errors.push({ channel, reason: 'Authentication required' });
        continue;
      }

      // Validate wallet access for wallet-specific channels
      if (channel.startsWith('wallet:') && client.userId) {
        const walletIdMatch = channel.match(/^wallet:([a-f0-9-]+)/);
        if (walletIdMatch) {
          const walletId = walletIdMatch[1];
          const access = await checkWalletAccess(walletId, client.userId);
          if (!access.hasAccess) {
            errors.push({ channel, reason: 'Access denied' });
            continue;
          }
        }
      }

      // Add to subscriptions
      client.subscriptions.add(channel);

      if (!this.subscriptions.has(channel)) {
        this.subscriptions.set(channel, new Set());
      }
      this.subscriptions.get(channel)!.add(client);
      subscribed.push(channel);

      // Track subscription gauge
      websocketSubscriptions.inc();
    }

    log.info(`Client batch subscribed to ${subscribed.length} channels (${errors.length} errors)`);

    this.sendToClient(client, {
      type: 'subscribed_batch',
      data: { subscribed, errors: errors.length > 0 ? errors : undefined },
    });
  }

  /**
   * Handle batch unsubscribe request
   */
  private handleUnsubscribeBatch(client: AuthenticatedWebSocket, data: { channels: string[] }) {
    const { channels } = data;
    const unsubscribed: string[] = [];

    for (const channel of channels) {
      if (!client.subscriptions.has(channel)) continue;

      client.subscriptions.delete(channel);

      const subscribers = this.subscriptions.get(channel);
      if (subscribers) {
        subscribers.delete(client);
        if (subscribers.size === 0) {
          this.subscriptions.delete(channel);
        }
      }

      unsubscribed.push(channel);

      // Track subscription gauge
      websocketSubscriptions.dec();
    }

    log.debug(`Client batch unsubscribed from ${unsubscribed.length} channels`);

    this.sendToClient(client, {
      type: 'unsubscribed_batch',
      data: { unsubscribed },
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

    // Track connection duration
    const connectionDurationSec = (Date.now() - client.connectionTime) / 1000;
    const closeReason = client.closeReason || 'normal';
    websocketConnectionDuration.observe({ close_reason: closeReason }, connectionDurationSec);

    this.clients.delete(client);

    // Track WebSocket disconnection metric
    websocketConnections.dec({ type: 'main' });

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

    // Remove from all subscriptions and decrement gauge
    const subscriptionCount = client.subscriptions.size;
    for (const [channel, subscribers] of this.subscriptions.entries()) {
      if (subscribers.has(client)) {
        subscribers.delete(client);
        if (subscribers.size === 0) {
          this.subscriptions.delete(channel);
        }
      }
    }
    // Decrement subscription gauge by count of client's subscriptions
    if (subscriptionCount > 0) {
      websocketSubscriptions.dec(subscriptionCount);
    }

    log.debug('WebSocket client disconnected', { closeReason, durationSec: connectionDurationSec.toFixed(1) });
  }

  /**
   * Send message to specific client with bounded queue
   * Returns false if message was dropped due to queue overflow
   */
  private sendToClient(client: AuthenticatedWebSocket, message: any): boolean {
    if (client.readyState !== WebSocket.OPEN) {
      return false;
    }

    const messageStr = JSON.stringify(message);

    // Check queue capacity
    if (client.messageQueue.length >= MAX_QUEUE_SIZE) {
      // Apply overflow policy
      switch (QUEUE_OVERFLOW_POLICY) {
        case 'drop_oldest':
          // Drop oldest message to make room
          client.messageQueue.shift();
          client.droppedMessages++;
          droppedMessagesTotal++;
          log.debug('Dropped oldest message due to queue overflow', {
            userId: client.userId,
            queueSize: client.messageQueue.length,
          });
          break;

        case 'drop_newest':
          // Reject this new message
          client.droppedMessages++;
          droppedMessagesTotal++;
          log.debug('Dropped new message due to queue overflow', {
            userId: client.userId,
            queueSize: client.messageQueue.length,
          });
          return false;

        case 'disconnect':
          // Disconnect slow consumer
          log.warn('Disconnecting client due to queue overflow', {
            userId: client.userId,
            queueSize: client.messageQueue.length,
            droppedMessages: client.droppedMessages,
          });
          recordRateLimitEvent(
            client.userId || null,
            'queue_overflow',
            `Queue full: ${client.messageQueue.length}/${MAX_QUEUE_SIZE} messages`
          );
          client.closeReason = 'queue_overflow';
          client.close(4009, 'Message queue overflow');
          return false;
      }
    }

    // Add to queue
    client.messageQueue.push(messageStr);

    // Process queue if not already processing
    if (!client.isProcessingQueue) {
      this.processClientQueue(client);
    }

    return true;
  }

  /**
   * Process queued messages for a client
   * Uses drain event to handle backpressure from slow consumers
   */
  private processClientQueue(client: AuthenticatedWebSocket): void {
    if (client.readyState !== WebSocket.OPEN || client.messageQueue.length === 0) {
      client.isProcessingQueue = false;
      return;
    }

    client.isProcessingQueue = true;

    // Send messages while socket buffer is not full
    while (client.messageQueue.length > 0 && client.readyState === WebSocket.OPEN) {
      const message = client.messageQueue.shift()!;

      // Check if socket buffer is getting full (backpressure)
      const bufferSize = client.bufferedAmount;
      if (bufferSize > 64 * 1024) { // 64KB threshold
        // Re-queue message and wait for drain
        client.messageQueue.unshift(message);
        log.debug('Socket buffer full, waiting for drain', {
          userId: client.userId,
          bufferSize,
          queuedMessages: client.messageQueue.length,
        });

        // Wait for drain event before continuing
        client.once('drain', () => {
          this.processClientQueue(client);
        });
        return;
      }

      client.send(message);
      // Track outgoing WebSocket message metric
      websocketMessagesTotal.inc({ type: 'main', direction: 'out' });
    }

    client.isProcessingQueue = false;
  }

  /**
   * Broadcast event to all subscribers (local + cross-instance via Redis)
   *
   * When running multiple server instances behind a load balancer,
   * this publishes the event to Redis so other instances can broadcast
   * to their local clients as well.
   */
  public broadcast(event: WebSocketEvent) {
    // Publish to Redis for other instances (no-op if Redis unavailable)
    redisBridge.publishBroadcast(event);

    // Broadcast to local clients on this instance
    this.localBroadcast(event);
  }

  /**
   * Broadcast event to local subscribers only (used by Redis bridge)
   *
   * This is the actual broadcast logic that sends to WebSocket clients
   * connected to this specific server instance.
   */
  public localBroadcast(event: WebSocketEvent) {
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
    if (event.type === 'block' || event.type === 'newBlock') {
      channels.push('blocks');
    }

    if (event.type === 'mempool') {
      channels.push('mempool');
    }

    // Model download is a system-wide event - broadcast to all authenticated clients
    if (event.type === 'modelDownload') {
      channels.push('system');
    }

    // Sync events go to global channel for cross-page cache updates
    if (event.type === 'sync') {
      channels.push('sync:all');
    }

    // Transaction events go to global channel for cross-page cache updates
    // This ensures all browser windows receive updates even if wallet-specific
    // subscriptions failed due to auth race conditions
    if (event.type === 'transaction' || event.type === 'balance' || event.type === 'confirmation') {
      channels.push('transactions:all');
    }

    // Log events go to global channel for multi-window sync log visibility
    if (event.type === 'log') {
      channels.push('logs:all');
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
      try {
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
      } catch (error) {
        log.error('Error in heartbeat interval', { error });
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
    // Calculate total subscriptions and queue stats across all clients
    let totalSubscriptions = 0;
    let totalQueuedMessages = 0;
    let totalDroppedMessages = 0;
    let maxQueueSize = 0;

    for (const client of this.clients) {
      totalSubscriptions += client.subscriptions.size;
      totalQueuedMessages += client.messageQueue.length;
      totalDroppedMessages += client.droppedMessages;
      maxQueueSize = Math.max(maxQueueSize, client.messageQueue.length);
    }

    return {
      clients: this.clients.size,
      maxClients: MAX_WEBSOCKET_CONNECTIONS,
      subscriptions: totalSubscriptions,
      channels: this.subscriptions.size,
      channelList: Array.from(this.subscriptions.keys()),
      uniqueUsers: this.connectionsPerUser.size,
      maxPerUser: MAX_WEBSOCKET_PER_USER,
      rateLimits: {
        maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND,
        gracePeriodMs: RATE_LIMIT_GRACE_PERIOD_MS,
        gracePeriodMessageLimit: GRACE_PERIOD_MESSAGE_LIMIT,
        maxSubscriptionsPerConnection: MAX_SUBSCRIPTIONS_PER_CONNECTION,
      },
      // Bounded queue stats
      messageQueue: {
        maxQueueSize: MAX_QUEUE_SIZE,
        overflowPolicy: QUEUE_OVERFLOW_POLICY,
        totalQueuedMessages,
        totalDroppedMessages: totalDroppedMessages + droppedMessagesTotal,
        maxClientQueueSize: maxQueueSize,
      },
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
