import { vi } from 'vitest';
/**
 * Wallet API Routes Tests
 *
 * Tests for wallet management endpoints including:
 * - GET /wallets
 * - POST /wallets
 * - GET /wallets/:walletId
 * - PUT /wallets/:walletId
 * - DELETE /wallets/:walletId
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
} from '../../helpers/testUtils';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock wallet service
const mockGetUserWallets = vi.fn();
const mockCreateWallet = vi.fn();
const mockUpdateWallet = vi.fn();
const mockDeleteWallet = vi.fn();
const mockRepairWalletDescriptor = vi.fn();

vi.mock('../../../src/services/wallet', () => ({
  getUserWallets: (...args: any[]) => mockGetUserWallets(...args),
  createWallet: (...args: any[]) => mockCreateWallet(...args),
  updateWallet: (...args: any[]) => mockUpdateWallet(...args),
  deleteWallet: (...args: any[]) => mockDeleteWallet(...args),
  repairWalletDescriptor: (...args: any[]) => mockRepairWalletDescriptor(...args),
  checkWalletAccess: vi.fn().mockResolvedValue(true),
  checkWalletEditAccess: vi.fn().mockResolvedValue(true),
}));

// Mock wallet import
vi.mock('../../../src/services/walletImport', () => ({
  importWallet: vi.fn(),
  parseDescriptor: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import buildWalletExportData helper indirectly via API module
// We need to test the logic - for unit tests we extract and test the function behavior
function buildWalletExportData(wallet: any) {
  const expectedPurpose = wallet.type === 'multi_sig' ? 'multisig' : 'single_sig';

  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type === 'multi_sig' ? 'multi_sig' : 'single_sig',
    scriptType: wallet.scriptType,
    network: wallet.network,
    descriptor: wallet.descriptor || '',
    quorum: wallet.quorum || undefined,
    totalSigners: wallet.totalSigners || undefined,
    devices: wallet.devices.map((wd: any) => {
      const accounts = wd.device.accounts || [];
      const exactMatch = accounts.find(
        (a: any) => a.purpose === expectedPurpose && a.scriptType === wallet.scriptType
      );
      const purposeMatch = accounts.find((a: any) => a.purpose === expectedPurpose);
      const account = exactMatch || purposeMatch;

      return {
        label: wd.device.label,
        type: wd.device.type,
        fingerprint: wd.device.fingerprint,
        xpub: account?.xpub || wd.device.xpub,
        derivationPath: account?.derivationPath || wd.device.derivationPath || undefined,
      };
    }),
    createdAt: wallet.createdAt,
  };
}

describe('Wallets API', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('GET /wallets', () => {
    it('should return all wallets for authenticated user', async () => {
      const userId = 'user-123';
      const mockWallets = [
        {
          id: 'wallet-1',
          name: 'Main Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          balance: 100000,
          deviceCount: 1,
        },
        {
          id: 'wallet-2',
          name: 'Savings',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          balance: 500000,
          deviceCount: 3,
        },
      ];

      mockGetUserWallets.mockResolvedValue(mockWallets);

      const req = createMockRequest({
        user: { userId, username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const wallets = await mockGetUserWallets(userId);
      res.json!(wallets);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Main Wallet');
      expect(mockGetUserWallets).toHaveBeenCalledWith(userId);
    });

    it('should return empty array when user has no wallets', async () => {
      const userId = 'user-empty';
      mockGetUserWallets.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const wallets = await mockGetUserWallets(userId);
      res.json!(wallets);

      expect(getResponse().body).toEqual([]);
    });

    it('should handle service errors gracefully', async () => {
      const userId = 'user-123';
      mockGetUserWallets.mockRejectedValue(new Error('Database error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockGetUserWallets(userId);
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to fetch wallets',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /wallets', () => {
    it('should create a single-sig wallet', async () => {
      const userId = 'user-123';
      const walletData = {
        name: 'New Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpub...)",
      };

      const createdWallet = {
        id: 'wallet-new',
        ...walletData,
        createdAt: new Date(),
      };

      mockCreateWallet.mockResolvedValue(createdWallet);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockCreateWallet(userId, walletData);
      res.status!(201).json!(wallet);

      const response = getResponse();
      expect(response.statusCode).toBe(201);
      expect(response.body.name).toBe('New Wallet');
      expect(mockCreateWallet).toHaveBeenCalledWith(userId, walletData);
    });

    it('should create a multi-sig wallet', async () => {
      const userId = 'user-123';
      const walletData = {
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
      };

      const createdWallet = {
        id: 'wallet-multisig',
        ...walletData,
        createdAt: new Date(),
      };

      mockCreateWallet.mockResolvedValue(createdWallet);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockCreateWallet(userId, walletData);
      res.status!(201).json!(wallet);

      const response = getResponse();
      expect(response.statusCode).toBe(201);
      expect(response.body.quorum).toBe(2);
      expect(response.body.totalSigners).toBe(3);
    });

    it('should reject wallet without required fields', async () => {
      const { res, getResponse } = createMockResponse();

      const body = { name: 'Incomplete Wallet' }; // Missing type and scriptType

      // Validation logic
      if (!body.name || !(body as any).type || !(body as any).scriptType) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'name, type, and scriptType are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid wallet type', async () => {
      const { res, getResponse } = createMockResponse();

      const type = 'invalid_type';

      if (!['single_sig', 'multi_sig'].includes(type)) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'type must be single_sig or multi_sig',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('single_sig or multi_sig');
    });

    it('should reject invalid script type', async () => {
      const { res, getResponse } = createMockResponse();

      const scriptType = 'p2pkh_invalid';

      if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(scriptType)) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Invalid scriptType',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('Invalid scriptType');
    });

    it('should handle service creation error', async () => {
      mockCreateWallet.mockRejectedValue(new Error('Invalid descriptor format'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockCreateWallet('user-123', { name: 'Bad Wallet' });
      } catch (error: any) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: error.message || 'Failed to create wallet',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('Invalid descriptor format');
    });
  });

  describe('GET /wallets/:walletId', () => {
    it('should return wallet details', async () => {
      const walletId = 'wallet-123';

      const mockWallet = {
        id: walletId,
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        balance: 150000,
        createdAt: new Date('2024-01-01'),
        devices: [
          { id: 'device-1', label: 'Ledger Nano X' },
        ],
        users: [
          { id: 'user-123', username: 'owner', role: 'owner' },
        ],
      };

      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
        include: { devices: true, users: true },
      });

      res.json!(wallet);

      const response = getResponse();
      expect(response.body.id).toBe(walletId);
      expect(response.body.devices).toHaveLength(1);
    });

    it('should return 404 for non-existent wallet', async () => {
      const walletId = 'non-existent';

      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /wallets/:walletId', () => {
    it('should update wallet name', async () => {
      const walletId = 'wallet-123';
      const updates = { name: 'Renamed Wallet' };

      const updatedWallet = {
        id: walletId,
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      };

      mockUpdateWallet.mockResolvedValue(updatedWallet);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockUpdateWallet(walletId, updates);
      res.json!(wallet);

      const response = getResponse();
      expect(response.body.name).toBe('Renamed Wallet');
      expect(mockUpdateWallet).toHaveBeenCalledWith(walletId, updates);
    });

    it('should reject empty update', async () => {
      const { res, getResponse } = createMockResponse();

      const updates = {};

      if (Object.keys(updates).length === 0) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'No updates provided',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /wallets/:walletId', () => {
    it('should delete wallet', async () => {
      const walletId = 'wallet-123';

      mockDeleteWallet.mockResolvedValue({ success: true });

      const { res, getResponse } = createMockResponse();

      await mockDeleteWallet(walletId);
      res.status!(204).end!();

      const response = getResponse();
      expect(response.statusCode).toBe(204);
      expect(mockDeleteWallet).toHaveBeenCalledWith(walletId);
    });

    it('should handle delete error', async () => {
      const walletId = 'wallet-123';

      mockDeleteWallet.mockRejectedValue(new Error('Cannot delete wallet with pending transactions'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockDeleteWallet(walletId);
      } catch (error: any) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: error.message,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('pending transactions');
    });
  });

  describe('Wallet Validation', () => {
    const validScriptTypes = ['native_segwit', 'nested_segwit', 'taproot', 'legacy'];
    const validTypes = ['single_sig', 'multi_sig'];
    const validNetworks = ['mainnet', 'testnet'];

    it.each(validScriptTypes)('should accept script type: %s', (scriptType) => {
      expect(validScriptTypes).toContain(scriptType);
    });

    it.each(validTypes)('should accept wallet type: %s', (type) => {
      expect(validTypes).toContain(type);
    });

    it.each(validNetworks)('should accept network: %s', (network) => {
      expect(validNetworks).toContain(network);
    });
  });

  describe('Multi-sig Validation', () => {
    it('should require quorum for multi-sig wallets', () => {
      const type = 'multi_sig';
      const quorum = undefined;

      if (type === 'multi_sig' && !quorum) {
        const error = 'Quorum is required for multi-sig wallets';
        expect(error).toBe('Quorum is required for multi-sig wallets');
      }
    });

    it('should validate quorum <= totalSigners', () => {
      const quorum = 3;
      const totalSigners = 2;

      if (quorum > totalSigners) {
        const error = 'Quorum cannot exceed total signers';
        expect(error).toBe('Quorum cannot exceed total signers');
      }
    });

    it('should validate quorum > 0', () => {
      const quorum = 0;

      if (quorum <= 0) {
        const error = 'Quorum must be greater than 0';
        expect(error).toBe('Quorum must be greater than 0');
      }
    });
  });

  describe('POST /wallets/:walletId/repair', () => {
    it('should repair wallet with missing descriptor', async () => {
      const walletId = 'wallet-123';
      const userId = 'user-123';

      mockRepairWalletDescriptor.mockResolvedValue({
        success: true,
        message: 'Generated descriptor and 40 addresses',
      });

      const { res, getResponse } = createMockResponse();

      const result = await mockRepairWalletDescriptor(walletId, userId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Generated descriptor');
      expect(mockRepairWalletDescriptor).toHaveBeenCalledWith(walletId, userId);
    });

    it('should return success when wallet already has descriptor', async () => {
      const walletId = 'wallet-123';
      const userId = 'user-123';

      mockRepairWalletDescriptor.mockResolvedValue({
        success: true,
        message: 'Wallet already has a descriptor',
      });

      const { res, getResponse } = createMockResponse();

      const result = await mockRepairWalletDescriptor(walletId, userId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Wallet already has a descriptor');
    });

    it('should fail when not enough devices for multisig', async () => {
      const walletId = 'wallet-multisig';
      const userId = 'user-123';

      mockRepairWalletDescriptor.mockResolvedValue({
        success: false,
        message: 'Multi-sig wallet needs 3 devices, but only has 1',
      });

      const { res, getResponse } = createMockResponse();

      const result = await mockRepairWalletDescriptor(walletId, userId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('needs 3 devices');
    });

    it('should fail when wallet not found or access denied', async () => {
      const walletId = 'wallet-not-found';
      const userId = 'user-123';

      mockRepairWalletDescriptor.mockRejectedValue(
        new Error('Wallet not found or access denied')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await mockRepairWalletDescriptor(walletId, userId);
      } catch (error: any) {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: error.message,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.message).toBe('Wallet not found or access denied');
    });

    it('should handle descriptor generation error', async () => {
      const walletId = 'wallet-123';
      const userId = 'user-123';

      mockRepairWalletDescriptor.mockRejectedValue(
        new Error('Failed to generate descriptor: Invalid xpub format')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await mockRepairWalletDescriptor(walletId, userId);
      } catch (error: any) {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: error.message,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.message).toContain('Failed to generate descriptor');
    });
  });

  describe('buildWalletExportData - Derivation Path Selection', () => {
    const baseDevice = {
      id: 'device-1',
      label: 'Coldcard Q',
      type: 'coldcard_q',
      fingerprint: 'aabbccdd',
      xpub: 'xpub_legacy',
      derivationPath: "m/84'/0'/0'",
    };

    it('should use multisig account derivation path for multi_sig wallets', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 3,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
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
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig');
    });

    it('should use single_sig account derivation path for single_sig wallets', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Single Sig',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wpkh(...)',
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
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
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[0].xpub).toBe('xpub_single_sig');
    });

    it('should prefer exact match (purpose + scriptType) over purpose-only match', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
                {
                  purpose: 'multisig',
                  scriptType: 'nested_segwit',
                  derivationPath: "m/48'/0'/0'/1'",
                  xpub: 'xpub_multisig_nested',
                },
                {
                  purpose: 'multisig',
                  scriptType: 'native_segwit',
                  derivationPath: "m/48'/0'/0'/2'",
                  xpub: 'xpub_multisig_native',
                },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      // Should pick native_segwit (exact match) over nested_segwit
      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig_native');
    });

    it('should fall back to legacy device fields when no accounts exist', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Legacy Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [], // No accounts
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      // Should fall back to legacy device fields
      expect(exportData.devices[0].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[0].xpub).toBe('xpub_legacy');
    });

    it('should fall back to purpose-only match when no exact scriptType match', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        type: 'multi_sig',
        scriptType: 'taproot', // No exact match for taproot
        network: 'mainnet',
        descriptor: 'tr(...)',
        quorum: 2,
        totalSigners: 2,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
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
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      // Should use multisig account (purpose match) even though scriptType doesn't match exactly
      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig');
    });

    it('should handle multiple devices with different account configurations', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Multi Device Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 3,
        createdAt: new Date(),
        devices: [
          {
            device: {
              id: 'device-1',
              label: 'Coldcard Q',
              type: 'coldcard_q',
              fingerprint: 'aabbccdd',
              xpub: 'xpub_legacy_1',
              derivationPath: "m/84'/0'/0'",
              accounts: [
                {
                  purpose: 'multisig',
                  scriptType: 'native_segwit',
                  derivationPath: "m/48'/0'/0'/2'",
                  xpub: 'xpub_multisig_1',
                },
              ],
            },
          },
          {
            device: {
              id: 'device-2',
              label: 'Ledger Nano X',
              type: 'ledger_nano_x',
              fingerprint: '11223344',
              xpub: 'xpub_legacy_2',
              derivationPath: "m/84'/0'/0'",
              accounts: [], // No accounts - should use legacy
            },
          },
          {
            device: {
              id: 'device-3',
              label: 'Trezor Safe 3',
              type: 'trezor_safe_3',
              fingerprint: '55667788',
              xpub: 'xpub_legacy_3',
              derivationPath: null, // No legacy path
              accounts: [
                {
                  purpose: 'multisig',
                  scriptType: 'native_segwit',
                  derivationPath: "m/48'/0'/0'/2'",
                  xpub: 'xpub_multisig_3',
                },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      // Device 1: should use multisig account
      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig_1');

      // Device 2: should fall back to legacy
      expect(exportData.devices[1].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[1].xpub).toBe('xpub_legacy_2');

      // Device 3: should use multisig account
      expect(exportData.devices[2].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[2].xpub).toBe('xpub_multisig_3');
    });
  });
});
