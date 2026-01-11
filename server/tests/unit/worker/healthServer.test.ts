/**
 * Worker Health Server Tests
 *
 * Tests for the HTTP health check server used by the worker process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  startHealthServer,
  HealthCheckProvider,
  HealthServerHandle,
} from '../../../src/worker/healthServer';

// Helper to make HTTP requests
async function makeRequest(
  port: number,
  path: string
): Promise<{ status: number; body: string; contentType: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            body,
            contentType: res.headers['content-type'],
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Worker Health Server', () => {
  let server: HealthServerHandle | null = null;
  let testPort: number;

  const healthyProvider: HealthCheckProvider = {
    getHealth: async () => ({
      redis: true,
      electrum: true,
      jobQueue: true,
      database: true,
    }),
    getMetrics: async () => ({
      queues: {
        sync: { waiting: 5, active: 2, completed: 100, failed: 1 },
      },
      electrum: {
        subscribedAddresses: 50,
        networks: {
          mainnet: { connected: true, lastBlockHeight: 800000 },
        },
      },
    }),
  };

  const unhealthyProvider: HealthCheckProvider = {
    getHealth: async () => ({
      redis: false,
      electrum: false,
      jobQueue: true,
      database: true,
    }),
  };

  beforeEach(() => {
    // Use random port for each test
    testPort = 30000 + Math.floor(Math.random() * 5000);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  describe('startHealthServer', () => {
    it('should start and return handle', () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      expect(server).toBeDefined();
      expect(server.port).toBe(testPort);
      expect(typeof server.close).toBe('function');
    });

    it('should close gracefully', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await expect(server.close()).resolves.toBeUndefined();
      server = null; // Already closed
    });
  });

  describe('GET /health', () => {
    it('should return 200 when healthy', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      // Wait for server to be ready
      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/health');

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('application/json');

      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
      expect(body.components.redis).toBe(true);
      expect(body.components.electrum).toBe(true);
      expect(body.components.jobQueue).toBe(true);
      expect(body.timestamp).toBeDefined();
    });

    it('should return 503 when unhealthy', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: unhealthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/health');

      expect(response.status).toBe(503);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.components.redis).toBe(false);
    });

    it('should also respond on /', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/');

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
    });
  });

  describe('GET /ready', () => {
    it('should return 200 ready when ready', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/ready');

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('text/plain');
      expect(response.body).toBe('ready');
    });

    it('should return 503 not ready when not ready', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: unhealthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/ready');

      expect(response.status).toBe(503);
      expect(response.body).toBe('not ready');
    });

    it('should be ready if redis and jobQueue are available', async () => {
      const partialProvider: HealthCheckProvider = {
        getHealth: async () => ({
          redis: true,
          electrum: false, // Electrum down doesn't affect readiness
          jobQueue: true,
        }),
      };

      server = startHealthServer({
        port: testPort,
        healthProvider: partialProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/ready');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /live', () => {
    it('should always return 200 alive', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: unhealthyProvider, // Even unhealthy
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/live');

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('text/plain');
      expect(response.body).toBe('alive');
    });
  });

  describe('GET /metrics', () => {
    it('should return metrics when provider has getMetrics', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/metrics');

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('application/json');

      const body = JSON.parse(response.body);
      expect(body.queues).toBeDefined();
      expect(body.queues.sync.waiting).toBe(5);
      expect(body.electrum.subscribedAddresses).toBe(50);
      expect(body.timestamp).toBeDefined();
    });

    it('should return health as metrics when provider lacks getMetrics', async () => {
      const simpleProvider: HealthCheckProvider = {
        getHealth: async () => ({
          redis: true,
          electrum: true,
          jobQueue: true,
        }),
        // No getMetrics method
      };

      server = startHealthServer({
        port: testPort,
        healthProvider: simpleProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/metrics');

      expect(response.status).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.health).toBeDefined();
      expect(body.health.redis).toBe(true);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown paths', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toBe('Not Found');
    });
  });

  describe('error handling', () => {
    it('should return 500 when health check throws', async () => {
      const errorProvider: HealthCheckProvider = {
        getHealth: async () => {
          throw new Error('Health check failed');
        },
      };

      server = startHealthServer({
        port: testPort,
        healthProvider: errorProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/health');

      expect(response.status).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
      expect(body.error).toBe('Health check failed');
    });

    it('should handle non-Error throws', async () => {
      const errorProvider: HealthCheckProvider = {
        getHealth: async () => {
          throw 'string error';
        },
      };

      server = startHealthServer({
        port: testPort,
        healthProvider: errorProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      const response = await makeRequest(testPort, '/health');

      expect(response.status).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('error');
    });
  });

  describe('CORS headers', () => {
    it('should set CORS headers', async () => {
      server = startHealthServer({
        port: testPort,
        healthProvider: healthyProvider,
      });

      await new Promise((r) => setTimeout(r, 50));

      // Make a raw request to check headers
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: testPort,
            path: '/health',
            method: 'GET',
          },
          resolve
        );
        req.on('error', reject);
        req.end();
      });

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toBe('GET');
    });
  });
});
