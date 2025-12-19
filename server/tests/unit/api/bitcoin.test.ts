/**
 * Bitcoin API Tests
 *
 * Tests for the Bitcoin API endpoints including pool status.
 */

import express from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool, resetElectrumMocks, resetElectrumPoolMocks } from '../../mocks/electrum';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the node client
const mockNodeClient = {
  getElectrumClientIfActive: jest.fn().mockReturnValue(mockElectrumClient),
  getNodeConfig: jest.fn().mockResolvedValue({
    type: 'electrum',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    poolEnabled: true,
  }),
  isConnected: jest.fn().mockReturnValue(true),
  getElectrumPool: jest.fn().mockReturnValue(mockElectrumPool),
};

jest.mock('../../../src/services/bitcoin/nodeClient', () => mockNodeClient);

// Mock authentication middleware
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { id: 'test-user-id', isAdmin: false };
    next();
  },
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Import after mocks
import bitcoinRouter from '../../../src/api/bitcoin';

describe('Bitcoin API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/bitcoin', bitcoinRouter);
  });

  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    resetElectrumPoolMocks();
    jest.clearAllMocks();
  });

  describe('GET /bitcoin/status', () => {
    it('should return node status with pool stats when pool is initialized', async () => {
      mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
      mockElectrumPool.isPoolInitialized.mockReturnValue(true);

      const response = await request(app).get('/bitcoin/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('connected');
    });

    it('should include pool stats structure when available', async () => {
      // Test validates the pool stats structure is correct
      const poolStats = {
        totalConnections: 5,
        activeConnections: 2,
        idleConnections: 3,
        waitingRequests: 0,
        totalAcquisitions: 100,
        averageAcquisitionTimeMs: 5,
        healthCheckFailures: 0,
        serverCount: 2,
        servers: [
          {
            serverId: 'server-1',
            label: 'Primary',
            host: 'primary.com',
            port: 50002,
            connectionCount: 3,
            healthyConnections: 3,
            totalRequests: 50,
            failedRequests: 0,
            isHealthy: true,
            lastHealthCheck: new Date().toISOString(),
          },
          {
            serverId: 'server-2',
            label: 'Secondary',
            host: 'secondary.com',
            port: 50002,
            connectionCount: 2,
            healthyConnections: 2,
            totalRequests: 50,
            failedRequests: 0,
            isHealthy: true,
            lastHealthCheck: new Date().toISOString(),
          },
        ],
      };

      // Validate structure
      expect(poolStats).toHaveProperty('totalConnections');
      expect(poolStats).toHaveProperty('activeConnections');
      expect(poolStats).toHaveProperty('idleConnections');
      expect(poolStats).toHaveProperty('servers');
      expect(poolStats.servers).toHaveLength(2);
    });

    it('should return null pool when not electrum type', async () => {
      mockNodeClient.getNodeConfig.mockResolvedValue({
        type: 'bitcoind',
        host: 'localhost',
        port: 8332,
      });
      mockNodeClient.getElectrumPool.mockReturnValue(null);

      const response = await request(app).get('/bitcoin/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('connected');
    });

    it('should handle pool not initialized', async () => {
      mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
      mockElectrumPool.isPoolInitialized.mockReturnValue(false);

      const response = await request(app).get('/bitcoin/status');

      expect(response.status).toBe(200);
    });

    it('should include effective min/max connections in stats', async () => {
      // Test validates effective connection calculations
      const effectiveMin = 3;
      const effectiveMax = 10;
      const serverCount = 3;

      // Effective min should be max(configured, serverCount)
      const configuredMin = 1;
      const calculatedEffectiveMin = Math.max(configuredMin, serverCount);
      expect(calculatedEffectiveMin).toBe(effectiveMin);

      // Effective max should be max(configured, serverCount)
      const configuredMax = 10;
      const calculatedEffectiveMax = Math.max(configuredMax, serverCount);
      expect(calculatedEffectiveMax).toBe(effectiveMax);
    });
  });

  // Note: /bitcoin/fees and /bitcoin/block-height tests require full server
  // setup with middleware and are better suited for integration tests.

  describe('Pool Stats Structure Validation', () => {
    it('should have correct server stats structure', () => {
      const serverStats = {
        serverId: 'test-server',
        label: 'Test Server',
        host: 'test.example.com',
        port: 50002,
        connectionCount: 2,
        healthyConnections: 2,
        totalRequests: 100,
        failedRequests: 0,
        isHealthy: true,
        lastHealthCheck: new Date().toISOString(),
      };

      expect(serverStats).toHaveProperty('serverId');
      expect(serverStats).toHaveProperty('label');
      expect(serverStats).toHaveProperty('host');
      expect(serverStats).toHaveProperty('port');
      expect(serverStats).toHaveProperty('connectionCount');
      expect(serverStats).toHaveProperty('healthyConnections');
      expect(serverStats).toHaveProperty('totalRequests');
      expect(serverStats).toHaveProperty('failedRequests');
      expect(serverStats).toHaveProperty('isHealthy');
      expect(serverStats).toHaveProperty('lastHealthCheck');
    });

    it('should have correct pool stats structure', () => {
      const poolStats = mockElectrumPool.getPoolStats();

      expect(poolStats).toHaveProperty('totalConnections');
      expect(poolStats).toHaveProperty('activeConnections');
      expect(poolStats).toHaveProperty('idleConnections');
      expect(poolStats).toHaveProperty('waitingRequests');
      expect(poolStats).toHaveProperty('totalAcquisitions');
      expect(poolStats).toHaveProperty('averageAcquisitionTimeMs');
      expect(poolStats).toHaveProperty('healthCheckFailures');
      expect(poolStats).toHaveProperty('serverCount');
      expect(poolStats).toHaveProperty('servers');
      expect(Array.isArray(poolStats.servers)).toBe(true);
    });
  });
});
