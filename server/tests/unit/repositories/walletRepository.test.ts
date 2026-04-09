/**
 * Wallet Repository Tests
 *
 * Tests for wallet data access layer operations including access control,
 * pagination, sync state management, and various query patterns.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    wallet: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    walletDevice: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: any) => Promise<any>) => fn({
      wallet: {
        create: (prisma as any).wallet.create,
        findUnique: (prisma as any).wallet.findUnique,
      },
      walletDevice: {
        createMany: (prisma as any).walletDevice.createMany,
      },
    })),
  },
}));

import prisma from '../../../src/models/prisma';
import { walletRepository } from '../../../src/repositories/walletRepository';

describe('Wallet Repository', () => {
  const mockWallet = {
    id: 'wallet-123',
    name: 'Test Wallet',
    network: 'mainnet',
    scriptType: 'native_segwit',
    syncInProgress: false,
    lastSyncedAt: new Date(),
    lastSyncStatus: 'success',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserId = 'user-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findByIdWithAccess', () => {
    it('should return wallet when user has direct access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findByIdWithAccess('wallet-123', mockUserId);

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
      });
    });

    it('should return null when user lacks access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findByIdWithAccess('wallet-123', 'other-user');

      expect(result).toBeNull();
    });

    it('should return null when wallet does not exist', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findByIdWithAccess('non-existent', mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithAddresses', () => {
    it('should return wallet with addresses included', async () => {
      const walletWithAddresses = {
        ...mockWallet,
        addresses: [
          { id: 'addr-1', address: 'bc1q...', index: 0 },
          { id: 'addr-2', address: 'bc1q...', index: 1 },
        ],
      };

      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithAddresses);

      const result = await walletRepository.findByIdWithAddresses('wallet-123', mockUserId);

      expect(result).toEqual(walletWithAddresses);
      expect(result?.addresses).toHaveLength(2);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { addresses: true },
      });
    });
  });

  describe('findByUserId', () => {
    it('should return all wallets for user', async () => {
      const wallets = [mockWallet, { ...mockWallet, id: 'wallet-456', name: 'Second Wallet' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserId(mockUserId);

      expect(result).toHaveLength(2);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
      });
    });

    it('should return empty array when user has no wallets', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      const result = await walletRepository.findByUserId(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('findByUserIdPaginated', () => {
    it('should return paginated results with default options', async () => {
      const wallets = Array.from({ length: 51 }, (_, i) => ({
        ...mockWallet,
        id: `wallet-${i}`,
      }));

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId);

      expect(result.items).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('wallet-49');
    });

    it('should handle cursor-based pagination', async () => {
      const wallets = [
        { ...mockWallet, id: 'wallet-51' },
        { ...mockWallet, id: 'wallet-52' },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, {
        cursor: 'wallet-50',
        limit: 10,
      });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { gt: 'wallet-50' },
          }),
        })
      );
    });

    it('should handle backward pagination', async () => {
      const wallets = [
        { ...mockWallet, id: 'wallet-48' },
        { ...mockWallet, id: 'wallet-49' },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, {
        cursor: 'wallet-50',
        direction: 'backward',
        limit: 10,
      });

      // Results should be reversed for backward pagination
      expect(result.items[0].id).toBe('wallet-49');
      expect(result.items[1].id).toBe('wallet-48');
    });

    it('should indicate no more results when at end', async () => {
      const wallets = [{ ...mockWallet, id: 'wallet-last' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, { limit: 10 });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should cap limit at 200', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findByUserIdPaginated(mockUserId, { limit: 500 });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 201, // 200 + 1 for hasMore detection
        })
      );
    });

    it('should return null nextCursor when hasMore is true but sliced items are empty', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([{ ...mockWallet, id: 'wallet-1' }]);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, { limit: 0 });

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('findByNetwork', () => {
    it('should return wallets for specific network', async () => {
      const mainnetWallets = [mockWallet];
      (prisma.wallet.findMany as Mock).mockResolvedValue(mainnetWallets);

      const result = await walletRepository.findByNetwork(mockUserId, 'mainnet');

      expect(result).toEqual(mainnetWallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          network: 'mainnet',
        }),
      });
    });

    it('should return empty array for network with no wallets', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      const result = await walletRepository.findByNetwork(mockUserId, 'testnet');

      expect(result).toEqual([]);
    });
  });

  describe('findByNetworkWithSyncStatus', () => {
    it('should return sync status fields only', async () => {
      const syncStatuses = [
        { id: 'wallet-1', syncInProgress: false, lastSyncStatus: 'success', lastSyncedAt: new Date() },
        { id: 'wallet-2', syncInProgress: true, lastSyncStatus: null, lastSyncedAt: null },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(syncStatuses);

      const result = await walletRepository.findByNetworkWithSyncStatus(mockUserId, 'mainnet');

      expect(result).toEqual(syncStatuses);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ network: 'mainnet' }),
        select: {
          id: true,
          syncInProgress: true,
          lastSyncStatus: true,
          lastSyncedAt: true,
        },
      });
    });
  });

  describe('getIdsByNetwork', () => {
    it('should return only wallet IDs', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
        { id: 'wallet-3' },
      ]);

      const result = await walletRepository.getIdsByNetwork(mockUserId, 'mainnet');

      expect(result).toEqual(['wallet-1', 'wallet-2', 'wallet-3']);
    });
  });

  describe('updateSyncState', () => {
    it('should update sync state fields', async () => {
      const updatedWallet = {
        ...mockWallet,
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      };

      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.updateSyncState('wallet-123', {
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      });

      expect(result.syncInProgress).toBe(true);
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: true,
          lastSyncStatus: 'syncing',
        },
      });
    });
  });

  describe('resetSyncState', () => {
    it('should reset all sync fields to default', async () => {
      const resetWallet = {
        ...mockWallet,
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
      };

      (prisma.wallet.update as Mock).mockResolvedValue(resetWallet);

      const result = await walletRepository.resetSyncState('wallet-123');

      expect(result.syncInProgress).toBe(false);
      expect(result.lastSyncedAt).toBeNull();
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: false,
          lastSyncedAt: null,
          lastSyncStatus: null,
        },
      });
    });
  });

  describe('update', () => {
    it('should update wallet with provided data', async () => {
      const updatedWallet = { ...mockWallet, name: 'Updated Name' };
      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.update('wallet-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: { name: 'Updated Name' },
      });
    });
  });

  describe('hasAccess', () => {
    it('should return true when user has access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue({ id: 'wallet-123' });

      const result = await walletRepository.hasAccess('wallet-123', mockUserId);

      expect(result).toBe(true);
    });

    it('should return false when user lacks access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.hasAccess('wallet-123', 'other-user');

      expect(result).toBe(false);
    });
  });

  describe('findById', () => {
    it('should find wallet by ID without access check', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findById('wallet-123');

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
    });
  });

  describe('getName', () => {
    it('should return wallet name', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ name: 'My Wallet' });

      const result = await walletRepository.getName('wallet-123');

      expect(result).toBe('My Wallet');
    });

    it('should return null when wallet not found', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(null);

      const result = await walletRepository.getName('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithGroup', () => {
    it('should return wallet with group info', async () => {
      const walletWithGroup = {
        ...mockWallet,
        group: { name: 'Family Wallet Group' },
      };

      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithGroup);

      const result = await walletRepository.findByIdWithGroup('wallet-123');

      expect(result?.group?.name).toBe('Family Wallet Group');
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        include: { group: true },
      });
    });

    it('should return wallet with null group', async () => {
      const walletWithoutGroup = { ...mockWallet, group: null };
      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithoutGroup);

      const result = await walletRepository.findByIdWithGroup('wallet-123');

      expect(result?.group).toBeNull();
    });
  });

  describe('findByIdWithDevices', () => {
    it('should return wallet with devices and accounts', async () => {
      const walletWithDevices = {
        ...mockWallet,
        devices: [
          {
            signerIndex: 0,
            device: {
              id: 'device-1',
              label: 'Ledger',
              accounts: [{ derivationPath: "m/84'/0'/0'" }],
            },
          },
          {
            signerIndex: 1,
            device: {
              id: 'device-2',
              label: 'Trezor',
              accounts: [{ derivationPath: "m/84'/0'/0'" }],
            },
          },
        ],
      };

      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithDevices);

      const result = await walletRepository.findByIdWithDevices('wallet-123');

      expect(result?.devices).toHaveLength(2);
      expect(result?.devices[0].signerIndex).toBe(0);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        include: {
          devices: {
            include: {
              device: {
                include: {
                  accounts: true,
                },
              },
            },
            orderBy: { signerIndex: 'asc' },
          },
        },
      });
    });
  });

  describe('findByIdWithAccessAndDevices', () => {
    it('queries with access check and device include', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValueOnce({ ...mockWallet, devices: [] });
      const result = await walletRepository.findByIdWithAccessAndDevices('wallet-123', mockUserId);
      expect(result).toBeTruthy();
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { devices: { include: { device: true } } },
      }));
    });
  });

  describe('findByIdWithOwnerAndDevices', () => {
    it('queries with owner role check and device include', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValueOnce({ ...mockWallet, devices: [] });
      const result = await walletRepository.findByIdWithOwnerAndDevices('wallet-123', mockUserId);
      expect(result).toBeTruthy();
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'wallet-123',
          users: { some: { userId: mockUserId, role: 'owner' } },
        }),
        include: { devices: { include: { device: true } } },
      }));
    });
  });

  describe('linkDevice', () => {
    it('creates a walletDevice record', async () => {
      (prisma as any).walletDevice.create.mockResolvedValueOnce({ walletId: 'w1', deviceId: 'd1', signerIndex: 0 });
      await walletRepository.linkDevice('w1', 'd1', 0);
      expect((prisma as any).walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', deviceId: 'd1', signerIndex: 0 },
      });
    });

    it('allows omitting signerIndex', async () => {
      (prisma as any).walletDevice.create.mockResolvedValueOnce({ walletId: 'w1', deviceId: 'd1' });
      await walletRepository.linkDevice('w1', 'd1');
      expect((prisma as any).walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', deviceId: 'd1', signerIndex: undefined },
      });
    });
  });

  describe('createWithDeviceLinks', () => {
    it('creates wallet and links devices atomically', async () => {
      const created = { id: 'new-wallet', devices: [{ deviceId: 'd1' }], addresses: [] };
      (prisma as any).$transaction.mockImplementationOnce(async (fn: any) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'new-wallet' }), findUnique: vi.fn().mockResolvedValue(created) },
          walletDevice: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
        ['d1'],
      );

      expect(result.id).toBe('new-wallet');
    });

    it('creates wallet without device links when deviceIds omitted', async () => {
      const created = { id: 'new-wallet', devices: [], addresses: [] };
      (prisma as any).$transaction.mockImplementationOnce(async (fn: any) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'new-wallet' }), findUnique: vi.fn().mockResolvedValue(created) },
          walletDevice: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
      );

      expect(result.id).toBe('new-wallet');
    });

    it('throws when wallet creation returns null', async () => {
      (prisma as any).$transaction.mockImplementationOnce(async (fn: any) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'ghost' }), findUnique: vi.fn().mockResolvedValue(null) },
          walletDevice: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      await expect(
        walletRepository.createWithDeviceLinks({ name: 'Ghost' } as any),
      ).rejects.toThrow('Failed to create wallet');
    });
  });

  describe('resetAllStuckSyncFlags', () => {
    it('should reset all stuck sync flags and return count', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 3 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(3);
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
    });

    it('should return 0 when no stuck wallets', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(0);
    });
  });

  describe('findStuckSyncing', () => {
    it('should find wallets with syncInProgress=true', async () => {
      const stuck = [{ id: 'w1', name: 'Wallet 1' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(stuck);

      const result = await walletRepository.findStuckSyncing();

      expect(result).toEqual(stuck);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        select: { id: true, name: true },
      });
    });

    it('should use custom select when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findStuckSyncing({ id: true, name: true, lastSyncedAt: true });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        select: { id: true, name: true, lastSyncedAt: true },
      });
    });
  });

  describe('findAllWithSelect', () => {
    it('should find all wallets with custom select', async () => {
      const wallets = [{ id: 'w1', name: 'Test' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findAllWithSelect({ id: true, name: true });

      expect(result).toEqual(wallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { id: true, name: true },
      });
    });

    it('should apply where filter when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findAllWithSelect(
        { id: true },
        { network: 'mainnet' }
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { network: 'mainnet' },
        select: { id: true },
      });
    });
  });

  describe('findByIdWithSelect', () => {
    it('should find wallet by ID with custom select', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'wallet-123', name: 'Test' });

      const result = await walletRepository.findByIdWithSelect('wallet-123', { id: true, name: true });

      expect(result).toEqual({ id: 'wallet-123', name: 'Test' });
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        select: { id: true, name: true },
      });
    });
  });

  describe('findAccessibleWithSelect', () => {
    it('should find accessible wallets with custom select', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([{ id: 'w1' }]);

      const result = await walletRepository.findAccessibleWithSelect(mockUserId, { id: true });

      expect(result).toEqual([{ id: 'w1' }]);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
        select: { id: true },
      });
    });

    it('should merge additionalWhere when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findAccessibleWithSelect(
        mockUserId,
        { id: true },
        { network: 'testnet' }
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ network: 'testnet' }),
        select: { id: true },
      });
    });
  });

  describe('findByIdWithEditAccess', () => {
    it('should find wallet where user is owner or signer', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findByIdWithEditAccess('wallet-123', mockUserId);

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          users: {
            some: {
              userId: mockUserId,
              role: { in: ['owner', 'signer'] },
            },
          },
        },
      });
    });
  });

  describe('findGroupRoleByMembership', () => {
    it('should return group role when found', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue({ groupRole: 'viewer' });

      const result = await walletRepository.findGroupRoleByMembership('wallet-123', mockUserId);

      expect(result).toBe('viewer');
    });

    it('should return null when no group membership', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findGroupRoleByMembership('wallet-123', mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('findNameById', () => {
    it('should return id and name', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'w1', name: 'Test' });

      const result = await walletRepository.findNameById('w1');

      expect(result).toEqual({ id: 'w1', name: 'Test' });
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'w1' },
        select: { id: true, name: true },
      });
    });
  });

  describe('findNetwork', () => {
    it('should return network string', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ network: 'mainnet' });

      const result = await walletRepository.findNetwork('w1');

      expect(result).toBe('mainnet');
    });

    it('should return null when wallet not found', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(null);

      const result = await walletRepository.findNetwork('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithAccessAndInclude', () => {
    it('should find wallet with access check and custom include', async () => {
      const walletWithTx = { ...mockWallet, transactions: [] };
      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithTx);

      const result = await walletRepository.findByIdWithAccessAndInclude(
        'wallet-123',
        mockUserId,
        { transactions: true }
      );

      expect(result).toEqual(walletWithTx);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { transactions: true },
      });
    });
  });

  describe('deleteById', () => {
    it('should delete a wallet by ID', async () => {
      (prisma.wallet.delete as Mock).mockResolvedValue(mockWallet);

      await walletRepository.deleteById('wallet-123');

      expect(prisma.wallet.delete).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
    });
  });

  describe('findByIdWithFullAccess', () => {
    it('should find wallet with full access check', async () => {
      const walletWithInclude = { ...mockWallet, users: [] };
      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithInclude);

      const result = await walletRepository.findByIdWithFullAccess(
        'wallet-123',
        mockUserId,
        { users: true }
      );

      expect(result).toEqual(walletWithInclude);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
        include: { users: true },
      });
    });
  });

  describe('findByUserIdWithInclude', () => {
    it('should find user wallets with include', async () => {
      const wallets = [{ ...mockWallet, addresses: [] }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdWithInclude(
        mockUserId,
        { addresses: true }
      );

      expect(result).toEqual(wallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
        include: { addresses: true },
        orderBy: undefined,
      });
    });

    it('should pass orderBy when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findByUserIdWithInclude(
        mockUserId,
        { addresses: true },
        { name: 'asc' }
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } })
      );
    });
  });
});
