import { createHmac } from 'crypto';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketTestServer } from '../setup/websocketHarness';
import { verifyToken } from '../../../src/utils/jwt';
import { checkWalletAccess } from '../../../src/services/wallet';

vi.mock('../../../src/utils/jwt', () => ({
  verifyToken: vi.fn(async (token: string) => ({ userId: token === 'good-token' ? 'user-1' : 'user-2' })),
}));

vi.mock('../../../src/services/wallet', () => ({
  checkWalletAccess: vi.fn(async () => true),
}));

vi.mock('../../../src/observability/metrics', () => ({
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
  websocketRateLimitHits: { inc: vi.fn() },
  websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
  websocketConnectionDuration: { observe: vi.fn() },
}));

vi.mock('../../../src/config', () => ({
  default: { gatewaySecret: 'test-secret' },
}));

const waitForJsonMessage = (socket: WebSocket, predicate?: (msg: any) => boolean) =>
  new Promise<any>((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (!predicate || predicate(parsed)) {
          cleanup();
          resolve(parsed);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });

const waitForClose = (socket: WebSocket) =>
  new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
  });

const shouldRunWebSocketIntegration = process.env.RUN_WS_INTEGRATION === 'true';

const describeWebSocket = shouldRunWebSocketIntegration ? describe : describe.skip;

describeWebSocket('websocket integration', () => {
  afterEach(() => {
    (verifyToken as ReturnType<typeof vi.fn>).mockClear();
    (checkWalletAccess as ReturnType<typeof vi.fn>).mockClear();
  });

  it('authenticates via auth message', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer();
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const client = await harness.connectClient();

    const connected = await waitForJsonMessage(client, (msg) => msg.type === 'connected');
    expect(connected.data.authenticated).toBe(false);

    client.send(JSON.stringify({ type: 'auth', data: { token: 'good-token' } }));
    const authenticated = await waitForJsonMessage(client, (msg) => msg.type === 'authenticated');

    expect(authenticated.data.success).toBe(true);
    expect(authenticated.data.userId).toBe('user-1');
    expect(verifyToken).toHaveBeenCalledWith('good-token');

    client.close();
    await waitForClose(client);
    await harness.close();
  });

  it('rejects wallet subscription without authentication', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer();
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const client = await harness.connectClient();

    await waitForJsonMessage(client, (msg) => msg.type === 'connected');

    client.send(JSON.stringify({ type: 'subscribe', data: { channel: 'wallet:abc' } }));
    const error = await waitForJsonMessage(client, (msg) => msg.type === 'error');

    expect(error.data.message).toBe('Authentication required for wallet subscriptions');

    client.close();
    await waitForClose(client);
    await harness.close();
  });

  it('authenticates gateway connection via challenge response', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer({ enableGateway: true });
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const gateway = await harness.connectGateway();

    const challengeMsg = await waitForJsonMessage(gateway, (msg) => msg.type === 'auth_challenge');
    const response = createHmac('sha256', 'test-secret')
      .update(challengeMsg.challenge)
      .digest('hex');

    gateway.send(JSON.stringify({ type: 'auth_response', response }));
    const success = await waitForJsonMessage(gateway, (msg) => msg.type === 'auth_success');

    expect(success.type).toBe('auth_success');

    gateway.close();
    await waitForClose(gateway);
    await harness.close();
  });
});
