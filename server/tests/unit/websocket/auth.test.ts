import { IncomingMessage } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedWebSocket } from '../../../src/websocket/types';

const mockVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('../../../src/utils/jwt', () => ({
  TokenAudience: {
    ACCESS: 'sanctuary:access',
  },
  verifyToken: mockVerifyToken,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { authenticateOnUpgrade, handleAuthMessage } from '../../../src/websocket/auth';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

function createClient(): AuthenticatedWebSocket {
  return {
    close: vi.fn(),
    subscriptions: new Set<string>(),
    isAlive: true,
    messageCount: 0,
    lastMessageReset: Date.now(),
    connectionTime: Date.now(),
    totalMessageCount: 0,
    messageQueue: [],
    isProcessingQueue: false,
    droppedMessages: 0,
  } as unknown as AuthenticatedWebSocket;
}

function createRequest(token = 'access-token'): IncomingMessage {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      host: 'localhost',
    },
    url: '/ws',
    socket: {
      remoteAddress: '127.0.0.1',
    },
  } as IncomingMessage;
}

function createCallbacks() {
  return {
    trackUserConnection: vi.fn(),
    getUserConnections: vi.fn(),
    completeClientRegistration: vi.fn(),
    sendToClient: vi.fn(() => true),
  };
}

describe('websocket auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    });
  });

  it('verifies upgrade tokens with the access-token audience', async () => {
    const client = createClient();
    const callbacks = createCallbacks();

    const isAsync = authenticateOnUpgrade(client, createRequest(), callbacks);
    await flushMicrotasks();

    expect(isAsync).toBe(true);
    expect(mockVerifyToken).toHaveBeenCalledWith('access-token', 'sanctuary:access');
    expect(callbacks.trackUserConnection).toHaveBeenCalledWith('user-1', client);
    expect(callbacks.completeClientRegistration).toHaveBeenCalledWith(client);
  });

  it('rejects pending 2FA tokens during upgrade authentication', async () => {
    mockVerifyToken.mockResolvedValueOnce({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      pending2FA: true,
    });
    const client = createClient();
    const callbacks = createCallbacks();

    authenticateOnUpgrade(client, createRequest('two-factor-token'), callbacks);
    await flushMicrotasks();

    expect(mockVerifyToken).toHaveBeenCalledWith('two-factor-token', 'sanctuary:access');
    expect(client.close).toHaveBeenCalledWith(1008, 'Authentication failed');
    expect(callbacks.completeClientRegistration).not.toHaveBeenCalled();
  });

  it('verifies auth-message tokens with the access-token audience', async () => {
    const client = createClient();
    const callbacks = createCallbacks();

    await handleAuthMessage(client, { token: 'message-token' }, callbacks);

    expect(mockVerifyToken).toHaveBeenCalledWith('message-token', 'sanctuary:access');
    expect(client.userId).toBe('user-1');
    expect(callbacks.sendToClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ type: 'authenticated' })
    );
  });

  it('rejects pending 2FA tokens during auth-message authentication', async () => {
    mockVerifyToken.mockResolvedValueOnce({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      pending2FA: true,
    });
    const client = createClient();
    const callbacks = createCallbacks();

    await handleAuthMessage(client, { token: 'two-factor-token' }, callbacks);

    expect(mockVerifyToken).toHaveBeenCalledWith('two-factor-token', 'sanctuary:access');
    expect(client.userId).toBeUndefined();
    expect(callbacks.sendToClient).toHaveBeenCalledWith(
      client,
      {
        type: 'error',
        data: { message: 'Authentication failed' },
      }
    );
  });
});
