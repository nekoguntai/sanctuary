/**
 * Backend Events Service
 *
 * This service is a core component of the Gateway's push notification system.
 * It maintains a WebSocket connection to the backend server to receive real-time
 * transaction events, then translates those into push notifications for mobile devices.
 *
 * ## Architecture
 *
 * ```
 * [Backend] --WebSocket--> [Gateway] --FCM/APNs--> [Mobile Apps]
 *     |                        |
 *     |                        +-- Fetches device tokens via HTTP
 *     |
 *     +-- Emits events when transactions occur
 * ```
 *
 * ## Event Flow
 *
 * 1. Backend detects a new transaction (via Electrum subscription or mempool scan)
 * 2. Backend emits WebSocket event with: type, walletId, userId, transaction data
 * 3. Gateway receives event via this service
 * 4. Gateway fetches user's push device tokens from backend (GET /api/v1/push/by-user/:userId)
 * 5. Gateway sends push notification via FCM (Android) or APNs (iOS)
 *
 * ## Supported Event Types
 *
 * - `transaction` - New incoming/outgoing transaction detected
 * - `confirmation` - Transaction received first confirmation
 *
 * ## Authentication (SEC-001)
 *
 * Uses HMAC challenge-response authentication instead of JWT secret sharing:
 * 1. Backend sends challenge on connect
 * 2. Gateway responds with HMAC-SHA256(challenge, GATEWAY_SECRET)
 * 3. Backend verifies and grants access
 *
 * ## Reconnection
 *
 * The service automatically reconnects on disconnect with a 5-second delay.
 * This ensures push notifications continue working after temporary network issues.
 */

import WebSocket from 'ws';
import { createHmac, createHash } from 'crypto';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import * as push from './push';

const log = createLogger('BACKEND_EVENTS');

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Backend event types
 *
 * - `transaction` - New incoming/outgoing transaction detected
 * - `confirmation` - Transaction received first confirmation
 * - `balance` - Balance changed (not sent as push)
 * - `sync` - Wallet sync completed (not sent as push)
 * - `broadcast_success` - Transaction broadcast succeeded
 * - `broadcast_failed` - Transaction broadcast failed
 * - `psbt_signing_required` - Multisig needs co-signer
 * - `draft_created` - New draft transaction for approval
 * - `draft_approved` - Draft was approved by co-signer
 */
type BackendEventType =
  | 'transaction'
  | 'confirmation'
  | 'balance'
  | 'sync'
  | 'broadcast_success'
  | 'broadcast_failed'
  | 'psbt_signing_required'
  | 'draft_created'
  | 'draft_approved';

interface BackendEvent {
  type: BackendEventType;
  walletId: string;
  walletName?: string;
  userId?: string;
  data: {
    txid?: string;
    type?: 'received' | 'sent' | 'consolidation';
    amount?: number;
    confirmations?: number;
    // Broadcast events
    error?: string;
    // Draft/PSBT events
    draftId?: string;
    creatorName?: string;
    signerName?: string;
    requiredSignatures?: number;
    currentSignatures?: number;
  };
}

interface DeviceInfo {
  id: string;
  platform: 'ios' | 'android';
  pushToken: string;
  userId: string;
}

/**
 * Generate HMAC signature for gateway requests (SEC-002)
 */
function generateRequestSignature(
  method: string,
  path: string,
  body: unknown
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const bodyHash = body && Object.keys(body as object).length > 0
    ? createHash('sha256').update(JSON.stringify(body)).digest('hex')
    : '';
  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  const signature = createHmac('sha256', config.gatewaySecret)
    .update(message)
    .digest('hex');
  return { signature, timestamp };
}

/**
 * Fetch devices for a user from the backend
 *
 * Calls the backend's internal endpoint to get all registered push devices
 * for a given user. This is used when we receive a transaction event and
 * need to determine which devices should receive push notifications.
 *
 * SEC-002: Uses HMAC signature instead of spoofable X-Gateway-Request header.
 */
