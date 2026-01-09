import { vi } from 'vitest';
/**
 * Device API Routes Tests
 *
 * Tests for device management endpoints including:
 * - POST /devices (registration with accounts)
 * - GET /devices/:id/accounts
 * - POST /devices/:id/accounts
 * - DELETE /devices/:id/accounts/:accountId
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
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock device access middleware
vi.mock('../../../src/middleware/deviceAccess', () => ({
  requireDeviceAccess: () => (req: any, res: any, next: any) => {
    req.deviceRole = 'owner';
    req.deviceId = req.params.id;
    next();
  },
}));

// Mock device access service
vi.mock('../../../src/services/deviceAccess', () => ({
  getUserAccessibleDevices: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  checkDeviceOwnerAccess: vi.fn(),
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
  const devicesModule = await import('../../../src/api/devices');
  app.use('/api/v1/devices', devicesModule.default);

  return app;
};

describe('Devices API', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('POST /devices - Device Registration', () => {
    const validDevice = {
      type: 'trezor',
      label: 'My Trezor',
      fingerprint: 'abc12345',
      xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWV...',
      derivationPath: "m/84'/0'/0'",
    };

    it('should register device with single xpub (legacy mode)', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null); // No existing device
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-1',
        ...validDevice,
        userId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaClient.device.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'device-1',
        ...validDevice,
        userId: 'test-user-id',
        accounts: [{
          id: 'account-1',
          deviceId: 'device-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: validDevice.xpub,
        }],
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(validDevice);

      expect(response.status).toBe(201);
      expect(mockPrismaClient.device.create).toHaveBeenCalled();
      expect(mockPrismaClient.deviceUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: 'owner',
        }),
      });
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
        }),
      });
    });

    it('should register device with multiple accounts', async () => {
      const deviceWithAccounts = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_sig...',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-1',
        type: deviceWithAccounts.type,
        label: deviceWithAccounts.label,
        fingerprint: deviceWithAccounts.fingerprint,
        xpub: 'xpub_single_sig...',
        derivationPath: "m/84'/0'/0'",
        userId: 'test-user-id',
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithAccounts);

      expect(response.status).toBe(201);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledTimes(2);
    });

    it('should reject registration without xpub or accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('xpub or accounts');
    });

    it('should reject registration with invalid purpose in accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'invalid_purpose',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub...',
          },
        ],
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('purpose');
    });

    it('should reject registration with invalid scriptType in accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'invalid_script_type',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub...',
          },
        ],
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scriptType');
    });

    it('should return conflict response with comparison data for duplicate fingerprint', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        model: null,
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(validDevice);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.existingDevice).toBeDefined();
      expect(response.body.existingDevice.id).toBe('existing-device');
      expect(response.body.existingDevice.fingerprint).toBe('abc12345');
      expect(response.body.comparison).toBeDefined();
      expect(response.body.comparison.newAccounts).toBeDefined();
      expect(response.body.comparison.matchingAccounts).toBeDefined();
      expect(response.body.comparison.conflictingAccounts).toBeDefined();
    });

    it('should merge new accounts into existing device when merge=true', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      const deviceWithMerge = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_new_multisig...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'existing-device',
        ...deviceWithMerge.accounts[0],
      });
      // Mock the updated device fetch after merge
      mockPrismaClient.device.findUnique.mockResolvedValueOnce(existingDevice).mockResolvedValue({
        ...existingDevice,
        accounts: [
          ...existingDevice.accounts,
          { id: 'account-new', ...deviceWithMerge.accounts[0] },
        ],
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithMerge);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Added');
      expect(response.body.message).toContain('new account');
      expect(response.body.added).toBe(1);
      expect(response.body.device).toBeDefined();
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'existing-device',
          purpose: 'multisig',
          scriptType: 'native_segwit',
        }),
      });
    });

    it('should return 200 with added=0 when merging with no new accounts', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_same...',
          },
        ],
      };

      const deviceWithMerge = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_same...', // Same xpub as existing
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithMerge);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('already has all');
      expect(response.body.added).toBe(0);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should reject merge when there are conflicting xpubs (security)', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_original...',
          },
        ],
      };

      const deviceWithConflict = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_different...', // DIFFERENT xpub at same path - security issue!
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithConflict);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.message).toContain('conflicting');
      // When there are conflicting accounts, the merge is rejected with conflict details
      expect(response.body.existingDevice).toBeDefined();
      // Conflicting accounts are returned at top level for merge mode
      expect(response.body.conflictingAccounts).toHaveLength(1);
      expect(response.body.conflictingAccounts[0].incoming.derivationPath).toBe("m/84'/0'/0'");
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should detect duplicate device with different fingerprint case', async () => {
      // Device exists with lowercase fingerprint
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345', // lowercase in database
        label: 'Existing Device',
        type: 'trezor',
        userId: 'test-user-id',
        model: null,
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      // Incoming request has UPPERCASE fingerprint
      const deviceWithUpperCase = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'ABC12345', // UPPERCASE in request
        xpub: 'xpub_new...',
        derivationPath: "m/84'/0'/0'",
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithUpperCase);

      // Should detect as duplicate (409) not create new device (201)
      expect(response.status).toBe(409);
      expect(response.body.existingDevice.fingerprint).toBe('abc12345');

      // Verify the findUnique was called with lowercase fingerprint
      expect(mockPrismaClient.device.findUnique).toHaveBeenCalledWith({
        where: { fingerprint: 'abc12345' }, // Should be normalized to lowercase
        include: expect.any(Object),
      });
    });

    it('should detect multisig purpose from BIP-48 path in legacy mode', async () => {
      const multisigDevice = {
        type: 'coldcard',
        label: 'My ColdCard',
        fingerprint: 'def67890',
        xpub: 'xpub_multisig...',
        derivationPath: "m/48'/0'/0'/2'",
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-2',
        ...multisigDevice,
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(multisigDevice);

      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
        }),
      });
    });
  });

  describe('GET /devices/:id/accounts', () => {
    it('should return all accounts for a device', async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          deviceId: 'device-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub_single...',
        },
        {
          id: 'account-2',
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub_multi...',
        },
      ];

      mockPrismaClient.deviceAccount.findMany.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/v1/devices/device-1/accounts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].purpose).toBe('single_sig');
      expect(response.body[1].purpose).toBe('multisig');
    });
  });

  describe('POST /devices/:id/accounts', () => {
    const newAccount = {
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub_multisig...',
    };

    it('should add a new account to existing device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null); // No existing account
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'device-1',
        ...newAccount,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(201);
      expect(response.body.purpose).toBe('multisig');
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
        }),
      });
    });

    it('should reject duplicate derivation path', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'existing-account',
        deviceId: 'device-1',
        derivationPath: "m/48'/0'/0'/2'",
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject missing required fields', async () => {
      const incompleteAccount = {
        purpose: 'multisig',
        // Missing scriptType, derivationPath, xpub
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(incompleteAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid purpose', async () => {
      const invalidAccount = {
        ...newAccount,
        purpose: 'invalid',
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(invalidAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('purpose');
    });
  });

  describe('DELETE /devices/:id/accounts/:accountId', () => {
    it('should delete account from device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
        purpose: 'multisig',
        scriptType: 'native_segwit',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(2); // Has more than 1 account
      mockPrismaClient.deviceAccount.delete.mockResolvedValue({});

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(204);
      expect(mockPrismaClient.deviceAccount.delete).toHaveBeenCalledWith({
        where: { id: 'account-1' },
      });
    });

    it('should prevent deleting last account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(1); // Only 1 account

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('last account');
    });

    it('should return 404 for non-existent account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/non-existent');

      expect(response.status).toBe(404);
    });
  });
});
