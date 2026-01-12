/**
 * Tests for node.ts API routes
 * Tests Electrum server connection testing endpoint
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express, { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { EventEmitter } from 'events';

// Mock JWT verification
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn((token: string) => {
      if (token === 'valid-token') {
        return { userId: 'user-1', type: 'access' };
      }
      throw new Error('Invalid token');
    }),
  },
}));

// Mock net module
const mockSocket = new EventEmitter() as EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
mockSocket.write = vi.fn();
mockSocket.destroy = vi.fn();

vi.mock('net', () => ({
  default: {
    connect: vi.fn(() => mockSocket),
  },
}));

// Mock tls module
const mockTlsSocket = new EventEmitter() as EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
mockTlsSocket.write = vi.fn();
mockTlsSocket.destroy = vi.fn();

vi.mock('tls', () => ({
  default: {
    connect: vi.fn(() => mockTlsSocket),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import router and mocked modules
import nodeRouter from '../../../src/api/node';
import net from 'net';
import tls from 'tls';

const mockNetConnect = net.connect as ReturnType<typeof vi.fn>;
const mockTlsConnect = tls.connect as ReturnType<typeof vi.fn>;

describe('Node API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/node', nodeRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset socket mocks
    mockNetConnect.mockReturnValue(mockSocket);
    mockTlsConnect.mockReturnValue(mockTlsSocket);
    mockSocket.removeAllListeners();
    mockTlsSocket.removeAllListeners();
  });

  describe('POST /test', () => {
    describe('Authentication', () => {
      it('should require authentication', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(401);
      });

      it('should reject invalid token', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer invalid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should require host field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ port: 50002, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('host');
      });

      it('should require port field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should require protocol field', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002 });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('protocol');
      });

      it('should only support electrum node type', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ nodeType: 'bitcoin-core', host: 'example.com', port: 8332, protocol: 'tcp' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Electrum');
      });

      it('should accept electrum node type', async () => {
        // Start the request but don't await it yet
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ nodeType: 'electrum', host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        // Simulate connection error after short delay
        setTimeout(() => {
          mockTlsSocket.emit('error', new Error('Connection refused'));
        }, 10);

        const response = await responsePromise;
        // Should not be a 400 validation error
        expect(response.status).toBe(200);
      });

      it('should reject invalid port number', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 'invalid', protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should reject port 0', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 0, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });

      it('should reject port > 65535', async () => {
        const response = await request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 70000, protocol: 'ssl' });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('port');
      });
    });

    describe('SSL Connection', () => {
      it('should use tls.connect for ssl protocol', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        // Simulate connection and response
        setTimeout(() => {
          mockTlsSocket.emit('connect');
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: ['ElectrumX 1.16.0', '1.4'],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(mockTlsConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'electrum.example.com',
            port: 50002,
            rejectUnauthorized: false,
          })
        );
      });

      it('should return server info on successful SSL connection', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: ['ElectrumX 1.16.0', '1.4'],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo).toEqual({
          server: 'ElectrumX 1.16.0',
          protocol: '1.4',
        });
      });
    });

    describe('TCP Connection', () => {
      it('should use net.connect for tcp protocol', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50001, protocol: 'tcp' });

        setTimeout(() => {
          mockSocket.emit('connect');
          mockSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: ['Fulcrum 1.9.0', '1.4.2'],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(mockNetConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'electrum.example.com',
            port: 50001,
          })
        );
      });

      it('should return server info on successful TCP connection', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50001, protocol: 'tcp' });

        setTimeout(() => {
          mockSocket.emit('connect');
          mockSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: ['Fulcrum 1.9.0', '1.4.2'],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo).toEqual({
          server: 'Fulcrum 1.9.0',
          protocol: '1.4.2',
        });
      });
    });

    describe('Error Handling', () => {
      it('should handle connection errors', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('error', new Error('Connection refused'));
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Connection refused');
      });

      it('should handle socket timeout', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('timeout');
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('timeout');
      });

      it('should handle Electrum protocol errors', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32600, message: 'Invalid version' },
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Electrum error');
      });

      it('should handle empty server version result', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: [],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.serverInfo.server).toBe('Unknown');
        expect(response.body.serverInfo.protocol).toBe('Unknown');
      });
    });

    describe('Protocol Behavior', () => {
      it('should send server.version request on connect', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          // Verify write was called with JSON-RPC request
          expect(mockTlsSocket.write).toHaveBeenCalledWith(
            expect.stringContaining('"method":"server.version"')
          );
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: ['Test', '1.4'],
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
      });

      it('should handle chunked data', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          // Send response in two chunks
          mockTlsSocket.emit('data', '{"jsonrpc":"2.0","id":1,');
          mockTlsSocket.emit('data', '"result":["ElectrumX","1.4"]}\n');
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('should handle response without result', async () => {
        const responsePromise = request(app)
          .post('/api/v1/node/test')
          .set('Authorization', 'Bearer valid-token')
          .send({ host: 'electrum.example.com', port: 50002, protocol: 'ssl' });

        setTimeout(() => {
          mockTlsSocket.emit('connect');
          mockTlsSocket.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
            }) + '\n'
          );
        }, 10);

        const response = await responsePromise;
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Connected successfully');
      });
    });
  });
});
