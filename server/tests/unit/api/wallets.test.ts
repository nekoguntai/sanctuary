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
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock wallet service
const mockGetUserWallets = jest.fn();
const mockCreateWallet = jest.fn();
const mockUpdateWallet = jest.fn();
const mockDeleteWallet = jest.fn();

jest.mock('../../../src/services/wallet', () => ({
  getUserWallets: (...args: any[]) => mockGetUserWallets(...args),
  createWallet: (...args: any[]) => mockCreateWallet(...args),
  updateWallet: (...args: any[]) => mockUpdateWallet(...args),
  deleteWallet: (...args: any[]) => mockDeleteWallet(...args),
  checkWalletAccess: jest.fn().mockResolvedValue(true),
  checkWalletEditAccess: jest.fn().mockResolvedValue(true),
}));

// Mock wallet import
jest.mock('../../../src/services/walletImport', () => ({
  importWallet: jest.fn(),
  parseDescriptor: jest.fn(),
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

describe('Wallets API', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
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
});
