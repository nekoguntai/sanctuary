import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_AUTH_TIMEOUT_MS } from '../../../src/websocket/types';

const mocks = vi.hoisted(() => {
  class MockWebSocketServer {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    close = vi.fn();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler;
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers[event]?.(...args);
      return true;
    }

    handleUpgrade(_req: unknown, socket: unknown, _head: Buffer, cb: (ws: unknown) => void) {
      cb(socket);
    }
  }

  return {
    createdServers: [] as MockWebSocketServer[],
    MockWebSocketServer,
    config: { gatewaySecret: 'gateway-secret' },
    websocketConnectionsInc: vi.fn(),
    websocketConnectionsDec: vi.fn(),
    websocketMessagesInc: vi.fn(),
  };
});

vi.mock('ws', () => {
  function WebSocketServer() {
    const server = new mocks.MockWebSocketServer();
    mocks.createdServers.push(server);
    return server;
  }

  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer,
  };
});

vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: mocks.config,
}));

vi.mock('../../../src/observability/metrics', () => ({
  websocketConnections: {
    inc: mocks.websocketConnectionsInc,
    dec: mocks.websocketConnectionsDec,
  },
  websocketMessagesTotal: {
    inc: mocks.websocketMessagesInc,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { GatewayWebSocketServer } from '../../../src/websocket/gatewayServer';

type TestGatewayClient = {
  isAuthenticated: boolean;
  challenge?: string;
  authTimeout?: NodeJS.Timeout;
  readyState: number;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function createClient(): TestGatewayClient {
  const handlers: Record<string, (...args: unknown[]) => void> = {};

  return {
    isAuthenticated: false,
    readyState: 1,
    on: (event, cb) => {
      handlers[event] = cb;
    },
    send: vi.fn(),
    close: vi.fn(),
    emit: (event, ...args) => {
      handlers[event]?.(...args);
    },
  };
}

describe('GatewayWebSocketServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.config.gatewaySecret = 'gateway-secret';
    mocks.createdServers.length = 0;
  });

  it('rejects connections when gateway secret is not configured', () => {
    mocks.config.gatewaySecret = '';
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);

    expect(client.close).toHaveBeenCalledWith(4003, 'Gateway authentication not configured');
  });

  it('sends auth challenge and authenticates valid response', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);

    const challengeMessage = client.send.mock.calls[0]?.[0];
    const parsedChallenge = JSON.parse(challengeMessage);
    expect(parsedChallenge.type).toBe('auth_challenge');
    expect(parsedChallenge.challenge).toBeTypeOf('string');

    const response = createHmac('sha256', 'gateway-secret')
      .update(parsedChallenge.challenge)
      .digest('hex');

    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response,
    })));

    const authSuccessMessage = client.send.mock.calls[1]?.[0];
    expect(JSON.parse(authSuccessMessage)).toEqual({ type: 'auth_success' });
    expect(server.isGatewayConnected()).toBe(true);
    expect(mocks.websocketConnectionsInc).toHaveBeenCalledWith({ type: 'gateway' });
  });

  it('rejects invalid authentication response', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: '00'.repeat(32),
    })));

    expect(client.close).toHaveBeenCalledWith(4003, 'Authentication failed');
    expect(server.isGatewayConnected()).toBe(false);
  });

  it('rejects non-auth messages before authentication', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));

    expect(client.close).toHaveBeenCalledWith(4002, 'Authentication required');
  });

  it('closes unauthenticated clients after auth timeout', async () => {
    vi.useFakeTimers();
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    await vi.advanceTimersByTimeAsync(GATEWAY_AUTH_TIMEOUT_MS + 1);

    expect(client.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('ignores invalid gateway message payloads', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from('not-json'));

    expect(client.close).not.toHaveBeenCalledWith(4002, 'Authentication required');
  });

  it('replaces existing authenticated gateway with newer connection', () => {
    const server = new GatewayWebSocketServer();
    const first = createClient();
    const second = createClient();

    (server as any).handleConnection(first, {} as any);
    const firstChallenge = JSON.parse(first.send.mock.calls[0][0]).challenge;
    first.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(firstChallenge).digest('hex'),
    })));

    (server as any).handleConnection(second, {} as any);
    const secondChallenge = JSON.parse(second.send.mock.calls[0][0]).challenge;
    second.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(secondChallenge).digest('hex'),
    })));

    expect(first.close).toHaveBeenCalledWith(1000, 'Replaced by new connection');
    expect(mocks.websocketConnectionsDec).toHaveBeenCalledWith({ type: 'gateway' });
    expect(server.isGatewayConnected()).toBe(true);
  });

  it('sends events only when an authenticated gateway is available', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    server.sendEvent({ type: 'transaction', data: { txid: 'abc' } } as any);
    expect(client.send).not.toHaveBeenCalled();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    server.sendEvent({ type: 'transaction', data: { txid: 'abc' } } as any);

    const payload = JSON.parse(client.send.mock.calls[2][0]);
    expect(payload).toEqual({
      type: 'event',
      event: { type: 'transaction', data: { txid: 'abc' } },
    });
  });

  it('closes active gateway and websocket server on shutdown', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    server.close();

    const wsServer = mocks.createdServers[mocks.createdServers.length - 1];
    expect(client.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(wsServer.close).toHaveBeenCalledTimes(1);
  });
});
