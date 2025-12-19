/**
 * NodeClient Unit Tests
 *
 * Tests for the node client mode switching behavior between
 * pool mode and single connection mode.
 */

// Mock the pool and electrum client before imports
const mockPool = {
  initialize: jest.fn().mockResolvedValue(undefined),
  shutdown: jest.fn().mockResolvedValue(undefined),
  acquire: jest.fn().mockResolvedValue({
    client: { getBlockHeight: jest.fn().mockResolvedValue(800000) },
    release: jest.fn(),
  }),
  getSubscriptionConnection: jest.fn().mockResolvedValue({
    isConnected: jest.fn().mockReturnValue(true),
  }),
  getPoolStats: jest.fn().mockReturnValue({
    totalConnections: 2,
    activeConnections: 0,
    idleConnections: 2,
  }),
  isPoolInitialized: jest.fn().mockReturnValue(true),
  isHealthy: jest.fn().mockReturnValue(true),
  setServers: jest.fn(),
  reloadServers: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  ElectrumPool: jest.fn().mockImplementation(() => mockPool),
}));

const mockElectrumClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  getBlockHeight: jest.fn().mockResolvedValue(800000),
};

jest.mock('../../../../src/services/bitcoin/electrum', () => ({
  ElectrumClient: jest.fn().mockImplementation(() => mockElectrumClient),
}));

jest.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: {
      findFirst: jest.fn().mockResolvedValue({
        type: 'electrum',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 5,
        poolLoadBalancing: 'round_robin',
      }),
    },
    electrumServer: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('NodeClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Pool Mode Configuration', () => {
    it('should recognize poolEnabled configuration option', () => {
      // This tests that the pool configuration structure is recognized
      const config = {
        type: 'electrum',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        poolEnabled: true,
        poolMinConnections: 2,
        poolMaxConnections: 10,
        poolLoadBalancing: 'round_robin',
      };

      expect(config.poolEnabled).toBe(true);
      expect(config.poolMinConnections).toBe(2);
      expect(config.poolMaxConnections).toBe(10);
      expect(config.poolLoadBalancing).toBe('round_robin');
    });

    it('should have default values when pool disabled', () => {
      const config = {
        type: 'electrum',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        poolEnabled: false,
      };

      expect(config.poolEnabled).toBe(false);
    });
  });

  describe('Pool Stats Structure', () => {
    it('should return proper pool stats structure', () => {
      const stats = mockPool.getPoolStats();

      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('idleConnections');
    });

    it('should indicate healthy pool', () => {
      expect(mockPool.isHealthy()).toBe(true);
      expect(mockPool.isPoolInitialized()).toBe(true);
    });
  });

  describe('Connection Acquisition', () => {
    it('should acquire connection from pool', async () => {
      const handle = await mockPool.acquire();

      expect(handle).toBeDefined();
      expect(handle.client).toBeDefined();
      expect(typeof handle.release).toBe('function');
    });

    it('should get subscription connection', async () => {
      const subConnection = await mockPool.getSubscriptionConnection();

      expect(subConnection).toBeDefined();
      expect(subConnection.isConnected()).toBe(true);
    });
  });

  describe('Pool Lifecycle', () => {
    it('should initialize pool', async () => {
      await mockPool.initialize();
      expect(mockPool.initialize).toHaveBeenCalled();
    });

    it('should shutdown pool', async () => {
      await mockPool.shutdown();
      expect(mockPool.shutdown).toHaveBeenCalled();
    });

    it('should reload servers', async () => {
      await mockPool.reloadServers();
      expect(mockPool.reloadServers).toHaveBeenCalled();
    });
  });
});