async function getDevicesForUser(userId: string): Promise<DeviceInfo[]> {
  try {
    const path = `/api/v1/push/by-user/${userId}`;
    const headers: Record<string, string> = {};

    // SEC-002: Add HMAC signature if gateway secret is configured
    if (config.gatewaySecret) {
      const { signature, timestamp } = generateRequestSignature('GET', path, null);
      headers['X-Gateway-Signature'] = signature;
      headers['X-Gateway-Timestamp'] = timestamp;
    } else {
      // Fallback to legacy header for backwards compatibility
      headers['X-Gateway-Request'] = 'true';
    }

    const response = await fetch(`${config.backendUrl}${path}`, { headers });

    if (!response.ok) {
      log.warn('Failed to fetch devices for user', { userId, status: response.status });
      return [];
    }

    return (await response.json()) as DeviceInfo[];
  } catch (err) {
    log.error('Error fetching devices', { error: (err as Error).message });
    return [];
  }
}

/**
 * Remove an invalid push token from the backend database
 *
 * Called when FCM/APNs reports that a device token is invalid (uninstalled app,
 * expired token, etc.). This cleans up the database to avoid repeatedly trying
 * to send to dead tokens.
 *
 * SEC-002: Uses HMAC signature for authentication.
 */
async function removeInvalidDevice(deviceId: string, token: string): Promise<void> {
  try {
    const path = `/api/v1/push/device/${deviceId}`;
    const headers: Record<string, string> = {};

    // SEC-002: Add HMAC signature if gateway secret is configured
    if (config.gatewaySecret) {
      const { signature, timestamp } = generateRequestSignature('DELETE', path, null);
      headers['X-Gateway-Signature'] = signature;
      headers['X-Gateway-Timestamp'] = timestamp;
    } else {
      // Fallback to legacy header for backwards compatibility
      headers['X-Gateway-Request'] = 'true';
    }

    const response = await fetch(`${config.backendUrl}${path}`, {
      method: 'DELETE',
      headers,
    });

    if (response.ok) {
      log.info('Removed invalid push token', {
        deviceId,
        token: token.slice(0, 10) + '...',
      });
    } else {
      log.warn('Failed to remove invalid token', {
        deviceId,
        status: response.status,
      });
    }
  } catch (err) {
    log.error('Error removing invalid token', {
      deviceId,
      error: (err as Error).message,
    });
  }
}

/**
 * Event types that should trigger push notifications
 */
const PUSH_EVENT_TYPES: BackendEventType[] = [
  'transaction',
  'confirmation',
  'broadcast_success',
  'broadcast_failed',
  'psbt_signing_required',
  'draft_created',
  'draft_approved',
];

/**
 * Handle incoming event from backend
 */
async function handleEvent(event: BackendEvent): Promise<void> {
  log.debug('Received backend event', { type: event.type, walletId: event.walletId });

  // Only handle events that should trigger push notifications
  if (!PUSH_EVENT_TYPES.includes(event.type)) {
    return;
  }

  // Need userId to know which devices to notify
  if (!event.userId) {
    log.warn('Event missing userId, cannot send push notification');
    return;
  }

  const devices = await getDevicesForUser(event.userId);
  if (devices.length === 0) {
    log.debug('No devices registered for user', { userId: event.userId });
    return;
  }

  // Format notification based on event type
  const notification = formatNotificationForEvent(event);
  if (!notification) {
    log.debug('Event does not require push notification', { event });
    return;
  }

  // Send push notifications
  const pushDevices = devices.map((d) => ({
    id: d.id,
    platform: d.platform,
    pushToken: d.pushToken,
  }));

  const result = await push.sendToDevices(pushDevices, notification);
  log.info('Push notifications sent', {
    userId: event.userId,
    eventType: event.type,
    success: result.success,
    failed: result.failed,
  });

  // Remove invalid tokens from database
  if (result.invalidTokens.length > 0) {
    log.warn('Invalid push tokens found', { count: result.invalidTokens.length });

    // Remove each invalid token from the backend database
    for (const invalidToken of result.invalidTokens) {
      await removeInvalidDevice(invalidToken.id, invalidToken.token);
    }
  }
}

