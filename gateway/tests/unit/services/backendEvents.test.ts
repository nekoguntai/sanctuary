/**
 * Backend Events Service Tests
 *
 * Tests the WebSocket-based backend events service that handles
 * real-time transaction events and push notifications.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Hoist state for tracking WebSocket instances
const { wsInstances, wsConstructorSpy } = vi.hoisted(() => {
  const wsInstances: any[] = [];
  const wsConstructorSpy = vi.fn();
  return { wsInstances, wsConstructorSpy };
});

// Mock ws module with a proper class constructor
vi.mock('ws', () => {
  return {
    default: class WebSocket extends EventEmitter {
      static instances = wsInstances;
      readyState = 1;
      send = vi.fn();
      close = vi.fn();

      constructor(url?: string) {
        super();
        wsConstructorSpy(url);
        wsInstances.push(this);
      }

      simulateMessage(data: object): void {
        this.emit('message', JSON.stringify(data));
      }

      simulateOpen(): void {
        this.emit('open');
      }

      simulateClose(code = 1000, reason = ''): void {
        this.emit('close', code, Buffer.from(reason));
      }

      simulateError(error: Error): void {
        this.emit('error', error);
      }
    },
  };
});

vi.mock('../../../src/config', () => ({
  config: {
    gatewaySecret: 'test-gateway-secret',
    backendUrl: 'http://localhost:3000',
    backendWsUrl: 'ws://localhost:3000',
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock push service
vi.mock('../../../src/services/push', () => ({
  formatTransactionNotification: vi.fn((type, walletName, amount, txid) => ({
    title: `Bitcoin ${type === 'received' ? 'Received' : type === 'sent' ? 'Sent' : 'Confirmed'}`,
    body: `${walletName}: ${amount} sats`,
    data: { type: type === 'confirmed' ? 'confirmation' : 'transaction', txid },
  })),
  sendToDevices: vi.fn().mockResolvedValue({
    success: 1,
    failed: 0,
    invalidTokens: [],
  }),
}));

// Import after mocks
import {
  startBackendEvents,
  stopBackendEvents,
} from '../../../src/services/backendEvents';
import * as push from '../../../src/services/push';

describe('Backend Events Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsInstances.length = 0; // Clear instances array
    mockFetch.mockReset();
  });

  afterEach(() => {
    stopBackendEvents();
    vi.useRealTimers();
  });

  describe('startBackendEvents', () => {
    it('should create WebSocket connection to backend', () => {
      startBackendEvents();

      expect(wsConstructorSpy).toHaveBeenCalledWith('ws://localhost:3000/gateway');
    });

    it('should set up event handlers on WebSocket', () => {
      startBackendEvents();

      const ws = wsInstances[0];
      expect(ws.listenerCount('open')).toBe(1);
      expect(ws.listenerCount('message')).toBe(1);
      expect(ws.listenerCount('close')).toBe(1);
      expect(ws.listenerCount('error')).toBe(1);
    });
  });

  describe('stopBackendEvents', () => {
    it('should close WebSocket connection', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      stopBackendEvents();

      expect(ws.close).toHaveBeenCalled();
    });

    it('should clear reconnect timer', () => {
      startBackendEvents();

      // Trigger close to start reconnect timer
      const ws = wsInstances[0];
      ws.simulateClose();

      // Stop before reconnect
      stopBackendEvents();

      // Advance past reconnect delay
      vi.advanceTimersByTime(10000);

      // Should not have created another connection
      expect(wsInstances.length).toBe(1);
    });
  });

  describe('HMAC authentication', () => {
    it('should respond to auth_challenge with HMAC signature', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      // Simulate auth challenge from backend
      ws.simulateMessage({
        type: 'auth_challenge',
        challenge: 'test-challenge-123',
      });

      // Should send auth_response
      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentData.type).toBe('auth_response');
      expect(sentData.response).toBeDefined();
      expect(typeof sentData.response).toBe('string');
      expect(sentData.response.length).toBe(64); // SHA256 hex length
    });

    it('should handle auth_success message', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      // Should not throw
      ws.simulateMessage({ type: 'auth_success' });
    });

    it('should handle auth_challenge without challenge data', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      // Malformed challenge
      ws.simulateMessage({ type: 'auth_challenge' });

      // Should not send response
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'device-1',
              platform: 'android',
              pushToken: 'fcm-token',
              userId: 'user-123',
            },
          ]),
      });
    });

    it('should handle transaction event and send push notification', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      // Simulate transaction event
      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-123',
          data: {
            txid: 'abc123',
            type: 'received',
            amount: 50000,
          },
        },
      });

      // Allow async operations
      await vi.runAllTimersAsync();

      // Should fetch devices
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/push/by-user/user-123'),
        expect.any(Object)
      );

      // Should send push notification
      expect(push.sendToDevices).toHaveBeenCalled();
    });

    it('should handle confirmation event on first confirmation', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'confirmation',
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-123',
          data: {
            txid: 'abc123',
            confirmations: 1,
            amount: 50000,
          },
        },
      });

      await vi.runAllTimersAsync();

      expect(push.sendToDevices).toHaveBeenCalled();
    });

    it('should not send notification for subsequent confirmations', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'confirmation',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: {
            txid: 'abc123',
            confirmations: 2, // Not first confirmation
          },
        },
      });

      await vi.runAllTimersAsync();

      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should not send notification for events without userId', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          // Missing userId
          data: {
            txid: 'abc123',
            type: 'received',
            amount: 50000,
          },
        },
      });

      await vi.runAllTimersAsync();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should ignore balance and sync events', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'balance',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: {},
        },
      });

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'sync',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: {},
        },
      });

      await vi.runAllTimersAsync();

      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should not send notification when user has no devices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: {
            txid: 'abc123',
            type: 'received',
            amount: 50000,
          },
        },
      });

      await vi.runAllTimersAsync();

      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should handle consolidation transactions as sent', async () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Test',
          userId: 'user-123',
          data: {
            txid: 'abc123',
            type: 'consolidation',
            amount: 50000,
          },
        },
      });

      await vi.runAllTimersAsync();

      expect(push.formatTransactionNotification).toHaveBeenCalledWith(
        'sent',
        'Test',
        50000,
        'abc123'
      );
    });
  });

  describe('invalid token handling', () => {
    it('should remove invalid tokens from backend', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'device-1', platform: 'android', pushToken: 'invalid-token', userId: 'user-123' },
          ]),
      });

      vi.mocked(push.sendToDevices).mockResolvedValueOnce({
        success: 0,
        failed: 1,
        invalidTokens: [{ id: 'device-1', token: 'invalid-token' }],
      });

      // Mock the DELETE request for removing invalid token
      mockFetch.mockResolvedValueOnce({ ok: true });

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Test',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 50000 },
        },
      });

      await vi.runAllTimersAsync();

      // Should have called DELETE to remove invalid device
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/push/device/device-1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('reconnection', () => {
    it('should schedule reconnection after connection close', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateClose(1000, 'Normal closure');

      // Should schedule reconnect in 5 seconds
      expect(wsInstances.length).toBe(1);

      // Advance past reconnect delay
      vi.advanceTimersByTime(5000);

      // New connection should be created
      expect(wsInstances.length).toBe(2);
    });

    it('should not reconnect when shutting down', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      stopBackendEvents();
      ws.simulateClose();

      vi.advanceTimersByTime(10000);

      // Should not create new connection
      expect(wsInstances.length).toBe(1);
    });

    it('should handle WebSocket errors gracefully', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      // Should not throw
      ws.simulateError(new Error('Connection failed'));

      // Connection should still be tracked
      expect(wsInstances.length).toBe(1);
    });
  });

  describe('message parsing', () => {
    it('should handle invalid JSON messages', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      // Send invalid JSON
      ws.emit('message', 'not valid json');

      // Should not throw
    });

    it('should handle unknown message types', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({ type: 'unknown_type', data: {} });

      // Should not throw
    });
  });

  describe('HMAC request signatures', () => {
    it('should include HMAC signature headers when fetching devices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'abc', type: 'received', amount: 1000 },
        },
      });

      await vi.runAllTimersAsync();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Gateway-Signature': expect.any(String),
            'X-Gateway-Timestamp': expect.any(String),
          }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle fetch errors when getting devices', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'abc', type: 'received', amount: 1000 },
        },
      });

      await vi.runAllTimersAsync();

      // Should not throw, notification not sent
      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should handle non-ok response when fetching devices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'abc', type: 'received', amount: 1000 },
        },
      });

      await vi.runAllTimersAsync();

      // Should not throw, notification not sent
      expect(push.sendToDevices).not.toHaveBeenCalled();
    });

    it('should handle failed invalid token removal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'device-1', platform: 'android', pushToken: 'token', userId: 'user-123' },
          ]),
      });

      vi.mocked(push.sendToDevices).mockResolvedValueOnce({
        success: 0,
        failed: 1,
        invalidTokens: [{ id: 'device-1', token: 'token' }],
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Test',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 50000 },
        },
      });

      await vi.runAllTimersAsync();

      // Should not throw
    });
  });
});

