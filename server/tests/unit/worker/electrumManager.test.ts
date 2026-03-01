/**
 * ElectrumSubscriptionManager Tests
 *
 * Tests for the Electrum subscription manager, particularly
 * the reconcileSubscriptions method that handles memory cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
  getElectrumClientForNetwork: vi.fn(),
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

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: vi.fn(),
  extendLock: vi.fn(),
  releaseLock: vi.fn(),
}));

import prisma from '../../../src/models/prisma';
import { acquireLock, extendLock, releaseLock } from '../../../src/infrastructure';
import { closeAllElectrumClients, getElectrumClientForNetwork } from '../../../src/services/bitcoin/electrum';
import { setCachedBlockHeight } from '../../../src/services/bitcoin/blockchain';
import { ElectrumSubscriptionManager } from '../../../src/worker/electrumManager';

class MockElectrumClient extends EventEmitter {
  connect = vi.fn().mockResolvedValue(undefined);
  getServerVersion = vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' });
  subscribeHeaders = vi.fn().mockResolvedValue({ height: 100000, hex: '00'.repeat(80) });
  subscribeAddress = vi.fn().mockResolvedValue('status');
  subscribeAddressBatch = vi.fn().mockResolvedValue([]);
}

describe('ElectrumSubscriptionManager', () => {
  let manager: ElectrumSubscriptionManager;
  let mockClient: MockElectrumClient;
  const mockCallbacks = {
    onNewBlock: vi.fn(),
    onAddressActivity: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockElectrumClient();
    vi.mocked(getElectrumClientForNetwork).mockReturnValue(mockClient as unknown as any);
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

  describe('start', () => {
    it('returns early when subscription lock is not acquired', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
    });

    it('connects to primary network and subscribes to headers', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(setCachedBlockHeight).toHaveBeenCalledWith(100000, 'mainnet');
      expect(manager.isConnected()).toBe(true);
    });

    it('returns early when start is called while manager is already running', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);

      await manager.start();
      await manager.start();

      expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(1);
    });
  });

  describe('event handling', () => {
    it('invokes callbacks for new blocks and address activity', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet
        .set('addr1', { walletId: 'wallet1', network: 'mainnet' });

      mockClient.emit('newBlock', { height: 123, hex: 'a'.repeat(80) });
      mockClient.emit('addressActivity', { scriptHash: 'hash', address: 'addr1', status: 'updated' });

      expect(mockCallbacks.onNewBlock).toHaveBeenCalledWith('mainnet', 123, 'a'.repeat(64));
      expect(mockCallbacks.onAddressActivity).toHaveBeenCalledWith('mainnet', 'wallet1', 'addr1');
    });
  });

  describe('subscribeWalletAddresses', () => {
    it('subscribes and tracks addresses for a wallet', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      (manager as unknown as { networks: Map<string, unknown> }).networks.set('mainnet', state);

      vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce({ network: 'mainnet' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { address: 'addr1' },
        { address: 'addr2' },
      ] as any);

      await manager.subscribeWalletAddresses('wallet1');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1', 'addr2']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get('addr1')).toEqual({ walletId: 'wallet1', network: 'mainnet' });
      expect(tracked.get('addr2')).toEqual({ walletId: 'wallet1', network: 'mainnet' });
    });

    it('returns when wallet does not exist', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null);

      await manager.subscribeWalletAddresses('missing-wallet');

      expect(prisma.address.findMany).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('returns when network is not connected', async () => {
      (manager as unknown as { networks: Map<string, unknown> }).networks.set('testnet', {
        network: 'testnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce({ network: 'testnet' } as any);
      await manager.subscribeWalletAddresses('wallet1');

      expect(prisma.address.findMany).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });

  describe('private branch behavior', () => {
    it('handles connectNetwork fast-path and connection failure reconnect scheduling', async () => {
      // Already connected branch
      (manager as any).networks.set('mainnet', {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });
      await (manager as any).connectNetwork('mainnet');
      expect(mockClient.connect).not.toHaveBeenCalled();

      // Connection failure branch creates/updates reconnect state
      (manager as any).networks.clear();
      mockClient.connect.mockRejectedValueOnce(new Error('connect failed'));
      await (manager as any).connectNetwork('mainnet');
      const reconnectState = (manager as any).networks.get('mainnet');
      expect(reconnectState).toBeDefined();
      expect(reconnectState.connected).toBe(false);
      expect(reconnectState.reconnectAttempts).toBe(1);
    });

    it('continues when server version lookup fails and when header subscription fails', async () => {
      mockClient.getServerVersion.mockRejectedValueOnce(new Error('version failed'));
      mockClient.subscribeHeaders.mockRejectedValueOnce(new Error('headers failed'));

      await (manager as any).connectNetwork('mainnet');

      const state = (manager as any).networks.get('mainnet');
      expect(state).toBeDefined();
      expect(state.subscribedToHeaders).toBe(false);
    });

    it('handles additional event paths for untracked addresses, missing address, close, and error', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      await manager.start();

      const state = (manager as any).networks.get('mainnet');
      state.subscribedAddresses.add('tracked-address');

      mockClient.emit('addressActivity', { scriptHash: 'x', status: 'changed' });
      mockClient.emit('addressActivity', { scriptHash: 'x', address: 'unknown', status: 'changed' });
      expect(mockCallbacks.onAddressActivity).not.toHaveBeenCalled();

      mockClient.emit('error', new Error('socket exploded'));
      mockClient.emit('close');

      expect(state.connected).toBe(false);
      expect(state.subscribedToHeaders).toBe(false);
      expect(state.subscribedAddresses.size).toBe(0);
      expect(state.reconnectTimer).not.toBeNull();
    });

    it('covers subscribeAddressBatch no-op and fallback individual subscription mode', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['already']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      await (manager as any).subscribeAddressBatch(state, [{ address: 'already', walletId: 'w1' }]);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();

      mockClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch failed'));
      mockClient.subscribeAddress
        .mockResolvedValueOnce('ok')
        .mockRejectedValueOnce(new Error('single failed'));

      await (manager as any).subscribeAddressBatch(state, [
        { address: 'new-a', walletId: 'w1' },
        { address: 'new-b', walletId: 'w1' },
      ]);

      expect(state.subscribedAddresses.has('new-a')).toBe(true);
      expect(state.subscribedAddresses.has('new-b')).toBe(false);
    });

    it('covers subscribeAllAddresses pagination progress and disconnected-network warning', async () => {
      const disconnectedState = {
        network: 'mainnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      (manager as any).networks.set('mainnet', disconnectedState);

      const makePage = (offset: number) =>
        Array.from({ length: 1000 }, (_, i) => ({
          id: `id-${offset + i}`,
          address: `addr-${offset + i}`,
          walletId: `wallet-${offset + i}`,
          wallet: { network: 'mainnet' },
        }));

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce(makePage(0) as any)
        .mockResolvedValueOnce(makePage(1000) as any)
        .mockResolvedValueOnce(makePage(2000) as any)
        .mockResolvedValueOnce(makePage(3000) as any)
        .mockResolvedValueOnce(makePage(4000) as any)
        .mockResolvedValueOnce([]);

      await (manager as any).subscribeAllAddresses();

      expect((manager as any).addressToWallet.size).toBe(5000);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('covers subscribeNetworkAddresses and checkHealth reconnect behavior', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      const disconnected = {
        network: 'testnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      (manager as any).networks.set('mainnet', state);
      (manager as any).networks.set('testnet', disconnected);
      (manager as any).addressToWallet.set('addr-main', { walletId: 'w-main', network: 'mainnet' });

      const batchSpy = vi
        .spyOn(manager as any, 'subscribeAddressBatch')
        .mockResolvedValue(undefined);

      await (manager as any).subscribeNetworkAddresses('mainnet');
      expect(batchSpy).toHaveBeenCalledWith(state, [{ address: 'addr-main', walletId: 'w-main' }]);

      mockClient.getServerVersion.mockRejectedValueOnce(new Error('health failed'));
      await (manager as any).checkHealth();

      expect(disconnected.connected).toBe(false);
      expect(state.connected).toBe(false);
      expect(state.reconnectTimer).not.toBeNull();
    });

    it('removes wallet addresses from tracking and subscribed sets', () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1', 'addr2']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      (manager as any).networks.set('mainnet', state);
      (manager as any).addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      (manager as any).addressToWallet.set('addr2', { walletId: 'wallet2', network: 'mainnet' });

      manager.unsubscribeWalletAddresses('wallet1');

      expect((manager as any).addressToWallet.has('addr1')).toBe(false);
      expect((manager as any).addressToWallet.has('addr2')).toBe(true);
      expect(state.subscribedAddresses.has('addr1')).toBe(false);
      expect(state.subscribedAddresses.has('addr2')).toBe(true);
    });

    it('reconciles with connected network subscriptions and subscribed-address cleanup', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['old-address']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      (manager as any).networks.set('mainnet', state);
      (manager as any).addressToWallet.set('old-address', { walletId: 'wallet-old', network: 'mainnet' });

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce([
          { id: '1', address: 'new-address', walletId: 'wallet-new', wallet: { network: 'mainnet' } },
        ] as any)
        .mockResolvedValueOnce([]);

      const batchSpy = vi
        .spyOn(manager as any, 'subscribeAddressBatch')
        .mockResolvedValue(undefined);

      const result = await manager.reconcileSubscriptions();
      expect(result).toEqual({ removed: 1, added: 1 });
      expect(batchSpy).toHaveBeenCalledWith(
        state,
        expect.arrayContaining([{ address: 'new-address', walletId: 'wallet-new' }])
      );
      expect(state.subscribedAddresses.has('old-address')).toBe(false);
    });

    it('populates network metrics and clears reconnect timers during stop', async () => {
      const reconnectTimer = setTimeout(() => undefined, 10_000);
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1']),
        lastBlockHeight: 777,
        reconnectTimer,
        reconnectAttempts: 3,
      };

      (manager as any).isRunning = true;
      (manager as any).networks.set('mainnet', state);
      (manager as any).addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      (manager as any).subscriptionLock = { key: 'k', token: 't' };
      vi.mocked(releaseLock).mockResolvedValue(true);

      const metrics = manager.getHealthMetrics();
      expect(metrics.networks.mainnet).toEqual({
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: 1,
        lastBlockHeight: 777,
        reconnectAttempts: 3,
      });

      await manager.stop();

      expect(vi.mocked(releaseLock)).toHaveBeenCalled();
      expect(vi.mocked(closeAllElectrumClients)).toHaveBeenCalled();
      expect(state.reconnectTimer).toBeNull();
      expect((manager as any).networks.size).toBe(0);
      expect((manager as any).addressToWallet.size).toBe(0);
    });

    it('refreshes and then loses subscription lock via timer callback', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      vi.mocked(extendLock)
        .mockResolvedValueOnce({ key: 'lock', token: 'token-2' } as any)
        .mockResolvedValueOnce(null);
      vi.mocked(releaseLock).mockResolvedValue(true);

      await manager.start();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(extendLock)).toHaveBeenCalledTimes(1);
      expect(manager.getHealthMetrics().isRunning).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(manager.getHealthMetrics().isRunning).toBe(false);

      vi.useRealTimers();
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