/**
 * Format a push notification based on event type
 */
function formatNotificationForEvent(event: BackendEvent): push.PushNotification | null {
  const walletName = event.walletName || 'Wallet';

  switch (event.type) {
    case 'transaction':
      if (!event.data.type || !event.data.amount || !event.data.txid) return null;
      const txType = event.data.type === 'consolidation' ? 'sent' : event.data.type;
      return push.formatTransactionNotification(
        txType as 'received' | 'sent',
        walletName,
        event.data.amount,
        event.data.txid
      );

    case 'confirmation':
      // Only notify on first confirmation
      if (event.data.confirmations !== 1 || !event.data.txid) return null;
      return push.formatTransactionNotification(
        'confirmed',
        walletName,
        event.data.amount || 0,
        event.data.txid
      );

    case 'broadcast_success':
      if (!event.data.txid) return null;
      return push.formatBroadcastNotification(
        true,
        walletName,
        event.data.txid
      );

    case 'broadcast_failed':
      return push.formatBroadcastNotification(
        false,
        walletName,
        event.data.txid || '',
        event.data.error
      );

    case 'psbt_signing_required':
      if (!event.data.draftId || !event.data.amount) return null;
      return push.formatPsbtSigningNotification(
        walletName,
        event.data.draftId,
        event.data.creatorName || 'Someone',
        event.data.amount,
        event.data.requiredSignatures || 2,
        event.data.currentSignatures || 1
      );

    case 'draft_created':
      if (!event.data.draftId || !event.data.amount) return null;
      return push.formatDraftCreatedNotification(
        walletName,
        event.data.draftId,
        event.data.creatorName || 'Someone',
        event.data.amount
      );

    case 'draft_approved':
      if (!event.data.draftId) return null;
      return push.formatDraftApprovedNotification(
        walletName,
        event.data.draftId,
        event.data.signerName || 'Someone',
        event.data.currentSignatures || 0,
        event.data.requiredSignatures || 0
      );

    default:
      return null;
  }
}

/**
 * Connect to backend WebSocket
 *
 * SEC-001: Uses HMAC challenge-response authentication instead of JWT secret sharing.
 */
function connect(): void {
  if (isShuttingDown) return;

  // Check if gateway secret is configured
  if (!config.gatewaySecret) {
    log.error('GATEWAY_SECRET not configured, cannot connect to backend WebSocket');
    scheduleReconnect();
    return;
  }

  const wsUrl = `${config.backendWsUrl}/gateway`;
  log.info('Connecting to backend WebSocket', { url: wsUrl });

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    log.info('Connected to backend WebSocket, waiting for auth challenge');
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // SEC-001: Handle HMAC challenge-response authentication
      if (message.type === 'auth_challenge') {
        const challenge = message.challenge;
        if (!challenge) {
          log.error('Received auth_challenge without challenge data');
          return;
        }

        // Generate HMAC response
        const response = createHmac('sha256', config.gatewaySecret)
          .update(challenge)
          .digest('hex');

        ws?.send(JSON.stringify({
          type: 'auth_response',
          response,
        }));

        log.debug('Sent auth response to backend');
        return;
      }

      if (message.type === 'auth_success') {
        log.info('Gateway authenticated with backend (HMAC challenge-response)');
        return;
      }

      if (message.type === 'event') {
        handleEvent(message.event as BackendEvent);
      }
    } catch (err) {
      log.error('Error parsing WebSocket message', { error: (err as Error).message });
    }
  });

  ws.on('close', (code, reason) => {
    log.warn('Backend WebSocket closed', { code, reason: reason.toString() });
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log.error('Backend WebSocket error', { error: err.message });
  });
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect(): void {
  if (isShuttingDown || reconnectTimer) return;

  log.info(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY);
}

/**
 * Start the backend events service
 */
export function startBackendEvents(): void {
  isShuttingDown = false;
  connect();
}

/**
 * Stop the backend events service
 */
export function stopBackendEvents(): void {
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  log.info('Backend events service stopped');
}
