import { vi } from 'vitest';
/**
 * Wallet Service Tests
 *
 * Tests for wallet service functions including:
 * - createWallet with device account selection
 * - Account selection based on wallet type and script type
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Hoist mock variables for use in vi.mock() factories
const {
  mockBuildDescriptorFromDevices,
  mockLogWarn,
  mockSyncUnsubscribeWalletAddresses,
  mockNotificationUnsubscribeWalletAddresses,
} = vi.hoisted(() => ({
  mockBuildDescriptorFromDevices: vi.fn(),
  mockLogWarn: vi.fn(),
  mockSyncUnsubscribeWalletAddresses: vi.fn(),
  mockNotificationUnsubscribeWalletAddresses: vi.fn(),
}));

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock descriptor builder
vi.mock('../../../src/services/bitcoin/descriptorBuilder', () => ({
  buildDescriptorFromDevices: (...args: any[]) => mockBuildDescriptorFromDevices(...args),
}));

// Mock address derivation
vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: vi.fn().mockReturnValue({
    address: 'bc1qmockaddress',
    derivationPath: "m/84'/0'/0'/0/0",
  }),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => ({
    unsubscribeWalletAddresses: mockSyncUnsubscribeWalletAddresses,
  }),
}));

vi.mock('../../../src/websocket/notifications', () => ({
  notificationService: {
    unsubscribeWalletAddresses: mockNotificationUnsubscribeWalletAddresses,
  },
}));

// Import after mocks
import {
  createWallet,
  getUserWalletRole,
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletAccessWithRole,
  getUserWallets,
  getWalletById,
  updateWallet,
  deleteWallet,
  addDeviceToWallet,
  generateAddress,
  repairWalletDescriptor,
  getWalletStats,
} from '../../../src/services/wallet';

describe('Wallet Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
      fingerprint: 'abc12345',
    });
    mockSyncUnsubscribeWalletAddresses.mockResolvedValue(undefined);
    mockNotificationUnsubscribeWalletAddresses.mockResolvedValue(undefined);
  });

  describe('createWallet - Account Selection', () => {
    const userId = 'test-user-id';

    // Helper to create mock device with accounts
    const createMockDevice = (
      id: string,
      fingerprint: string,
      accounts: Array<{
        purpose: string;
        scriptType: string;
        derivationPath: string;
        xpub: string;
      }>
    ) => ({
      id,
      userId,
      fingerprint,
      type: 'trezor',
      label: `Device ${id}`,
      xpub: accounts[0]?.xpub || 'legacy_xpub',
      derivationPath: accounts[0]?.derivationPath || "m/84'/0'/0'",
      accounts,
    });

    describe('Single-sig wallet creation', () => {
      it('should select single_sig account for single-sig wallet', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_sig',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Verify descriptor builder was called with single-sig xpub
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: 'abc12345',
              xpub: 'xpub_single_sig',
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should match scriptType when selecting account', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_native_segwit',
          },
          {
            purpose: 'single_sig',
            scriptType: 'taproot',
            derivationPath: "m/86'/0'/0'",
            xpub: 'xpub_taproot',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Taproot Wallet',
          type: 'single_sig',
          scriptType: 'taproot',
          deviceIds: ['device-1'],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'xpub_taproot',
              derivationPath: "m/86'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });
    });

    describe('Multi-sig wallet creation', () => {
      it('should select multisig account for multi-sig wallet', async () => {
        const device1 = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_1',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multi_1',
          },
        ]);

        const device2 = createMockDevice('device-2', 'def67890', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_2',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multi_2',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockBuildDescriptorFromDevices.mockReturnValue({
          descriptor: 'wsh(sortedmulti(2,[abc12345/48h/0h/0h/2h]xpub...,[def67890/48h/0h/0h/2h]xpub...))',
          fingerprint: 'abc12345',
        });
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 2,
          deviceIds: ['device-1', 'device-2'],
        });

        // Verify descriptor builder was called with multisig xpubs
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: 'abc12345',
              xpub: 'xpub_multi_1',
              derivationPath: "m/48'/0'/0'/2'",
            }),
            expect.objectContaining({
              fingerprint: 'def67890',
              xpub: 'xpub_multi_2',
              derivationPath: "m/48'/0'/0'/2'",
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should warn when using single-sig account for multisig wallet', async () => {
        // Device only has single-sig account
        const device1 = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_1',
          },
        ]);

        const device2 = createMockDevice('device-2', 'def67890', [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_2',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'MultiSig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 2,
          deviceIds: ['device-1', 'device-2'],
        });

        // Should log warning about using single-sig for multisig
        expect(mockLogWarn).toHaveBeenCalledWith(
          'Using single-sig account for multisig wallet - this may cause signing issues',
          expect.objectContaining({
            hint: expect.stringContaining('multisig account'),
          })
        );
      });
    });

    describe('Fallback behavior', () => {
      it('should fall back to first account when no matching purpose found', async () => {
        // Device only has multisig account but we're creating single-sig wallet
        const device = createMockDevice('device-1', 'abc12345', [
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig_only',
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Should log warning and use the available account
        expect(mockLogWarn).toHaveBeenCalledWith(
          'No matching account found for wallet type, using first account',
          expect.objectContaining({
            walletType: 'single_sig',
          })
        );

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'xpub_multisig_only',
            }),
          ]),
          expect.any(Object)
        );
      });

      it('should fall back to legacy device.xpub when no accounts exist', async () => {
        // Device has no accounts (legacy device)
        const legacyDevice = {
          id: 'device-1',
          userId,
          fingerprint: 'abc12345',
          type: 'trezor',
          label: 'Legacy Device',
          xpub: 'legacy_xpub',
          derivationPath: "m/84'/0'/0'",
          accounts: [], // No accounts
        };

        mockPrismaClient.device.findMany.mockResolvedValue([legacyDevice]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          deviceIds: ['device-1'],
        });

        // Should use legacy xpub from device
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: 'legacy_xpub',
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object)
        );
      });
    });

    describe('Validation', () => {
      it('should reject single-sig wallet with multiple devices', async () => {
        const device1 = createMockDevice('device-1', 'abc12345', [
          { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub1' },
        ]);
        const device2 = createMockDevice('device-2', 'def67890', [
          { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub2' },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);

        await expect(
          createWallet(userId, {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            deviceIds: ['device-1', 'device-2'],
          })
        ).rejects.toThrow('Single-sig wallet requires exactly 1 device');
      });

      it('should reject multi-sig wallet with single device', async () => {
        const device = createMockDevice('device-1', 'abc12345', [
          { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub1' },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);

        await expect(
          createWallet(userId, {
            name: 'MultiSig Wallet',
            type: 'multi_sig',
            scriptType: 'native_segwit',
            quorum: 2,
            totalSigners: 2,
            deviceIds: ['device-1'],
          })
        ).rejects.toThrow('Multi-sig wallet requires at least 2 devices');
      });

      it('should reject when device not found', async () => {
        mockPrismaClient.device.findMany.mockResolvedValue([]); // No devices found

        await expect(
          createWallet(userId, {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            deviceIds: ['non-existent-device'],
          })
        ).rejects.toThrow('Device not found');
      });
    });
  });

  describe('access helpers and wallet queries', () => {
    it('resolves direct, group, and missing wallet roles', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      await expect(getUserWalletRole('wallet-1', 'user-1')).resolves.toBe('owner');

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ groupRole: 'viewer' });
      await expect(getUserWalletRole('wallet-2', 'user-1')).resolves.toBe('viewer');

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getUserWalletRole('wallet-3', 'user-1')).resolves.toBeNull();
    });

    it('computes access booleans and role bundle', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'signer' });
      await expect(checkWalletAccess('wallet-1', 'user-1')).resolves.toBe(true);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'viewer' });
      await expect(checkWalletEditAccess('wallet-1', 'user-1')).resolves.toBe(false);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      await expect(checkWalletOwnerAccess('wallet-1', 'user-1')).resolves.toBe(true);

      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ groupRole: 'signer' });
      await expect(checkWalletAccessWithRole('wallet-1', 'user-1')).resolves.toEqual({
        hasAccess: true,
        canEdit: true,
        role: 'signer',
      });
    });

    it('returns empty list for user with no wallets', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([]);
      await expect(getUserWallets('user-empty')).resolves.toEqual([]);
    });

    it('maps wallet summaries with balances, sharing, and permissions', async () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet-owner',
          name: 'Owner Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: null,
          totalSigners: null,
          descriptor: 'desc-1',
          fingerprint: 'abcd1234',
          createdAt: now,
          devices: [{ id: 'd1' }],
          addresses: [{ id: 'a1' }, { id: 'a2' }],
          group: null,
          users: [{ userId: 'user-1', role: 'owner' }],
          groupRole: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          syncInProgress: false,
        },
        {
          id: 'wallet-group',
          name: 'Group Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          quorum: 2,
          totalSigners: 3,
          descriptor: 'desc-2',
          fingerprint: 'efgh5678',
          createdAt: now,
          devices: [{ id: 'd2' }, { id: 'd3' }],
          addresses: [{ id: 'a3' }],
          group: { name: 'Treasury' },
          users: [{ userId: 'owner-2', role: 'owner' }, { userId: 'owner-3', role: 'owner' }],
          groupRole: 'viewer',
          lastSyncedAt: now,
          lastSyncStatus: 'success',
          syncInProgress: false,
        },
      ]);
      mockPrismaClient.uTXO.groupBy.mockResolvedValueOnce([
        { walletId: 'wallet-owner', _sum: { amount: BigInt(1500) } },
        { walletId: 'wallet-group', _sum: { amount: BigInt(2500) } },
      ]);

      const results = await getUserWallets('user-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(expect.objectContaining({
        id: 'wallet-owner',
        balance: 1500,
        isShared: false,
        userRole: 'owner',
        canEdit: true,
      }));
      expect(results[1]).toEqual(expect.objectContaining({
        id: 'wallet-group',
        balance: 2500,
        isShared: true,
        userRole: 'viewer',
        canEdit: false,
        sharedWith: {
          groupName: 'Treasury',
          userCount: 2,
        },
      }));
    });

    it('returns null for inaccessible wallet and maps wallet detail when found', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getWalletById('wallet-missing', 'user-1')).resolves.toBeNull();

      const now = new Date('2025-01-01T00:00:00.000Z');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        name: 'Detail Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd',
        createdAt: now,
        devices: [{ id: 'wd1', device: { id: 'd1' } }],
        addresses: [{ id: 'a1', index: 0 }],
        users: [{ userId: 'user-1', role: 'signer', user: { id: 'user-1', username: 'alice' } }],
        group: { name: 'Ops', members: [{ role: 'viewer' }] },
        groupRole: 'viewer',
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        syncInProgress: false,
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(4321) } });

      const wallet = await getWalletById('wallet-1', 'user-1');

      expect(wallet).toEqual(expect.objectContaining({
        id: 'wallet-1',
        balance: 4321,
        userRole: 'signer',
        canEdit: true,
        isShared: true,
      }));
    });
  });

  describe('wallet mutation and maintenance operations', () => {
    it('updates wallet metadata for owners and returns computed fields', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce({
        id: 'wallet-1',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd1234',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        devices: [{ id: 'd1' }],
        addresses: [{ id: 'a1' }, { id: 'a2' }],
        group: { name: 'Treasury' },
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(9876) } });

      const updated = await updateWallet('wallet-1', 'owner-1', { name: 'Renamed Wallet' });

      expect(updated.balance).toBe(9876);
      expect(updated.deviceCount).toBe(1);
      expect(updated.addressCount).toBe(2);
      expect(updated.isShared).toBe(true);
    });

    it('rejects update for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(updateWallet('wallet-1', 'viewer-1', { name: 'Nope' })).rejects.toThrow('Only wallet owners can update wallet');
    });

    it('deletes wallet after unsubscribing realtime listeners', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });

      await deleteWallet('wallet-1', 'owner-1');

      expect(mockSyncUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockNotificationUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockPrismaClient.wallet.delete).toHaveBeenCalledWith({ where: { id: 'wallet-1' } });
    });

    it('rejects delete for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(deleteWallet('wallet-1', 'viewer-1')).rejects.toThrow('Only wallet owners can delete wallet');
    });

    it('links a device and regenerates descriptor when requirements are met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await addDeviceToWallet('wallet-1', 'device-1', 'user-1', 0);

      expect(mockPrismaClient.walletDevice.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          deviceId: 'device-1',
          signerIndex: 0,
        },
      });
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
          fingerprint: 'abc12345',
        },
      });
    });

    it('still links device when descriptor generation fails', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet('wallet-1', 'device-1', 'user-1')).resolves.toBeUndefined();
      expect(mockPrismaClient.walletDevice.create).toHaveBeenCalled();
    });
  });

  describe('address generation and descriptor repair', () => {
    it('generates the next receive address from descriptor', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: 'wpkh(mock)',
        addresses: [{ index: 4 }],
      });

      const address = await generateAddress('wallet-1', 'user-1');

      expect(address).toBe('bc1qmockaddress');
      expect(mockPrismaClient.address.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          address: 'bc1qmockaddress',
          derivationPath: "m/84'/0'/0'/0/0",
          index: 5,
          used: false,
        },
      });
    });

    it('rejects address generation when descriptor is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: null,
        addresses: [],
      });

      await expect(generateAddress('wallet-1', 'user-1')).rejects.toThrow('Wallet does not have a descriptor');
    });

    it('returns already-repaired message when descriptor exists', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'already-there',
        devices: [],
      });

      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).resolves.toEqual({
        success: true,
        message: 'Wallet already has a descriptor',
      });
    });

    it('returns validation failure when multisig lacks required devices', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [{ device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/48'/0'/0'/2'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('needs 3 devices');
    });

    it('repairs descriptor and bulk-creates initial addresses', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'aabbccdd', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Generated descriptor');
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          skipDuplicates: true,
        })
      );
    });
  });

  describe('wallet stats aggregation', () => {
    it('returns aggregate wallet stats for authorized users', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-1' });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(12000) } });
      mockPrismaClient.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(45000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(17000) } });
      mockPrismaClient.transaction.count.mockResolvedValueOnce(12);
      mockPrismaClient.uTXO.count.mockResolvedValueOnce(4);
      mockPrismaClient.address.count.mockResolvedValueOnce(8);

      const stats = await getWalletStats('wallet-1', 'user-1');

      expect(stats).toEqual({
        balance: 12000,
        received: 45000,
        sent: 17000,
        transactionCount: 12,
        utxoCount: 4,
        addressCount: 8,
      });
    });

    it('throws when wallet is not accessible to user', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getWalletStats('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });
  });
});
