import { vi } from 'vitest';
/**
 * Bitcoin Plugin Interface Tests
 *
 * Tests for the plugin registry and lifecycle management.
 */

import {
  registerPlugin,
  unregisterPlugin,
  getPlugin,
  getPlugins,
  setActivePlugin,
  setPluginEnabled,
  initializeAllPlugins,
  shutdownAllPlugins,
  checkAllPluginsHealth,
  BlockchainProvider,
  FeeEstimator,
  PriceProvider,
  Plugin,
  PluginHealthStatus,
} from '../../../../src/services/bitcoin/plugin';

// Helper to create mock blockchain provider
function createMockBlockchainProvider(id: string, name: string): BlockchainProvider {
  return {
    id,
    name,
    version: '1.0.0',
    type: 'blockchain',
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    getAddressUtxos: vi.fn().mockResolvedValue([]),
    getAddressHistory: vi.fn().mockResolvedValue([]),
    getTransaction: vi.fn().mockResolvedValue(null),
    broadcastTransaction: vi.fn().mockResolvedValue('txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  };
}

// Helper to create mock fee estimator
function createMockFeeEstimator(id: string, name: string): FeeEstimator {
  return {
    id,
    name,
    version: '1.0.0',
    type: 'fee',
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    getEstimates: vi.fn().mockResolvedValue([
      { feeRate: 20, targetBlocks: 1 },
      { feeRate: 10, targetBlocks: 6 },
    ]),
    getEstimateForTarget: vi.fn().mockResolvedValue(15),
    getRecommendedFees: vi.fn().mockResolvedValue({
      high: 20,
      medium: 10,
      low: 5,
      minimum: 1,
    }),
  };
}

// Helper to create mock price provider
function createMockPriceProvider(id: string, name: string): PriceProvider {
  return {
    id,
    name,
    version: '1.0.0',
    type: 'price',
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    getCurrentPrice: vi.fn().mockResolvedValue({
      usd: 50000,
      change24h: 2.5,
      updatedAt: new Date(),
    }),
    getHistoricalPrices: vi.fn().mockResolvedValue([
      { date: new Date(), price: 50000 },
    ]),
  };
}

describe('Bitcoin Plugin Registry', () => {
  beforeEach(async () => {
    // Clean up any existing plugins
    await shutdownAllPlugins();
  });

  afterEach(async () => {
    await shutdownAllPlugins();
  });

  describe('registerPlugin', () => {
    it('should register a blockchain provider', () => {
      const provider = createMockBlockchainProvider('electrum-1', 'Electrum Primary');

      registerPlugin('blockchain', 'electrum-1', provider);

      const retrieved = getPlugin<BlockchainProvider>('blockchain');
      expect(retrieved).toBe(provider);
    });

    it('should register a fee estimator', () => {
      const estimator = createMockFeeEstimator('mempool-fees', 'Mempool.space');

      registerPlugin('fee', 'mempool-fees', estimator);

      const retrieved = getPlugin<FeeEstimator>('fee');
      expect(retrieved).toBe(estimator);
    });

    it('should register a price provider', () => {
      const provider = createMockPriceProvider('coingecko', 'CoinGecko');

      registerPlugin('price', 'coingecko', provider);

      const retrieved = getPlugin<PriceProvider>('price');
      expect(retrieved).toBe(provider);
    });

    it('should set first plugin as active by default', () => {
      const provider1 = createMockBlockchainProvider('p1', 'Provider 1');
      const provider2 = createMockBlockchainProvider('p2', 'Provider 2');

      registerPlugin('blockchain', 'p1', provider1);
      registerPlugin('blockchain', 'p2', provider2);

      // First registered should be active
      expect(getPlugin<BlockchainProvider>('blockchain')).toBe(provider1);
    });

    it('should respect setActive option', () => {
      const provider1 = createMockBlockchainProvider('p1', 'Provider 1');
      const provider2 = createMockBlockchainProvider('p2', 'Provider 2');

      registerPlugin('blockchain', 'p1', provider1);
      registerPlugin('blockchain', 'p2', provider2, { setActive: true });

      // Second should be active
      expect(getPlugin<BlockchainProvider>('blockchain')).toBe(provider2);
    });
  });

  describe('unregisterPlugin', () => {
    it('should remove a plugin', () => {
      const provider = createMockBlockchainProvider('to-remove', 'Remove Me');

      registerPlugin('blockchain', 'to-remove', provider);
      unregisterPlugin('blockchain', 'to-remove');

      expect(getPlugin<BlockchainProvider>('blockchain')).toBeNull();
    });

    it('should select next highest priority when active is removed', () => {
      const provider1 = createMockBlockchainProvider('p1', 'P1');
      const provider2 = createMockBlockchainProvider('p2', 'P2');

      registerPlugin('blockchain', 'p1', provider1, { priority: 10 });
      registerPlugin('blockchain', 'p2', provider2, { priority: 5 });

      // p1 is active (first registered)
      unregisterPlugin('blockchain', 'p1');

      // p2 should become active
      expect(getPlugin<BlockchainProvider>('blockchain')).toBe(provider2);
    });
  });

  describe('getPlugins', () => {
    it('should return all plugins of a type sorted by priority', () => {
      const low = createMockBlockchainProvider('low', 'Low Priority');
      const high = createMockBlockchainProvider('high', 'High Priority');

      registerPlugin('blockchain', 'low', low, { priority: 1 });
      registerPlugin('blockchain', 'high', high, { priority: 10 });

      const plugins = getPlugins<BlockchainProvider>('blockchain');

      expect(plugins).toHaveLength(2);
      expect(plugins[0]).toBe(high); // Higher priority first
      expect(plugins[1]).toBe(low);
    });

    it('should return empty array for unknown type', () => {
      const plugins = getPlugins<BlockchainProvider>('blockchain');
      expect(plugins).toEqual([]);
    });
  });

  describe('setActivePlugin', () => {
    it('should change the active plugin', () => {
      const provider1 = createMockBlockchainProvider('p1', 'P1');
      const provider2 = createMockBlockchainProvider('p2', 'P2');

      registerPlugin('blockchain', 'p1', provider1);
      registerPlugin('blockchain', 'p2', provider2);

      const result = setActivePlugin('blockchain', 'p2');

      expect(result).toBe(true);
      expect(getPlugin<BlockchainProvider>('blockchain')).toBe(provider2);
    });

    it('should return false for unknown plugin', () => {
      const result = setActivePlugin('blockchain', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('setPluginEnabled', () => {
    it('should disable a plugin', () => {
      const provider = createMockBlockchainProvider('toggle', 'Toggle');

      registerPlugin('blockchain', 'toggle', provider);
      setPluginEnabled('blockchain', 'toggle', false);

      // Disabled plugin should not be returned
      expect(getPlugin<BlockchainProvider>('blockchain')).toBeNull();
    });

    it('should re-enable a disabled plugin', () => {
      const provider = createMockBlockchainProvider('toggle', 'Toggle');

      registerPlugin('blockchain', 'toggle', provider);
      setPluginEnabled('blockchain', 'toggle', false);
      setPluginEnabled('blockchain', 'toggle', true);

      expect(getPlugin<BlockchainProvider>('blockchain')).toBe(provider);
    });
  });

  describe('lifecycle', () => {
    it('should initialize all plugins', async () => {
      const provider = createMockBlockchainProvider('init-test', 'Init Test');
      const estimator = createMockFeeEstimator('fee-init', 'Fee Init');

      registerPlugin('blockchain', 'init-test', provider);
      registerPlugin('fee', 'fee-init', estimator);

      await initializeAllPlugins();

      expect(provider.initialize).toHaveBeenCalled();
      expect(estimator.initialize).toHaveBeenCalled();
    });

    it('should shutdown all plugins', async () => {
      const provider = createMockBlockchainProvider('shutdown-test', 'Shutdown Test');

      registerPlugin('blockchain', 'shutdown-test', provider);
      await initializeAllPlugins();
      await shutdownAllPlugins();

      expect(provider.shutdown).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      const failingProvider: BlockchainProvider = {
        ...createMockBlockchainProvider('fail', 'Failing'),
        initialize: vi.fn().mockRejectedValue(new Error('Init failed')),
      };

      registerPlugin('blockchain', 'fail', failingProvider);

      // Should not throw
      await expect(initializeAllPlugins()).resolves.toBeUndefined();

      // Plugin should be disabled after failed init
      expect(getPlugin<BlockchainProvider>('blockchain')).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should check health of all plugins', async () => {
      const healthy = createMockBlockchainProvider('healthy', 'Healthy');
      const unhealthy: BlockchainProvider = {
        ...createMockBlockchainProvider('unhealthy', 'Unhealthy'),
        healthCheck: vi.fn().mockResolvedValue({ healthy: false, error: 'Connection lost' }),
      };

      registerPlugin('blockchain', 'healthy', healthy);
      registerPlugin('fee', 'unhealthy', unhealthy as any);

      const results = await checkAllPluginsHealth();

      expect(results.get('healthy')?.status.healthy).toBe(true);
      expect(results.get('unhealthy')?.status.healthy).toBe(false);
    });

    it('should handle healthCheck errors', async () => {
      const throwing: BlockchainProvider = {
        ...createMockBlockchainProvider('throwing', 'Throwing'),
        healthCheck: vi.fn().mockRejectedValue(new Error('Health check failed')),
      };

      registerPlugin('blockchain', 'throwing', throwing);

      const results = await checkAllPluginsHealth();

      expect(results.get('throwing')?.status.healthy).toBe(false);
      expect(results.get('throwing')?.status.error).toContain('Health check failed');
    });
  });
});
