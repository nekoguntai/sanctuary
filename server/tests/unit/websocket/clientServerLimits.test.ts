import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

const mockCheckWalletAccess = vi.fn(async () => ({ hasAccess: true, canEdit: true, role: 'owner' }));
const mockVerifyToken = vi.fn(async () => ({ userId: 'user-1' }));
const mockPublishBroadcast = vi.fn();

const metricMocks = {
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
  websocketRateLimitHits: { inc: vi.fn() },
  websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
  websocketConnectionDuration: { observe: vi.fn() },
};

vi.mock('../../../src/services/accessControl', () => ({
  checkWalletAccess: mockCheckWalletAccess,
}));

vi.mock('../../../src/utils/jwt', () => ({
  verifyToken: mockVerifyToken,
}));

vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    publishBroadcast: mockPublishBroadcast,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/observability/metrics', () => metricMocks);

const loadModule = async () => {
  vi.resetModules();
  return import('../../../src/websocket/clientServer');
};

const loadServer = async () => (await loadModule()).SanctauryWebSocketServer;

const createClient = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  const client: any = {
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
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  };

  client.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const list = handlers.get(event) || [];
    list.push(callback);
    handlers.set(event, list);
    return client;
  });

  client.once = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const wrapper = (...args: any[]) => {
      callback(...args);
      const list = handlers.get(event) || [];
      handlers.set(event, list.filter(fn => fn !== wrapper));
    };
    const list = handlers.get(event) || [];
    list.push(wrapper);
    handlers.set(event, list);
    return client;
  });

  client.emit = (event: string, ...args: any[]) => {
    for (const cb of handlers.get(event) || []) {
      cb(...args);
    }
  };

  return Object.assign(client, overrides);
};

const parseLastSend = (client: { send: ReturnType<typeof vi.fn> }) => {
  const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1];
  return JSON.parse(lastCall[0]);
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
const activeServers: Array<{ close: () => void }> = [];

const createRequest = (overrides: Record<string, unknown> = {}) => ({
  headers: { host: 'localhost' } as Record<string, string>,
  url: '/ws',
  socket: { remoteAddress: '127.0.0.1' },
  ...overrides,
});

