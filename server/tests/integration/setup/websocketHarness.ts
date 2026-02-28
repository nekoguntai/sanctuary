import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { SanctauryWebSocketServer } from '../../../src/websocket/clientServer';
import { GatewayWebSocketServer } from '../../../src/websocket/gatewayServer';

type BufferedWebSocket = WebSocket & { __testMessageBuffer?: unknown[] };

interface WebSocketHarnessOptions {
  enableGateway?: boolean;
}

interface WebSocketTestHandle {
  server: http.Server;
  wsServer: SanctauryWebSocketServer;
  gatewayServer: GatewayWebSocketServer | null;
  url: string;
  gatewayUrl: string | null;
  connectClient: (token?: string) => Promise<WebSocket>;
  connectGateway: () => Promise<WebSocket>;
  close: () => Promise<void>;
}

const waitForOpen = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

const attachMessageBuffer = (socket: WebSocket): void => {
  const bufferedSocket = socket as BufferedWebSocket;
  bufferedSocket.__testMessageBuffer = [];
  socket.on('message', (data) => {
    try {
      bufferedSocket.__testMessageBuffer?.push(JSON.parse(data.toString()));
    } catch {
      // Ignore non-JSON test messages.
    }
  });
};

export const createWebSocketTestServer = async (
  options: WebSocketHarnessOptions = {}
): Promise<WebSocketTestHandle> => {
  const server = http.createServer();
  const wsServer = new SanctauryWebSocketServer();
  const gatewayServer = options.enableGateway ? new GatewayWebSocketServer() : null;

  server.on('upgrade', (request, socket, head) => {
    if (gatewayServer && request.url?.startsWith('/gateway')) {
      gatewayServer.handleUpgrade(request, socket, head);
      return;
    }
    wsServer.handleUpgrade(request, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('error', onError);
      reject(err);
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const gatewayUrl = gatewayServer ? `ws://127.0.0.1:${port}/gateway` : null;

  return {
    server,
    wsServer,
    gatewayServer,
    url,
    gatewayUrl,
    connectClient: async (token?: string) => {
      const socket = new WebSocket(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      attachMessageBuffer(socket);
      await waitForOpen(socket);
      return socket;
    },
    connectGateway: async () => {
      if (!gatewayUrl) {
        throw new Error('Gateway WebSocket server not enabled');
      }
      const socket = new WebSocket(gatewayUrl);
      attachMessageBuffer(socket);
      await waitForOpen(socket);
      return socket;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      (wsServer as any).wss?.close?.();
      (gatewayServer as any)?.wss?.close?.();
    },
  };
};
