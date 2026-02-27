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
const { mockBuildDescriptorFromDevices, mockLogWarn } = vi.hoisted(() => ({
  mockBuildDescriptorFromDevices: vi.fn(),
  mockLogWarn: vi.fn(),
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

// Import after mocks
import { createWallet } from '../../../src/services/wallet';

describe('Wallet Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
      fingerprint: 'abc12345',
    });
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
});