describe('SanctauryWebSocketServer limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MAX_WS_MESSAGES_PER_SECOND = '2';
    process.env.MAX_WS_SUBSCRIPTIONS = '10';
    process.env.MAX_WEBSOCKET_CONNECTIONS = '10000';
    process.env.MAX_WEBSOCKET_PER_USER = '10';
    process.env.WS_GRACE_PERIOD_LIMIT = '500';
    process.env.WS_MAX_QUEUE_SIZE = '100';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_oldest';
    mockCheckWalletAccess.mockResolvedValue({ hasAccess: true, canEdit: true, role: 'owner' });
    mockVerifyToken.mockResolvedValue({ userId: 'user-1' });
  });

  afterEach(() => {
    for (const server of activeServers.splice(0)) {
      server.close();
    }
    vi.useRealTimers();
  });

  it('closes connection when per-second rate limit is exceeded', async () => {
    process.env.MAX_WS_MESSAGES_PER_SECOND = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
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
    activeServers.push(server);
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
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    mockCheckWalletAccess.mockImplementation(
      async (walletId: string) => ({ hasAccess: walletId !== 'deadbeef', canEdit: true, role: 'owner' })
    );

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
    activeServers.push(server);
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
    activeServers.push(server);
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
    activeServers.push(server);
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
    activeServers.push(server);
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

  it('enforces grace period message limit', async () => {
    process.env.WS_GRACE_PERIOD_LIMIT = '1';
    const mod = await loadModule();
    const server = new mod.SanctauryWebSocketServer();
    activeServers.push(server);
    const client = createClient({
      connectionTime: Date.now(),
      totalMessageCount: 1,
    });

    await (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'ping' })));

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(client.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    expect(mod.getRateLimitEvents()[0]?.reason).toBe('grace_period_exceeded');
  });

  it('extracts auth token from header first, then query parameter', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    const fromHeader = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer header-token' } })
    );
    const fromQuery = (server as any).extractToken(
      createRequest({ url: '/ws?token=query-token' })
    );
    const none = (server as any).extractToken(createRequest());

    expect(fromHeader).toBe('header-token');
    expect(fromQuery).toBe('query-token');
    expect(none).toBeNull();
  });

  it('registers authenticated connection when token is provided on upgrade', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer test-token' } })
    );
    await flushMicrotasks();

    expect(client.userId).toBe('user-1');
    expect((server as any).clients.has(client)).toBe(true);
    const payload = parseLastSend(client);
    expect(payload.type).toBe('connected');
    expect(payload.data.authenticated).toBe(true);
  });

  it('rejects new connection when total connection limit is reached', async () => {
    process.env.MAX_WEBSOCKET_CONNECTIONS = '0';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());

    expect(client.close).toHaveBeenCalledWith(1008, 'Server connection limit reached');
  });

  it('times out unauthenticated connections', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());
    vi.advanceTimersByTime(30000);

    expect(client.closeReason).toBe('auth_timeout');
    expect(client.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('returns already-authenticated response when auth is retried', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'existing-user' });

    await (server as any).handleAuth(client, { token: 'ignored' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('authenticated');
    expect(payload.data.message).toBe('Already authenticated');
  });

  it('sends auth error when token verification fails', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleAuth(client, { token: 'bad-token' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('Authentication failed');
  });

  it('enforces single subscribe limit and rejects extra subscriptions', async () => {
    process.env.MAX_WS_SUBSCRIPTIONS = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.subscriptions.add('system');

    await (server as any).handleSubscribe(client, { channel: 'mempool' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
  });

  it('rejects wallet subscription when access control denies user', async () => {
    mockCheckWalletAccess.mockResolvedValueOnce({ hasAccess: false, canEdit: false, role: 'viewer' });
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    await (server as any).handleSubscribe(client, { channel: 'wallet:deadbeef' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('Access denied to this wallet');
  });

  it('subscribes and unsubscribes a regular channel', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleSubscribe(client, { channel: 'system' });
    expect(client.subscriptions.has('system')).toBe(true);
    expect((server as any).subscriptions.get('system')?.has(client)).toBe(true);

    (server as any).handleUnsubscribe(client, { channel: 'system' });
    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed');
    expect(client.subscriptions.has('system')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
  });

  it('re-queues when socket buffer is full and resumes on drain', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      bufferedAmount: 70000,
      messageQueue: [JSON.stringify({ type: 'queued' })],
      isProcessingQueue: false,
    });

    (server as any).processClientQueue(client);

    expect(client.send).not.toHaveBeenCalled();
    expect(client.once).toHaveBeenCalledWith('drain', expect.any(Function));
    expect(client.messageQueue).toHaveLength(1);

    client.bufferedAmount = 0;
    client.emit('drain');
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'queued' }));
  });

  it('broadcasts events locally and publishes to redis bridge', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    server.broadcast({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'w1',
    });

    expect(mockPublishBroadcast).toHaveBeenCalledWith({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'w1',
    });
    const payload = parseLastSend(client);
    expect(payload.type).toBe('event');
    expect(payload.channel).toBe('wallet:w1');
    expect(payload.event).toBe('transaction');
  });

  it('reports aggregate stats including queue data', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    const clientA = createClient({
      userId: 'u1',
      messageQueue: ['a', 'b'],
      droppedMessages: 2,
    });
    clientA.subscriptions.add('system');
    const clientB = createClient({
      userId: 'u2',
      messageQueue: ['c'],
      droppedMessages: 1,
    });
    clientB.subscriptions.add('wallet:w1');

    (server as any).clients.add(clientA);
    (server as any).clients.add(clientB);
    (server as any).connectionsPerUser.set('u1', new Set([clientA]));
    (server as any).connectionsPerUser.set('u2', new Set([clientB]));
    (server as any).subscriptions.set('system', new Set([clientA]));
    (server as any).subscriptions.set('wallet:w1', new Set([clientB]));

    const stats = server.getStats();

    expect(stats.clients).toBe(2);
    expect(stats.subscriptions).toBe(2);
    expect(stats.channels).toBe(2);
    expect(stats.uniqueUsers).toBe(2);
    expect(stats.messageQueue.totalQueuedMessages).toBe(3);
    expect(stats.messageQueue.maxClientQueueSize).toBe(2);
    expect(stats.messageQueue.totalDroppedMessages).toBe(3);
  });

  it('cleans up user/subscriptions on disconnect and records metrics', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'user-1',
      connectionTime: Date.now() - 5000,
      closeReason: 'error',
    });
    client.subscriptions.add('system');
    client.subscriptions.add('wallet:abc');

    (server as any).clients.add(client);
    (server as any).connectionsPerUser.set('user-1', new Set([client]));
    (server as any).subscriptions.set('system', new Set([client]));
    (server as any).subscriptions.set('wallet:abc', new Set([client]));

    (server as any).handleDisconnect(client);

    expect((server as any).clients.size).toBe(0);
    expect((server as any).connectionsPerUser.has('user-1')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
    expect((server as any).subscriptions.has('wallet:abc')).toBe(false);
    expect(metricMocks.websocketConnections.dec).toHaveBeenCalledWith({ type: 'main' });
    expect(metricMocks.websocketSubscriptions.dec).toHaveBeenCalledWith(2);
    expect(metricMocks.websocketConnectionDuration.observe).toHaveBeenCalledWith(
      { close_reason: 'error' },
      expect.any(Number)
    );
  });

  it('closes all client sockets and the server instance', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const clientA = createClient();
    const clientB = createClient();
    (server as any).clients.add(clientA);
    (server as any).clients.add(clientB);
    const wssCloseSpy = vi.spyOn((server as any).wss, 'close');

    server.close();

    expect(clientA.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(clientB.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(wssCloseSpy).toHaveBeenCalled();
  });
});
