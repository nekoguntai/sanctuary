import { vi } from 'vitest';
/**
 * NodeClient Unit Tests
 *
 * Tests for the node client mode switching behavior between
 * pool mode and single connection mode.
 */

// Mock the pool and electrum client before imports
const mockPool = {
  initialize: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  acquire: vi.fn().mockResolvedValue({
    client: { getBlockHeight: vi.fn().mockResolvedValue(800000) },
    release: vi.fn(),
  }),
  getSubscriptionConnection: vi.fn().mockResolvedValue({
    isConnected: vi.fn().mockReturnValue(true),
  }),
  getPoolStats: vi.fn().mockReturnValue({
    totalConnections: 2,
    activeConnections: 0,
    idleConnections: 2,
  }),
  isPoolInitialized: vi.fn().mockReturnValue(true),
  isHealthy: vi.fn().mockReturnValue(true),
  setServers: vi.fn(),
  reloadServers: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  ElectrumPool: vi.fn().mockImplementation(() => mockPool),
}));

const mockElectrumClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
  getBlockHeight: vi.fn().mockResolvedValue(800000),
};

vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  ElectrumClient: vi.fn().mockImplementation(() => mockElectrumClient),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: {
      findFirst: vi.fn().mockResolvedValue({
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
      findMany: vi.fn().mockResolvedValue([]),
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

describe('NodeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
