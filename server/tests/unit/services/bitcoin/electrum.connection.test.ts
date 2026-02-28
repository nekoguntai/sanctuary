import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const {
  netConnectMock,
  tlsConnectMock,
  socksCreateConnectionMock,
  nodeConfigFindFirstMock,
} = vi.hoisted(() => ({
  netConnectMock: vi.fn(),
  tlsConnectMock: vi.fn(),
  socksCreateConnectionMock: vi.fn(),
  nodeConfigFindFirstMock: vi.fn(),
}));

vi.mock('net', () => ({
  default: { connect: netConnectMock },
  connect: netConnectMock,
}));

vi.mock('tls', () => ({
  default: { connect: tlsConnectMock },
  connect: tlsConnectMock,
}));

vi.mock('socks', () => ({
  SocksClient: {
    createConnection: socksCreateConnectionMock,
  },
}));

vi.mock('../../../../src/config', () => ({
  __esModule: true,
  default: {
    bitcoin: {
      electrum: {
        host: 'fallback-host',
        port: 50001,
        protocol: 'tcp',
      },
    },
  },
  getConfig: () => ({
    electrumClient: {
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 60,
      connectionTimeoutMs: 30,
      torTimeoutMultiplier: 3,
    },
  }),
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: {
    nodeConfig: {
      findFirst: nodeConfigFindFirstMock,
    },
    electrumServer: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ElectrumClient } from '../../../../src/services/bitcoin/electrum';

class FakeSocket extends EventEmitter {
  write = vi.fn();
  destroy = vi.fn();
  setNoDelay = vi.fn();
  setKeepAlive = vi.fn();
}

describe('ElectrumClient connection and transport internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nodeConfigFindFirstMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects via direct TCP and applies socket optimizations', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'tcp-host',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(netConnectMock).toHaveBeenCalledWith({ host: 'tcp-host', port: 50001 });
    expect(socket.setNoDelay).toHaveBeenCalledWith(true);
    expect(socket.setKeepAlive).toHaveBeenCalledWith(true, 30000);
  });

  it('loads mainnet singleton settings and proxy credentials from database config', async () => {
    const proxiedSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      mainnetSingletonHost: 'mainnet-singleton-host',
      mainnetSingletonPort: 50003,
      mainnetSingletonSsl: false,
      allowSelfSignedCert: true,
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
      proxyUsername: 'tor-user',
      proxyPassword: 'tor-pass',
    });
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient();
    await client.connect();

    expect(socksCreateConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: {
          host: 'mainnet-singleton-host',
          port: 50003,
        },
        proxy: expect.objectContaining({
          host: '127.0.0.1',
          port: 9050,
          userId: 'tor-user',
          password: 'tor-pass',
        }),
      }),
    );
  });

  it('uses mainnet legacy host, port, and useSsl when singleton fields are absent', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'mainnet-db-host',
      port: 55001,
      useSsl: true,
      mainnetSingletonHost: null,
      mainnetSingletonPort: null,
      mainnetSingletonSsl: null,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient();
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'mainnet-db-host', port: 55001 });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it('uses testnet database defaults when singleton host and port are absent', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      testnetSingletonSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient();
    client.setNetwork('testnet');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'fallback-host', port: 51001 });
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it('uses plain TCP for testnet when SSL is disabled', async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: true,
      testnetSingletonHost: 'testnet-plain-host',
      testnetSingletonPort: 52001,
      testnetSingletonSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork('testnet');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'testnet-plain-host', port: 52001 });
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it('uses signet database defaults when singleton host and port are absent', async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      signetSingletonSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork('signet');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'fallback-host', port: 60001 });
  });

  it('uses TLS for signet when SSL is enabled', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      signetSingletonHost: 'signet-ssl-host',
      signetSingletonPort: 60002,
      signetSingletonSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient();
    client.setNetwork('signet');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'signet-ssl-host', port: 60002 });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it('uses regtest legacy host and port from database config', async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'regtest-host',
      port: 60401,
      useSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork('regtest');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'regtest-host', port: 60401 });
  });

  it('uses TLS for regtest when useSsl is true', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'regtest-ssl-host',
      port: 60402,
      useSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient();
    client.setNetwork('regtest');
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'regtest-ssl-host', port: 60402 });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to environment electrum settings when db default is non-electrum', async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'bitcoin-core',
      host: 'ignored',
      port: 18443,
      useSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient();
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({ host: 'fallback-host', port: 50001 });
  });

  it('times out connection attempts when socket never connects', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => socket);

    const client = new ElectrumClient({
      host: 'tcp-timeout-host',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 25,
    });

    const rejected = client.connect().catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection timeout after 25ms');
  });

  it('connects via TLS and honors allowSelfSignedCert flag', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });

    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-host',
      port: 50002,
      protocol: 'ssl',
      allowSelfSignedCert: true,
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: baseSocket,
        rejectUnauthorized: false,
        servername: 'tls-host',
      }),
      expect.any(Function),
    );
    expect(tlsSocket.setNoDelay).toHaveBeenCalledWith(true);
    expect(tlsSocket.setKeepAlive).toHaveBeenCalledWith(true, 30000);
  });

  it('connects via TLS with certificate verification enabled by default', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-verified-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it('fails TLS connection when TLS socket emits error', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => tlsSocket.emit('error', new Error('tls exploded')));
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-error-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await expect(client.connect()).rejects.toThrow('tls exploded');
  });

  it('connects through SOCKS5 proxy when proxy is enabled', async () => {
    const proxiedSocket = new FakeSocket();
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
        username: 'u',
        password: 'p',
      },
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(socksCreateConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: expect.objectContaining({
          host: '127.0.0.1',
          port: 9050,
          type: 5,
          userId: 'u',
          password: 'p',
        }),
        destination: {
          host: 'target-host',
          port: 50001,
        },
        command: 'connect',
        timeout: 25,
      }),
    );
  });

  it('propagates request timeouts and removes pending request entries', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 25,
      batchRequestTimeoutMs: 60,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).request('server.ping');
    const rejected = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Request timeout after 25ms');
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('propagates batch request timeouts', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 15,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).batchRequest([
      { method: 'm1', params: [] },
      { method: 'm2', params: [] },
    ]);
    const rejected = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(20);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Batch request timeout after 15ms');
    expect((client as any).pendingRequests.size).toBeLessThanOrEqual(1);
  });

  it('auto-connects when issuing requests while disconnected', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    const connectSpy = vi.spyOn(client as any, 'connect').mockImplementation(async () => {
      (client as any).socket = socket;
      (client as any).connected = true;
    });

    socket.write.mockImplementation((message: string) => {
      const parsed = JSON.parse(message.trim());
      (client as any).handleData(
        Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }) + '\n'),
      );
    });

    await expect((client as any).request('server.ping')).resolves.toBeNull();
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects pending requests when socket closes', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('close');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection closed unexpectedly');
    expect(client.isConnected()).toBe(false);
  });

  it('rejects pending requests when socket ends', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('end');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection ended');
    expect(client.isConnected()).toBe(false);
  });

  it('rejects pending requests when socket emits error', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('error', new Error('socket exploded'));

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Socket error: socket exploded');
  });

  it('surfaces proxied connection failures', async () => {
    socksCreateConnectionMock.mockRejectedValueOnce(new Error('proxy unavailable'));

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await expect(client.connect()).rejects.toThrow('proxy unavailable');
  });

  it('times out proxy connection attempts and reports proxy context', async () => {
    socksCreateConnectionMock.mockImplementationOnce(() => new Promise(() => undefined));

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      connectionTimeoutMs: 25,
    });

    const rejected = client.connect().catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('via proxy');
  });

  it('supports TLS over proxied sockets', async () => {
    const proxiedSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'proxy-tls-host',
      port: 50002,
      protocol: 'ssl',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: proxiedSocket,
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it('creates proxy config without credentials when username/password are absent', async () => {
    const proxiedSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      mainnetSingletonHost: 'mainnet-proxy-host',
      mainnetSingletonPort: 50003,
      mainnetSingletonSsl: false,
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
      proxyUsername: null,
      proxyPassword: null,
    });
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient();
    await client.connect();

    const socksOptions = socksCreateConnectionMock.mock.calls[0][0];
    expect(socksOptions.proxy.userId).toBeUndefined();
    expect(socksOptions.proxy.password).toBeUndefined();
  });

  it('surfaces synchronous connection setup failures', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('timer creation failed');
    });

    try {
      const client = new ElectrumClient({
        host: 'localhost',
        port: 50001,
        protocol: 'tcp',
      });

      await expect(client.connect()).rejects.toThrow('timer creation failed');
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('auto-connects before sending batch requests when disconnected', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    const connectSpy = vi.spyOn(client as any, 'connect').mockImplementation(async () => {
      (client as any).socket = socket;
      (client as any).connected = true;
    });

    socket.write.mockImplementation((message: string) => {
      const lines = message.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        (client as any).handleData(
          Buffer.from(
            JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: `${parsed.method}-ok` }) + '\n'
          )
        );
      }
    });

    const result = await (client as any).batchRequest([
      { method: 'm1', params: [] },
      { method: 'm2', params: [] },
    ]);

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['m1-ok', 'm2-ok']);
  });

  it('routes socket data events through handleData', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 25,
    });

    await client.connect();
    const handleDataSpy = vi.spyOn(client as any, 'handleData');
    const payload = Buffer.from('{"jsonrpc":"2.0","id":1,"result":null}\n');

    socket.emit('data', payload);
    expect(handleDataSpy).toHaveBeenCalledWith(payload);
  });

  it('routes JSON-RPC notifications from handleData', () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
    });

    const newBlock = vi.fn();
    client.on('newBlock', newBlock);

    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","id":null,"method":"blockchain.headers.subscribe","params":[{"height":101,"hex":"abcd"}]}\n'));

    expect(newBlock).toHaveBeenCalledWith({ height: 101, hex: 'abcd' });
  });
});
