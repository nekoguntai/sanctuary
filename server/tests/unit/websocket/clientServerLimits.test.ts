import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

const mockCheckWalletAccess = vi.fn(async () => true);

vi.mock('../../../src/services/wallet', () => ({
  checkWalletAccess: mockCheckWalletAccess,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/observability/metrics', () => ({
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
  websocketRateLimitHits: { inc: vi.fn() },
  websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
  websocketConnectionDuration: { observe: vi.fn() },
}));

const loadServer = async () => {
  vi.resetModules();
  const mod = await import('../../../src/websocket/clientServer');
  return mod.SanctauryWebSocketServer;
};

const createClient = (overrides: Record<string, unknown> = {}) => ({
  userId: undefined as string | undefined,
  subscriptions: new Set<string>(),
  isAlive: true,
  messageCount: 0,
  lastMessageReset: Date.now() - 2000,
  connectionTime: Date.now() - 6000,
  totalMessageCount: 0,
  messageQueue: [] as string[],
  isProcessingQueue: false,
  droppedMessages: 0,
  readyState: WebSocket.OPEN,
  send: vi.fn(),
  close: vi.fn(),
  ...overrides,
});

const parseLastSend = (client: { send: ReturnType<typeof vi.fn> }) => {
  const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1];
  return JSON.parse(lastCall[0]);
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('SanctauryWebSocketServer limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MAX_WS_MESSAGES_PER_SECOND = '2';
    process.env.MAX_WS_SUBSCRIPTIONS = '10';
  });

  it('closes connection when per-second rate limit is exceeded', async () => {
    process.env.MAX_WS_MESSAGES_PER_SECOND = '1';
    const Server = await loadServer();
    const server = new Server();
    const client = createClient({
      messageCount: 1,
      lastMessageReset: Date.now(),
      connectionTime: Date.now() - 6000,
    });

    await (server as any).handleMessage(
      client,
      Buffer.from(JSON.stringify({ type: 'ping' }))
    );

    expect(client.send).toHaveBeenCalled();
    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(client.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    expect(client.closeReason).toBe('rate_limit');
  });

  it('batch subscribe rejects wallet channels without auth', async () => {
    const Server = await loadServer();
    const server = new Server();
    const client = createClient();

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'subscribe_batch',
          data: { channels: ['wallet:abc123', 'system', 'wallet:def456'] },
        })
      )
    );

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['system']);
    expect(payload.data.errors).toEqual([
      { channel: 'wallet:abc123', reason: 'Authentication required' },
      { channel: 'wallet:def456', reason: 'Authentication required' },
    ]);
  });

  it('batch subscribe reports access denied and keeps duplicates', async () => {
    const Server = await loadServer();
    const server = new Server();
    const client = createClient({ userId: 'user-1' });

    mockCheckWalletAccess.mockImplementation(async (walletId: string) => walletId !== 'deadbeef');

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'subscribe_batch',
          data: { channels: ['wallet:deadbeef', 'wallet:cafebabe', 'wallet:cafebabe'] },
        })
      )
    );
    await flushMicrotasks();

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['wallet:cafebabe', 'wallet:cafebabe']);
    expect(payload.data.errors).toEqual([{ channel: 'wallet:deadbeef', reason: 'Access denied' }]);
  });

  it('drops oldest message when queue is full and policy is drop_oldest', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_oldest';
    const Server = await loadServer();
    const server = new Server();
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(true);
    expect(client.droppedMessages).toBe(1);
    expect(client.messageQueue).toHaveLength(0);
    expect(client.send).toHaveBeenCalled();
  });

  it('rejects newest message when queue is full and policy is drop_newest', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_newest';
    const Server = await loadServer();
    const server = new Server();
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(false);
    expect(client.droppedMessages).toBe(1);
    expect(client.messageQueue).toHaveLength(1);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('disconnects client when queue is full and policy is disconnect', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'disconnect';
    const Server = await loadServer();
    const server = new Server();
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(false);
    expect(client.closeReason).toBe('queue_overflow');
    expect(client.close).toHaveBeenCalledWith(4009, 'Message queue overflow');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('batch unsubscribe removes subscriptions and replies with list', async () => {
    const Server = await loadServer();
    const server = new Server();
    const client = createClient();

    client.subscriptions.add('wallet:abc');
    client.subscriptions.add('system');
    (server as any).subscriptions.set('wallet:abc', new Set([client]));
    (server as any).subscriptions.set('system', new Set([client]));

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'unsubscribe_batch',
          data: { channels: ['wallet:abc', 'system', 'missing'] },
        })
      )
    );

    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed_batch');
    expect(payload.data.unsubscribed).toEqual(['wallet:abc', 'system']);
    expect(client.subscriptions.size).toBe(0);
    expect((server as any).subscriptions.has('wallet:abc')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
  });
});
