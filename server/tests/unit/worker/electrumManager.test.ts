/**
 * ElectrumSubscriptionManager Tests
 *
 * Tests for the Electrum subscription manager, particularly
 * the reconcileSubscriptions method that handles memory cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing the module
vi.mock('../../../src/models/prisma', () => ({
  default: {
    address: {
      findMany: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the electrum client
vi.mock('../../../src/services/bitcoin/electrum', () => ({
  getElectrumClientForNetwork: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getServerVersion: vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' }),
    subscribeHeaders: vi.fn().mockResolvedValue({ height: 100000, hex: '00'.repeat(80) }),
    subscribeAddress: vi.fn().mockResolvedValue('status'),
    subscribeAddressBatch: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
  })),
  closeAllElectrumClients: vi.fn(),
}));

// Mock config
vi.mock('../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    bitcoin: { network: 'mainnet' },
  })),
}));

// Mock blockchain
vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  setCachedBlockHeight: vi.fn(),
}));

import prisma from '../../../src/models/prisma';
import { ElectrumSubscriptionManager } from '../../../src/worker/electrumManager';

describe('ElectrumSubscriptionManager', () => {
  let manager: ElectrumSubscriptionManager;
  const mockCallbacks = {
    onNewBlock: vi.fn(),
    onAddressActivity: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ElectrumSubscriptionManager(mockCallbacks);
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe('reconcileSubscriptions', () => {
    it('should remove addresses that no longer exist in database', async () => {
      // Setup: Manager has addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr2', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr3', { walletId: 'wallet2', network: 'mainnet' });

      // Database only has addr1 (addr2 and addr3 were deleted)
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(1);
      expect(addressToWallet.has('addr1')).toBe(true);
      expect(addressToWallet.has('addr2')).toBe(false);
      expect(addressToWallet.has('addr3')).toBe(false);
    });

    it('should add new addresses from database', async () => {
      // Setup: Manager has no addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      expect(addressToWallet.size).toBe(0);

      // Database has new addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'addr2', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(2);
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has('addr1')).toBe(true);
      expect(addressToWallet.has('addr2')).toBe(true);
    });

    it('should handle mixed add and remove operations', async () => {
      // Setup: Manager has some addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('old1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('keep', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('old2', { walletId: 'wallet2', network: 'mainnet' });

      // Database has one existing and one new
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'keep', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'new1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2); // old1, old2 removed
      expect(result.added).toBe(1); // new1 added
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has('keep')).toBe(true);
      expect(addressToWallet.has('new1')).toBe(true);
      expect(addressToWallet.has('old1')).toBe(false);
      expect(addressToWallet.has('old2')).toBe(false);
    });

    it('should handle empty database', async () => {
      // Setup: Manager has addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });

      // Database is empty
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(1);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(0);
    });

    it('should handle pagination correctly', async () => {
      // Setup: Manager is empty
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;

      // First page returns 2000 addresses (full page)
      const firstPage = Array.from({ length: 2000 }, (_, i) => ({
        id: `id-${i}`,
        address: `addr-${i}`,
        walletId: 'wallet1',
        wallet: { network: 'mainnet' },
      }));

      // Second page returns 500 addresses (partial page, ends pagination)
      const secondPage = Array.from({ length: 500 }, (_, i) => ({
        id: `id-${2000 + i}`,
        address: `addr-${2000 + i}`,
        walletId: 'wallet1',
        wallet: { network: 'mainnet' },
      }));

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const result = await manager.reconcileSubscriptions();

      expect(result.added).toBe(2500);
      expect(result.removed).toBe(0);
      expect(addressToWallet.size).toBe(2500);
      expect(prisma.address.findMany).toHaveBeenCalledTimes(2);
    });

    it('should not count existing addresses as added', async () => {
      // Setup: Manager already has some addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr2', { walletId: 'wallet1', network: 'mainnet' });

      // Database has the same addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'addr2', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(2);
    });
  });

  describe('getHealthMetrics', () => {
    it('should return correct metrics', () => {
      const metrics = manager.getHealthMetrics();

      expect(metrics).toHaveProperty('isRunning');
      expect(metrics).toHaveProperty('networks');
      expect(metrics).toHaveProperty('totalSubscribedAddresses');
      expect(typeof metrics.totalSubscribedAddresses).toBe('number');
    });
  });

  describe('isConnected', () => {
    it('should return false when no networks are connected', () => {
      expect(manager.isConnected()).toBe(false);
    });
  });
});
