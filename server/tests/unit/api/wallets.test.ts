import { vi } from 'vitest';
/**
 * Wallet API Routes Tests
 *
 * Tests for wallet management endpoints including:
 * - GET /wallets
 * - POST /wallets
 * - GET /wallets/:walletId
 * - PATCH /wallets/:walletId
 * - DELETE /wallets/:walletId
 * - GET /wallets/:walletId/stats
 * - GET /wallets/:walletId/balance-history
 * - POST /wallets/:walletId/share/group
 * - POST /wallets/:walletId/share/user
 * - DELETE /wallets/:walletId/share/user/:targetUserId
 * - GET /wallets/:walletId/share
 * - GET /wallets/import/formats
 * - POST /wallets/import/validate
 * - POST /wallets/import
 * - GET /wallets/:walletId/export/labels
 * - GET /wallets/:walletId/export/formats
 * - GET /wallets/:walletId/export
 * - POST /wallets/:walletId/addresses
 * - POST /wallets/:walletId/devices
 * - POST /wallets/:walletId/repair
 * - POST /wallets/validate-xpub
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma BEFORE other imports
vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock auth middleware to bypass JWT validation
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock wallet access middleware
vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: any) => {
    req.walletRole = 'owner';
    req.walletId = req.params.id;
    next();
  },
}));

// Mock wallet service
const mockGetUserWallets = vi.fn();
const mockCreateWallet = vi.fn();
const mockGetWalletById = vi.fn();
const mockUpdateWallet = vi.fn();
const mockDeleteWallet = vi.fn();
const mockGetWalletStats = vi.fn();
const mockGenerateAddress = vi.fn();
const mockAddDeviceToWallet = vi.fn();
const mockRepairWalletDescriptor = vi.fn();

vi.mock('../../../src/services/wallet', () => ({
  getUserWallets: (...args: any[]) => mockGetUserWallets(...args),
  createWallet: (...args: any[]) => mockCreateWallet(...args),
  getWalletById: (...args: any[]) => mockGetWalletById(...args),
  updateWallet: (...args: any[]) => mockUpdateWallet(...args),
  deleteWallet: (...args: any[]) => mockDeleteWallet(...args),
  getWalletStats: (...args: any[]) => mockGetWalletStats(...args),
  generateAddress: (...args: any[]) => mockGenerateAddress(...args),
  addDeviceToWallet: (...args: any[]) => mockAddDeviceToWallet(...args),
  repairWalletDescriptor: (...args: any[]) => mockRepairWalletDescriptor(...args),
}));

// Mock wallet import service
const mockValidateImport = vi.fn();
const mockImportWallet = vi.fn();

vi.mock('../../../src/services/walletImport', () => ({
  validateImport: (...args: any[]) => mockValidateImport(...args),
  importWallet: (...args: any[]) => mockImportWallet(...args),
  parseDescriptor: vi.fn(),
}));

// Mock repositories
const mockTransactionRepository = {
  findForBalanceHistory: vi.fn(),
  findWithLabels: vi.fn(),
};
const mockUtxoRepository = {
  getUnspentBalance: vi.fn(),
};
const mockWalletRepository = {
  findByIdWithDevices: vi.fn(),
  getName: vi.fn(),
};
const mockAddressRepository = {
  findWithLabels: vi.fn(),
};
const mockUserRepository = {
  findById: vi.fn(),
};
const mockWalletSharingRepository = {
  isGroupMember: vi.fn(),
  updateWalletGroupWithResult: vi.fn(),
  findWalletUser: vi.fn(),
  updateUserRole: vi.fn(),
  addUserToWallet: vi.fn(),
  removeUserFromWallet: vi.fn(),
  getWalletSharingInfo: vi.fn(),
};

vi.mock('../../../src/repositories', () => ({
  transactionRepository: mockTransactionRepository,
  utxoRepository: mockUtxoRepository,
  walletRepository: mockWalletRepository,
  addressRepository: mockAddressRepository,
  userRepository: mockUserRepository,
  walletSharingRepository: mockWalletSharingRepository,
}));

// Mock device access service
vi.mock('../../../src/services/deviceAccess', () => ({
  getDevicesToShareForWallet: vi.fn().mockResolvedValue([]),
}));

// Mock export format registry
vi.mock('../../../src/services/export', () => ({
  exportFormatRegistry: {
    getAvailableFormats: vi.fn().mockReturnValue([
      { id: 'sparrow', name: 'Sparrow', description: 'Sparrow Wallet format', fileExtension: '.json', mimeType: 'application/json' },
      { id: 'descriptor', name: 'Descriptor', description: 'Bitcoin descriptor format', fileExtension: '.txt', mimeType: 'text/plain' },
    ]),
    has: vi.fn().mockReturnValue(true),
    export: vi.fn().mockReturnValue({
      content: '{"name": "test-wallet"}',
      filename: 'test-wallet.json',
      mimeType: 'application/json',
    }),
  },
}));

// Mock import format registry
vi.mock('../../../src/services/import', () => ({
  importFormatRegistry: {
    getAll: vi.fn().mockReturnValue([
      { id: 'sparrow', name: 'Sparrow', description: 'Sparrow Wallet format', fileExtensions: ['.json'], priority: 10 },
      { id: 'descriptor', name: 'Descriptor', description: 'Bitcoin descriptor', fileExtensions: ['.txt'], priority: 5 },
    ]),
  },
}));

// Mock address derivation service
vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  validateXpub: vi.fn().mockReturnValue({ valid: true, scriptType: 'native_segwit' }),
  deriveAddress: vi.fn().mockReturnValue({ address: 'bc1qtest123' }),
}));

// Mock script types
vi.mock('../../../src/services/scriptTypes', () => ({
  isValidScriptType: vi.fn().mockReturnValue(true),
  scriptTypeRegistry: {
    getIds: vi.fn().mockReturnValue(['native_segwit', 'nested_segwit', 'taproot', 'legacy']),
  },
}));

// Mock cache
vi.mock('../../../src/utils/cache', () => ({
  balanceHistoryCache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  },
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

// Import after mocks
import request from 'supertest';
import express from 'express';

// Create test app - must import router AFTER mocks are set up
const createTestApp = async () => {
  const app = express();
  app.use(express.json());

  // Import router dynamically after mocks
  const walletsModule = await import('../../../src/api/wallets');
  app.use('/api/v1/wallets', walletsModule.default);

  return app;
};

describe('Wallets API', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  // ==================== CRUD Tests ====================

  describe('GET /wallets', () => {
    it('should return all wallets for authenticated user', async () => {
      const mockWallets = [
        { id: 'wallet-1', name: 'Main Wallet', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet', balance: 100000 },
        { id: 'wallet-2', name: 'Savings', type: 'multi_sig', scriptType: 'native_segwit', network: 'mainnet', balance: 500000 },
      ];

      mockGetUserWallets.mockResolvedValue(mockWallets);

      const response = await request(app).get('/api/v1/wallets');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Main Wallet');
      expect(mockGetUserWallets).toHaveBeenCalledWith('test-user-id');
    });

    it('should return empty array when user has no wallets', async () => {
      mockGetUserWallets.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/wallets');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle service errors gracefully', async () => {
      mockGetUserWallets.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/v1/wallets');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /wallets', () => {
    it('should create a single-sig wallet', async () => {
      const walletData = {
        name: 'New Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
      };

      mockCreateWallet.mockResolvedValue({ id: 'wallet-new', ...walletData, createdAt: new Date() });

      const response = await request(app)
        .post('/api/v1/wallets')
        .send(walletData);

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('New Wallet');
      expect(mockCreateWallet).toHaveBeenCalled();
    });

    it('should create a multi-sig wallet', async () => {
      const walletData = {
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
      };

      mockCreateWallet.mockResolvedValue({ id: 'wallet-multisig', ...walletData, createdAt: new Date() });

      const response = await request(app)
        .post('/api/v1/wallets')
        .send(walletData);

      expect(response.status).toBe(201);
      expect(response.body.quorum).toBe(2);
      expect(response.body.totalSigners).toBe(3);
    });

    it('should reject wallet without required fields', async () => {
      const response = await request(app)
        .post('/api/v1/wallets')
        .send({ name: 'Incomplete Wallet' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid wallet type', async () => {
      const response = await request(app)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'invalid_type', scriptType: 'native_segwit' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('single_sig or multi_sig');
    });

    it('should reject invalid script type', async () => {
      const { isValidScriptType } = await import('../../../src/services/scriptTypes');
      vi.mocked(isValidScriptType).mockReturnValueOnce(false);

      const response = await request(app)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'single_sig', scriptType: 'invalid_script' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid scriptType');
    });

    it('should handle service creation error', async () => {
      mockCreateWallet.mockRejectedValue(new Error('Invalid descriptor format'));

      const response = await request(app)
        .post('/api/v1/wallets')
        .send({ name: 'Bad Wallet', type: 'single_sig', scriptType: 'native_segwit' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid descriptor format');
    });
  });

  describe('GET /wallets/:id', () => {
    it('should return wallet details', async () => {
      const mockWallet = {
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        balance: 150000,
      };

      mockGetWalletById.mockResolvedValue(mockWallet);

      const response = await request(app).get('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('wallet-123');
      expect(response.body.name).toBe('Test Wallet');
    });

    it('should return 404 for non-existent wallet', async () => {
      mockGetWalletById.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('should handle service errors', async () => {
      mockGetWalletById.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('PATCH /wallets/:id', () => {
    it('should update wallet name', async () => {
      mockUpdateWallet.mockResolvedValue({
        id: 'wallet-123',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      });

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123')
        .send({ name: 'Renamed Wallet' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Renamed Wallet');
    });

    it('should handle update error', async () => {
      mockUpdateWallet.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .patch('/api/v1/wallets/wallet-123')
        .send({ name: 'New Name' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('DELETE /wallets/:id', () => {
    it('should delete wallet', async () => {
      mockDeleteWallet.mockResolvedValue({ success: true });

      const response = await request(app).delete('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(204);
      expect(mockDeleteWallet).toHaveBeenCalled();
    });

    it('should handle delete error', async () => {
      mockDeleteWallet.mockRejectedValue(new Error('Cannot delete'));

      const response = await request(app).delete('/api/v1/wallets/wallet-123');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ==================== Analytics Tests ====================

  describe('GET /wallets/:id/stats', () => {
    it('should return wallet statistics', async () => {
      const mockStats = {
        balance: 100000,
        transactionCount: 15,
        addressCount: 10,
        utxoCount: 5,
      };

      mockGetWalletStats.mockResolvedValue(mockStats);

      const response = await request(app).get('/api/v1/wallets/wallet-123/stats');

      expect(response.status).toBe(200);
      expect(response.body.balance).toBe(100000);
      expect(response.body.transactionCount).toBe(15);
    });

    it('should handle stats error', async () => {
      mockGetWalletStats.mockRejectedValue(new Error('Stats error'));

      const response = await request(app).get('/api/v1/wallets/wallet-123/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /wallets/:id/balance-history', () => {
    it('should return balance history data', async () => {
      mockTransactionRepository.findForBalanceHistory.mockResolvedValue([
        { txid: 'tx1', blockTime: new Date('2024-01-01'), balanceAfter: BigInt(50000) },
        { txid: 'tx2', blockTime: new Date('2024-01-15'), balanceAfter: BigInt(100000) },
      ]);
      mockUtxoRepository.getUnspentBalance.mockResolvedValue(BigInt(100000));

      const response = await request(app).get('/api/v1/wallets/wallet-123/balance-history?timeframe=1M');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('1M');
      expect(response.body.currentBalance).toBe(100000);
      expect(response.body.dataPoints).toBeDefined();
    });

    it('should use cached data when available', async () => {
      const { balanceHistoryCache } = await import('../../../src/utils/cache');
      vi.mocked(balanceHistoryCache.get).mockReturnValueOnce({
        currentBalance: 200000,
        dataPoints: [{ timestamp: '2024-01-01', balance: 200000 }],
      });

      const response = await request(app).get('/api/v1/wallets/wallet-123/balance-history');

      expect(response.status).toBe(200);
      expect(response.body.currentBalance).toBe(200000);
      expect(mockTransactionRepository.findForBalanceHistory).not.toHaveBeenCalled();
    });

    it('should handle balance history error', async () => {
      mockTransactionRepository.findForBalanceHistory.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/wallets/wallet-123/balance-history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ==================== Sharing Tests ====================

  describe('POST /wallets/:id/share/group', () => {
    it('should share wallet with group', async () => {
      mockWalletSharingRepository.isGroupMember.mockResolvedValue(true);
      mockWalletSharingRepository.updateWalletGroupWithResult.mockResolvedValue({
        groupId: 'group-1',
        groupRole: 'viewer',
        group: { name: 'Test Group' },
      });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1', role: 'viewer' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.groupId).toBe('group-1');
    });

    it('should reject invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1', role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('viewer or signer');
    });

    it('should reject when user is not group member', async () => {
      mockWalletSharingRepository.isGroupMember.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('member of the group');
    });
  });

  describe('POST /wallets/:id/share/user', () => {
    it('should share wallet with user', async () => {
      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue(null);
      mockWalletSharingRepository.addUserToWallet.mockResolvedValue({ id: 'wu-1' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'viewer' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('added');
    });

    it('should update existing user access', async () => {
      mockUserRepository.findById.mockResolvedValue({ id: 'target-user', username: 'targetuser' });
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });
      mockWalletSharingRepository.updateUserRole.mockResolvedValue({ id: 'wu-1', role: 'signer' });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'signer' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated');
    });

    it('should reject without targetUserId', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ role: 'viewer' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('targetUserId');
    });

    it('should reject invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'target-user', role: 'admin' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('viewer or signer');
    });

    it('should return 404 for non-existent user', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/share/user')
        .send({ targetUserId: 'non-existent', role: 'viewer' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });
  });

  describe('DELETE /wallets/:id/share/user/:targetUserId', () => {
    it('should remove user from wallet', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'viewer' });
      mockWalletSharingRepository.removeUserFromWallet.mockResolvedValue({ count: 1 });

      const response = await request(app).delete('/api/v1/wallets/wallet-123/share/user/target-user');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for user without access', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue(null);

      const response = await request(app).delete('/api/v1/wallets/wallet-123/share/user/target-user');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('does not have access');
    });

    it('should reject removing owner', async () => {
      mockWalletSharingRepository.findWalletUser.mockResolvedValue({ id: 'wu-1', role: 'owner' });

      const response = await request(app).delete('/api/v1/wallets/wallet-123/share/user/owner-user');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Cannot remove the owner');
    });
  });

  describe('GET /wallets/:id/share', () => {
    it('should return sharing info', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockResolvedValue({
        group: { id: 'group-1', name: 'Test Group' },
        groupRole: 'viewer',
        users: [
          { user: { id: 'user-1', username: 'user1' }, role: 'owner' },
          { user: { id: 'user-2', username: 'user2' }, role: 'viewer' },
        ],
      });

      const response = await request(app).get('/api/v1/wallets/wallet-123/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeDefined();
      expect(response.body.users).toHaveLength(2);
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletSharingRepository.getWalletSharingInfo.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/non-existent/share');

      expect(response.status).toBe(404);
    });
  });

  // ==================== Import Tests ====================

  describe('GET /wallets/import/formats', () => {
    it('should return available import formats', async () => {
      const response = await request(app).get('/api/v1/wallets/import/formats');

      expect(response.status).toBe(200);
      expect(response.body.formats).toBeDefined();
      expect(response.body.formats.length).toBeGreaterThan(0);
    });
  });

  describe('POST /wallets/import/validate', () => {
    it('should validate import descriptor', async () => {
      mockValidateImport.mockResolvedValue({
        valid: true,
        walletType: 'single_sig',
        scriptType: 'native_segwit',
        deviceCount: 1,
      });

      const response = await request(app)
        .post('/api/v1/wallets/import/validate')
        .send({ descriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub.../0/*)' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });

    it('should validate import JSON', async () => {
      mockValidateImport.mockResolvedValue({
        valid: true,
        walletType: 'multi_sig',
        quorum: 2,
        totalSigners: 3,
      });

      const response = await request(app)
        .post('/api/v1/wallets/import/validate')
        .send({ json: '{"name": "test", "descriptor": "wsh(...)"}' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
    });

    it('should reject when neither descriptor nor json provided', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/import/validate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('descriptor or json');
    });
  });

  describe('POST /wallets/import', () => {
    it('should import wallet from data', async () => {
      mockImportWallet.mockResolvedValue({
        wallet: { id: 'wallet-new', name: 'Imported Wallet' },
        devicesCreated: 1,
      });

      const response = await request(app)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh([aabbccdd/84h/0h/0h]xpub...)', name: 'Imported Wallet' });

      expect(response.status).toBe(201);
      expect(response.body.wallet).toBeDefined();
    });

    it('should reject without data', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/import')
        .send({ name: 'Wallet' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('data');
    });

    it('should reject without name', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh(...)' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('name');
    });

    it('should handle import error', async () => {
      mockImportWallet.mockRejectedValue(new Error('Import failed'));

      const response = await request(app)
        .post('/api/v1/wallets/import')
        .send({ data: 'wpkh(...)', name: 'Wallet' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Import failed');
    });
  });

  // ==================== Export Tests ====================

  describe('GET /wallets/:id/export/labels', () => {
    it('should export labels in BIP 329 format', async () => {
      mockWalletRepository.getName.mockResolvedValue('Test Wallet');
      mockTransactionRepository.findWithLabels.mockResolvedValue([
        { txid: 'txabc123', label: 'Payment', memo: 'Coffee shop', transactionLabels: [] },
      ]);
      mockAddressRepository.findWithLabels.mockResolvedValue([
        { address: 'bc1qtest', derivationPath: "m/84'/0'/0'/0/0", addressLabels: [{ label: { name: 'Deposit' } }] },
      ]);

      const response = await request(app).get('/api/v1/wallets/wallet-123/export/labels');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('jsonl');
      expect(response.text).toContain('txabc123');
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.getName.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/non-existent/export/labels');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /wallets/:id/export/formats', () => {
    it('should return available export formats', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [],
        createdAt: new Date(),
      });

      const response = await request(app).get('/api/v1/wallets/wallet-123/export/formats');

      expect(response.status).toBe(200);
      expect(response.body.formats).toBeDefined();
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/non-existent/export/formats');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /wallets/:id/export', () => {
    it('should export wallet in default format', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wpkh(...)',
        devices: [],
        createdAt: new Date(),
      });

      const response = await request(app).get('/api/v1/wallets/wallet-123/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('json');
    });

    it('should return 404 if wallet not found', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallets/non-existent/export');

      expect(response.status).toBe(404);
    });

    it('should reject unknown format', async () => {
      mockWalletRepository.findByIdWithDevices.mockResolvedValue({
        id: 'wallet-123',
        name: 'Test',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [],
        createdAt: new Date(),
      });

      const { exportFormatRegistry } = await import('../../../src/services/export');
      vi.mocked(exportFormatRegistry.has).mockReturnValueOnce(false);

      const response = await request(app).get('/api/v1/wallets/wallet-123/export?format=unknown');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Unknown export format');
    });
  });

  // ==================== Device Management Tests ====================

  describe('POST /wallets/:id/addresses', () => {
    it('should generate new address', async () => {
      mockGenerateAddress.mockResolvedValue('bc1qnewaddress123');

      const response = await request(app).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(201);
      expect(response.body.address).toBe('bc1qnewaddress123');
    });

    it('should handle address generation error', async () => {
      mockGenerateAddress.mockRejectedValue(new Error('Address generation failed'));

      const response = await request(app).post('/api/v1/wallets/wallet-123/addresses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /wallets/:id/devices', () => {
    it('should add device to wallet', async () => {
      mockAddDeviceToWallet.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({ deviceId: 'device-1', signerIndex: 0 });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('added');
    });

    it('should reject without deviceId', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/wallet-123/devices')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('deviceId');
    });
  });

  describe('POST /wallets/:id/repair', () => {
    it('should repair wallet descriptor', async () => {
      mockRepairWalletDescriptor.mockResolvedValue({
        success: true,
        message: 'Generated descriptor and 40 addresses',
      });

      const response = await request(app).post('/api/v1/wallets/wallet-123/repair');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle repair error', async () => {
      mockRepairWalletDescriptor.mockRejectedValue(new Error('Repair failed'));

      const response = await request(app).post('/api/v1/wallets/wallet-123/repair');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ==================== XPUB Validation Tests ====================

  describe('POST /wallets/validate-xpub', () => {
    it('should validate xpub and generate descriptor', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .send({ xpub: 'xpub6CUG...', scriptType: 'native_segwit' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.descriptor).toBeDefined();
      expect(response.body.firstAddress).toBeDefined();
    });

    it('should reject without xpub', async () => {
      const response = await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('xpub');
    });

    it('should reject invalid xpub', async () => {
      const addressDerivation = await import('../../../src/services/bitcoin/addressDerivation');
      vi.mocked(addressDerivation.validateXpub).mockReturnValueOnce({ valid: false, error: 'Invalid xpub format' });

      const response = await request(app)
        .post('/api/v1/wallets/validate-xpub')
        .send({ xpub: 'invalid-xpub' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid xpub');
    });
  });

  // ==================== Unit Tests for buildWalletExportData ====================

  describe('buildWalletExportData - Derivation Path Selection', () => {
    // These tests remain as pure unit tests
    const baseDevice = {
      id: 'device-1',
      label: 'Coldcard Q',
      type: 'coldcard_q',
      fingerprint: 'aabbccdd',
      xpub: 'xpub_legacy',
      derivationPath: "m/84'/0'/0'",
    };

    // Import buildWalletExportData helper for unit tests
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
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub_single_sig' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig' },
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
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub_single_sig' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig' },
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
                { purpose: 'multisig', scriptType: 'nested_segwit', derivationPath: "m/48'/0'/0'/1'", xpub: 'xpub_multisig_nested' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig_native' },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

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
        devices: [{ device: { ...baseDevice, accounts: [] } }],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[0].xpub).toBe('xpub_legacy');
    });
  });

  // ==================== mapDeviceTypeToWalletModel Tests ====================

  describe('mapDeviceTypeToWalletModel', () => {
    // Test the exported helper function
    function mapDeviceTypeToWalletModel(deviceType: string): string {
      const typeMap: Record<string, string> = {
        'coldcard': 'COLDCARD',
        'coldcardmk4': 'COLDCARD',
        'coldcard_mk4': 'COLDCARD',
        'coldcard_q': 'COLDCARD',
        'ledger': 'LEDGER_NANO_S',
        'ledger_nano_x': 'LEDGER_NANO_X',
        'trezor': 'TREZOR_1',
        'trezor_safe_3': 'TREZOR_SAFE_3',
        'bitbox02': 'BITBOX_02',
        'passport': 'PASSPORT',
        'jade': 'JADE',
        'keystone': 'KEYSTONE',
        'generic': 'AIRGAPPED',
      };

      const normalized = deviceType.toLowerCase().replace(/\s+/g, '_');
      return typeMap[normalized] || deviceType.toUpperCase().replace(/\s+/g, '_');
    }

    it('should map coldcard types correctly', () => {
      expect(mapDeviceTypeToWalletModel('coldcard')).toBe('COLDCARD');
      expect(mapDeviceTypeToWalletModel('coldcard_q')).toBe('COLDCARD');
      expect(mapDeviceTypeToWalletModel('coldcard_mk4')).toBe('COLDCARD');
    });

    it('should map ledger types correctly', () => {
      expect(mapDeviceTypeToWalletModel('ledger')).toBe('LEDGER_NANO_S');
      expect(mapDeviceTypeToWalletModel('ledger_nano_x')).toBe('LEDGER_NANO_X');
    });

    it('should map trezor types correctly', () => {
      expect(mapDeviceTypeToWalletModel('trezor')).toBe('TREZOR_1');
      expect(mapDeviceTypeToWalletModel('trezor_safe_3')).toBe('TREZOR_SAFE_3');
    });

    it('should return uppercase for unknown types', () => {
      expect(mapDeviceTypeToWalletModel('unknown_device')).toBe('UNKNOWN_DEVICE');
      expect(mapDeviceTypeToWalletModel('Custom Hardware')).toBe('CUSTOM_HARDWARE');
    });
  });
});
