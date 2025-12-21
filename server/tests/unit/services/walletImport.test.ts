/**
 * Wallet Import Service Unit Tests
 *
 * Tests for the wallet import service that handles importing wallets from
 * various formats: output descriptors, JSON configurations, BlueWallet text,
 * Coldcard JSON, and Sanctuary exports.
 *
 * Coverage includes:
 * - Descriptor parsing (wpkh, wsh, tr, multisig)
 * - Device fingerprint extraction
 * - BlueWallet format import
 * - Coldcard JSON import
 * - Sanctuary export import
 * - Duplicate detection
 * - Validation
 * - Database operations
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import * as walletImport from '../../../src/services/walletImport';
import type { ParsedDescriptor, Network, ScriptType } from '../../../src/services/bitcoin/descriptorParser';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock descriptor parser
const mockParseImportInput = jest.fn();
const mockParseDescriptorForImport = jest.fn();
const mockParseJsonImport = jest.fn();
const mockValidateDescriptor = jest.fn();
const mockValidateJsonImport = jest.fn();

jest.mock('../../../src/services/bitcoin/descriptorParser', () => ({
  parseImportInput: (...args: any[]) => mockParseImportInput(...args),
  parseDescriptorForImport: (...args: any[]) => mockParseDescriptorForImport(...args),
  parseJsonImport: (...args: any[]) => mockParseJsonImport(...args),
  validateDescriptor: (...args: any[]) => mockValidateDescriptor(...args),
  validateJsonImport: (...args: any[]) => mockValidateJsonImport(...args),
}));

// Mock descriptor builder
const mockBuildDescriptorFromDevices = jest.fn();
jest.mock('../../../src/services/bitcoin/descriptorBuilder', () => ({
  buildDescriptorFromDevices: (...args: any[]) => mockBuildDescriptorFromDevices(...args),
}));

// Mock address derivation
const mockDeriveAddressFromDescriptor = jest.fn();
jest.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: (...args: any[]) => mockDeriveAddressFromDescriptor(...args),
}));

describe('Wallet Import Service', () => {
  const userId = 'user-123';

  // Helper to setup device mocks for import tests
  const setupDeviceMocks = (devices: any[], existingDevices: any[] = []) => {
    // First call: check for existing devices before import
    mockPrismaClient.device.findMany.mockResolvedValueOnce(existingDevices);

    // Setup device creation mocks
    devices.forEach(device => {
      mockPrismaClient.device.create.mockResolvedValueOnce(device);
    });

    // Second call: lookup created/reused devices in transaction
    const allDevices = [...existingDevices, ...devices];
    mockPrismaClient.device.findMany.mockResolvedValueOnce(allDevices);
  };

  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();

    // Default mock implementations
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
      fingerprint: 'wallet-fp',
    });

    mockDeriveAddressFromDescriptor.mockImplementation((descriptor, index, opts) => ({
      address: `bc1q${index}address${opts.change ? 'change' : 'receive'}`,
      derivationPath: `m/84'/0'/0'/${opts.change ? 1 : 0}/${index}`,
    }));

    // Reset device.findMany to return empty array by default (for both outside and inside transaction)
  });

  describe('validateImport', () => {
    describe('Descriptor Import Validation', () => {
      it('should validate wpkh (native segwit) descriptor', async () => {
        const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz8PGZuAKKWdmNnKVVR3fFKPxPNaPXpNLhU6fKwC3Qh9U8jv7r5w2ZQRX1tYkGdBN35p1HsLPZxwUJp9L8yN4tVd4rPqvKtJ5mFYA9VqG6/0/*)#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6Dz8PGZuAKKWdmNnKVVR3fFKPxPNaPXpNLhU6fKwC3Qh9U8jv7r5w2ZQRX1tYkGdBN35p1HsLPZxwUJp9L8yN4tVd4rPqvKtJ5mFYA9VqG6',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('descriptor');
        expect(result.walletType).toBe('single_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.network).toBe('mainnet');
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].fingerprint).toBe('abcd1234');
        expect(result.devices[0].willCreate).toBe(true);
      });

      it('should validate wsh multisig descriptor', async () => {
        const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'multi_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'aaaa1111',
                xpub: 'xpub6E1...',
                derivationPath: "m/48'/0'/0'/2'",
              },
              {
                fingerprint: 'bbbb2222',
                xpub: 'xpub6E2...',
                derivationPath: "m/48'/0'/0'/2'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
            quorum: 2,
            totalSigners: 2,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.walletType).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
        expect(result.devices).toHaveLength(2);
      });

      it('should validate taproot (tr) descriptor', async () => {
        const descriptor = "tr([abcd1234/86'/0'/0']xpub6T...)#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'taproot',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6T...',
                derivationPath: "m/86'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.scriptType).toBe('taproot');
      });

      it('should validate nested segwit (sh(wpkh)) descriptor', async () => {
        const descriptor = "sh(wpkh([abcd1234/49'/0'/0']xpub6N...))#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'nested_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6N...',
                derivationPath: "m/49'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });


        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.scriptType).toBe('nested_segwit');
      });

      it('should detect existing devices by fingerprint', async () => {
        const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

        mockParseImportInput.mockReturnValue({
          format: 'descriptor',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6Dz...',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
        });

        // Mock existing device with matching fingerprint
        mockPrismaClient.device.findMany.mockResolvedValue([
          {
            id: 'device-001',
            fingerprint: 'abcd1234',
            label: 'Existing Ledger',
            xpub: 'xpub6Dz...',
          },
        ]);

        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(true);
        expect(result.devices).toHaveLength(1);
        expect(result.devices[0].willCreate).toBe(false);
        expect(result.devices[0].existingDeviceId).toBe('device-001');
        expect(result.devices[0].existingDeviceLabel).toBe('Existing Ledger');
      });

      it('should reject invalid descriptor', async () => {
        const descriptor = "invalid descriptor format";

        mockParseImportInput.mockImplementation(() => {
          throw new Error('Unable to detect script type from descriptor');
        });

        const result = await walletImport.validateImport(userId, { descriptor });

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Unable to detect script type from descriptor');
      });

      it('should handle missing input', async () => {
        const result = await walletImport.validateImport(userId, {});

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Either descriptor or json must be provided');
      });
    });

    describe('BlueWallet Format Import Validation', () => {
      it('should validate BlueWallet multisig text format', async () => {
        const bluewalletText = `# BlueWallet Multisig setup file
Name: My 2-of-3 Vault
Policy: 2 of 3
Derivation: m/48'/0'/0'/2'
Format: P2WSH

aaaa1111: xpub6E1...
bbbb2222: xpub6E2...
cccc3333: xpub6E3...`;

        mockParseImportInput.mockReturnValue({
          format: 'bluewallet_text',
          parsed: {
            type: 'multi_sig',
            scriptType: 'native_segwit',
            devices: [
              { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
              { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
              { fingerprint: 'cccc3333', xpub: 'xpub6E3...', derivationPath: "m/48'/0'/0'/2'" },
            ],
            network: 'mainnet' as Network,
            isChange: false,
            quorum: 2,
            totalSigners: 3,
          },
          suggestedName: 'My 2-of-3 Vault',
        });


        const result = await walletImport.validateImport(userId, { json: bluewalletText });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('bluewallet_text');
        expect(result.walletType).toBe('multi_sig');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(3);
        expect(result.suggestedName).toBe('My 2-of-3 Vault');
      });
    });

    describe('Coldcard JSON Import Validation', () => {
      it('should validate Coldcard JSON export', async () => {
        const coldcardJson = JSON.stringify({
          xfp: 'ABCD1234',
          chain: 'BTC',
          bip84: {
            xpub: 'xpub6D...',
            deriv: "m/84'/0'/0'",
            name: 'Native Segwit',
          },
          bip49: {
            xpub: 'xpub6N...',
            deriv: "m/49'/0'/0'",
            name: 'Nested Segwit',
          },
          bip44: {
            xpub: 'xpub6L...',
            deriv: "m/44'/0'/0'",
            name: 'Legacy',
          },
        });

        mockParseImportInput.mockReturnValue({
          format: 'coldcard',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6D...',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          availablePaths: [
            { scriptType: 'native_segwit', path: "m/84'/0'/0'" },
            { scriptType: 'nested_segwit', path: "m/49'/0'/0'" },
            { scriptType: 'legacy', path: "m/44'/0'/0'" },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: coldcardJson });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('coldcard');
        expect(result.scriptType).toBe('native_segwit');
      });
    });

    describe('Sanctuary Export Import Validation', () => {
      it('should validate Sanctuary wallet export format', async () => {
        const sanctuaryExport = JSON.stringify({
          label: 'My Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum",
          blockheight: 800000,
        });

        mockParseImportInput.mockReturnValue({
          format: 'wallet_export',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6Dz...',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          suggestedName: 'My Wallet',
        });


        const result = await walletImport.validateImport(userId, { json: sanctuaryExport });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('wallet_export');
        expect(result.suggestedName).toBe('My Wallet');
      });
    });

    describe('JSON Configuration Import Validation', () => {
      it('should validate custom JSON configuration', async () => {
        const jsonConfig = JSON.stringify({
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          devices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'abcd1234',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6Dz...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              {
                fingerprint: 'abcd1234',
                xpub: 'xpub6Dz...',
                derivationPath: "m/84'/0'/0'",
              },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          originalDevices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'abcd1234',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6Dz...',
            },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.format).toBe('json');
        expect(result.devices[0].suggestedLabel).toBe('My Ledger');
        expect(result.devices[0].originalType).toBe('ledger');
      });

      it('should generate unique labels for duplicate device names', async () => {
        const jsonConfig = JSON.stringify({
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          devices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'aaaa1111',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E1...',
            },
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'bbbb2222',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E2...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
          parsed: {
            type: 'multi_sig',
            scriptType: 'native_segwit',
            devices: [
              { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
              { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
            ],
            network: 'mainnet' as Network,
            isChange: false,
            quorum: 2,
            totalSigners: 2,
          },
          originalDevices: [
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'aaaa1111',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E1...',
            },
            {
              type: 'trezor',
              label: 'Trezor',
              fingerprint: 'bbbb2222',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub6E2...',
            },
          ],
        });


        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.devices).toHaveLength(2);
        expect(result.devices[0].suggestedLabel).toBe('Trezor');
        expect(result.devices[1].suggestedLabel).toBe('Trezor (2)');
      });

      it('should avoid conflicts with existing device labels', async () => {
        const jsonConfig = JSON.stringify({
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'aaaa1111',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E1...',
            },
          ],
        });

        mockParseImportInput.mockReturnValue({
          format: 'json',
          parsed: {
            type: 'single_sig',
            scriptType: 'native_segwit',
            devices: [
              { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/84'/0'/0'" },
            ],
            network: 'mainnet' as Network,
            isChange: false,
          },
          originalDevices: [
            {
              type: 'ledger',
              label: 'My Ledger',
              fingerprint: 'aaaa1111',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub6E1...',
            },
          ],
        });

        // Mock existing device with same label but different fingerprint
        mockPrismaClient.device.findMany.mockResolvedValue([
          {
            id: 'device-001',
            fingerprint: 'bbbb2222',
            label: 'My Ledger',
            xpub: 'xpub6Different...',
          },
        ]);

        const result = await walletImport.validateImport(userId, { json: jsonConfig });

        expect(result.valid).toBe(true);
        expect(result.devices[0].suggestedLabel).toBe('My Ledger (2)');
      });
    });
  });

  describe('importFromDescriptor', () => {
    it('should import single-sig wallet from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'abcd1234',
              xpub: 'xpub6Dz...',
              derivationPath: "m/84'/0'/0'",
            },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const createdDevice = {
        id: 'device-new-001',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      // Setup mocks
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([createdDevice]);

      // Mock wallet creation
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-001',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      expect(result.wallet.id).toBe('wallet-001');
      expect(result.wallet.name).toBe('Test Wallet');
      expect(result.wallet.type).toBe('single_sig');
      expect(result.devicesCreated).toBe(1);
      expect(result.devicesReused).toBe(0);
      expect(result.createdDeviceIds).toEqual(['device-new-001']);

      // Verify wallet was created
      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'mainnet',
          }),
        })
      );

      // Verify addresses were generated (20 receive + 20 change)
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ address: expect.stringContaining('receive') }),
            expect.objectContaining({ address: expect.stringContaining('change') }),
          ]),
        })
      );
    });

    it('should import multisig wallet from descriptor', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks(devices);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-001',
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Vault',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.wallet.totalSigners).toBe(2);
      expect(result.devicesCreated).toBe(2);
      expect(result.devicesReused).toBe(0);
    });

    it('should reuse existing device when fingerprint matches', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      // Mock existing device with matching fingerprint
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-001',
          userId,
          fingerprint: 'abcd1234',
          label: 'Existing Ledger',
          xpub: 'xpub6Dz...',
          derivationPath: "m/84'/0'/0'",
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-002',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-001']);
      expect(mockPrismaClient.device.create).not.toHaveBeenCalled();
    });

    it('should use custom device labels when provided', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const device = {
        id: 'device-003',
        userId,
        type: 'unknown',
        label: 'My Custom Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-003',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
        deviceLabels: {
          abcd1234: 'My Custom Ledger',
        },
      });

      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'My Custom Ledger',
          }),
        })
      );
    });

    it('should detect duplicate wallet by device fingerprints', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });


      // Mock existing wallet with same device fingerprint
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      await expect(
        walletImport.importFromDescriptor(userId, {
          descriptor,
          name: 'Duplicate Wallet',
        })
      ).rejects.toThrow('A wallet with these devices already exists: "Existing Wallet"');
    });

    it('should allow same device in different wallet configurations', async () => {
      const descriptor = "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpub6E1..., [efef5678/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'efef5678', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });


      // Mock existing wallet with only one of the devices (different configuration)
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-single',
          name: 'Single Sig Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'efef5678',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[abcd1234/48h/0h/0h/2h]xpub6E1..., [efef5678/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      expect(result.wallet.id).toBe('wallet-multisig');
      expect(result.devicesCreated).toBe(2);
    });

    it('should override network if specified', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/1h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
        network: 'testnet',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            network: 'testnet',
          }),
        })
      );
    });
  });

  describe('importFromJson', () => {
    it('should import wallet from JSON configuration', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'ledger',
            label: 'My Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });


      const device = {
        id: 'device-json-001',
        userId,
        type: 'ledger',
        label: 'My Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-001',
        name: 'JSON Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Wallet',
      });

      expect(result.wallet.id).toBe('wallet-json-001');
      expect(result.devicesCreated).toBe(1);

      // Verify device was created with proper type and label
      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ledger',
            label: 'My Ledger',
          }),
        })
      );
    });

    it('should handle multisig JSON configuration', async () => {
      const jsonConfig = {
        type: 'multi_sig',
        scriptType: 'native_segwit',
        quorum: 2,
        network: 'mainnet',
        devices: [
          {
            type: 'trezor',
            label: 'Trezor 1',
            fingerprint: 'aaaa1111',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E1...',
          },
          {
            type: 'ledger',
            label: 'Ledger 1',
            fingerprint: 'bbbb2222',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E2...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'multi_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
          { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
        quorum: 2,
        totalSigners: 2,
      });


      const devices = [
        {
          id: 'device-trezor',
          userId,
          type: 'trezor',
          label: 'Trezor 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-ledger',
          userId,
          type: 'ledger',
          label: 'Ledger 1',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-json',
        name: 'JSON Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Multisig',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(2);
    });

    it('should throw on invalid JSON', async () => {
      await expect(
        walletImport.importFromJson(userId, {
          json: 'not valid json {{{',
          name: 'Invalid',
        })
      ).rejects.toThrow();
    });
  });

  describe('importWallet (auto-detect)', () => {
    it('should auto-detect and import from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-auto',
        name: 'Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: descriptor,
        name: 'Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-auto');
    });

    it('should auto-detect and import from BlueWallet text', async () => {
      const bluewalletText = `# BlueWallet Multisig setup file
Name: My Vault
Policy: 2 of 3
Format: P2WSH

aaaa1111: xpub6E1...
bbbb2222: xpub6E2...
cccc3333: xpub6E3...`;

      mockParseImportInput.mockReturnValue({
        format: 'bluewallet_text',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'cccc3333', xpub: 'xpub6E3...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 3,
        },
        suggestedName: 'My Vault',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const devices = [
        { id: 'dev1', userId, type: 'unknown', label: 'Imported Device 1', fingerprint: 'aaaa1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E1...' },
        { id: 'dev2', userId, type: 'unknown', label: 'Imported Device 2', fingerprint: 'bbbb2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E2...' },
        { id: 'dev3', userId, type: 'unknown', label: 'Imported Device 3', fingerprint: 'cccc3333', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E3...' },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-bluewallet',
        name: 'BlueWallet Import',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2..., [cccc3333/48h/0h/0h/2h]xpub6E3...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: bluewalletText,
        name: 'BlueWallet Import',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(3);
    });

    it('should auto-detect and import from Coldcard JSON', async () => {
      const coldcardJson = JSON.stringify({
        xfp: 'ABCD1234',
        chain: 'BTC',
        bip84: {
          xpub: 'xpub6D...',
          deriv: "m/84'/0'/0'",
        },
      });

      mockParseImportInput.mockReturnValue({
        format: 'coldcard',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6D...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-coldcard',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6D...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-coldcard',
        name: 'Coldcard Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6D...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: coldcardJson,
        name: 'Coldcard Import',
      });

      expect(result.wallet.id).toBe('wallet-coldcard');
    });

    it('should auto-detect and import from wallet export format', async () => {
      const walletExport = JSON.stringify({
        label: 'Exported Wallet',
        descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        blockheight: 800000,
      });

      mockParseImportInput.mockReturnValue({
        format: 'wallet_export',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
        suggestedName: 'Exported Wallet',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-export',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-export',
        name: 'Export Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: walletExport,
        name: 'Export Import',
      });

      expect(result.wallet.id).toBe('wallet-export');
    });

    it('should auto-detect and import from custom JSON config', async () => {
      const jsonConfig = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      const parsedResult = {
        type: 'single_sig' as const,
        scriptType: 'native_segwit' as ScriptType,
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      };

      mockParseImportInput.mockReturnValue({
        format: 'json',
        parsed: parsedResult,
        originalDevices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      // Also mock parseJsonImport which is called by importFromJson
      mockParseJsonImport.mockReturnValue(parsedResult);

      const device = {
        id: 'device-json-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-auto',
        name: 'JSON Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: jsonConfig,
        name: 'JSON Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-json-auto');
    });
  });

  describe('Database Operations', () => {
    it('should create wallet-device associations with correct signer indexes', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const devices = [
        { id: 'dev1', userId, type: 'unknown', label: 'Device 1', fingerprint: 'aaaa1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E1...' },
        { id: 'dev2', userId, type: 'unknown', label: 'Device 2', fingerprint: 'bbbb2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E2...' },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-assoc',
        name: 'Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig',
      });

      expect(mockPrismaClient.walletDevice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              walletId: 'wallet-assoc',
              deviceId: 'dev1',
              signerIndex: 0,
            }),
            expect.objectContaining({
              walletId: 'wallet-assoc',
              deviceId: 'dev2',
              signerIndex: 1,
            }),
          ],
        })
      );
    });

    it('should generate initial addresses for receive and change chains', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-addr',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-addr',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Verify address generation was called
      const addressCreateCall = mockPrismaClient.address.createMany.mock.calls[0][0];
      expect(addressCreateCall.data).toHaveLength(40); // 20 receive + 20 change

      // Verify receive addresses
      const receiveAddresses = addressCreateCall.data.filter((a: any) =>
        a.address.includes('receive')
      );
      expect(receiveAddresses).toHaveLength(20);

      // Verify change addresses
      const changeAddresses = addressCreateCall.data.filter((a: any) =>
        a.address.includes('change')
      );
      expect(changeAddresses).toHaveLength(20);
    });

    it('should handle address generation failure gracefully', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-fail',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-fail',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      // Mock address derivation to throw error
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed');
      });

      // Should not throw, just log error
      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      expect(result.wallet.id).toBe('wallet-fail');
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should execute import in transaction', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-tx',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-tx',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Verify transaction was used
      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle case-insensitive fingerprint matching', async () => {
      const descriptor = "wpkh([ABCD1234/84'/0'/0']xpub6Dz...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      // Existing device with uppercase fingerprint
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-upper',
          fingerprint: 'ABCD1234',
          label: 'Existing',
          xpub: 'xpub6Dz...',
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-case',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test',
      });

      // Should reuse existing device (case-insensitive match)
      expect(result.devicesReused).toBe(1);
      expect(result.devicesCreated).toBe(0);
    });

    it('should handle testnet network', async () => {
      const descriptor = "wpkh([abcd1234/84'/1'/0']tpub6D...)#checksum";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'tpub6D...', derivationPath: "m/84'/1'/0'" },
          ],
          network: 'testnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Device',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/1'/0'",
        xpub: 'tpub6D...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: null,
        totalSigners: null,
        descriptor: "wpkh([abcd1234/84h/1h/0h]tpub6D...)",
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            network: 'testnet',
          }),
        })
      );
    });
  });
});
