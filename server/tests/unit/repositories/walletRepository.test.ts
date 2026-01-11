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
    },
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
});
