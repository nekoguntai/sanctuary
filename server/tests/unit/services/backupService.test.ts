/**
 * Backup Service Tests
 *
 * Tests for backup validation logic, serialization, and migration handling.
 * These tests focus on the validation and data transformation logic,
 * not actual database operations.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { sampleUsers, sampleWallets } from '../../fixtures/bitcoin';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock migration service
jest.mock('../../../src/services/migrationService', () => ({
  migrationService: {
    getSchemaVersion: jest.fn().mockResolvedValue(1),
  },
  getExpectedSchemaVersion: jest.fn().mockReturnValue(1),
}));

// Mock encryption
jest.mock('../../../src/utils/encryption', () => ({
  isEncrypted: jest.fn().mockReturnValue(false),
  decrypt: jest.fn().mockImplementation((v) => v),
}));

import { BackupService, SanctuaryBackup, BackupMeta } from '../../../src/services/backupService';

describe('BackupService', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('validateBackup', () => {
    const createValidBackup = (): SanctuaryBackup => ({
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { user: 1, wallet: 1 },
      },
      data: {
        user: [
          {
            id: 'user-1',
            username: 'admin',
            password: '$2a$10$hash',
            isAdmin: true,
            twoFactorEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        wallet: [],
        walletUser: [],
        device: [],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    });

    it('should validate a properly structured backup', async () => {
      const backup = createValidBackup();
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject backup without meta section', async () => {
      const backup = { data: {} };
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing meta section');
    });

    it('should reject backup without data section', async () => {
      const backup = { meta: { version: '1.0.0' } };
      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing data section');
    });

    it('should reject backup without version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).version;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing backup format version');
    });

    it('should reject backup without schema version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).schemaVersion;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Missing schema version');
    });

    it('should reject backup from future schema version', async () => {
      const backup = createValidBackup();
      backup.meta.schemaVersion = 999;

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('newer than current'))).toBe(true);
    });

    it('should reject backup without any users', async () => {
      const backup = createValidBackup();
      backup.data.user = [];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one user');
    });

    it('should reject backup without admin user', async () => {
      const backup = createValidBackup();
      backup.data.user = [
        {
          id: 'user-1',
          username: 'regular',
          password: '$2a$10$hash',
          isAdmin: false, // Not an admin
          twoFactorEnabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Backup must contain at least one admin user');
    });

    it('should detect referential integrity issues for devices', async () => {
      const backup = createValidBackup();
      backup.data.device = [
        {
          id: 'device-1',
          userId: 'nonexistent-user', // References non-existent user
          type: 'ledger',
          label: 'My Ledger',
          fingerprint: 'aabbccdd',
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('references non-existent user'))).toBe(true);
    });

    it('should detect referential integrity issues for walletUser', async () => {
      const backup = createValidBackup();
      backup.data.wallet = [
        {
          id: 'wallet-1',
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          createdAt: new Date().toISOString(),
        },
      ];
      backup.data.walletUser = [
        {
          walletId: 'nonexistent-wallet',
          userId: 'user-1',
          role: 'owner',
        },
      ];

      const result = await backupService.validateBackup(backup);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('references non-existent wallet'))).toBe(true);
    });

    it('should warn about missing tables', async () => {
      const backup = createValidBackup();
      delete (backup.data as any).label;

      const result = await backupService.validateBackup(backup);

      expect(result.warnings.some((w) => w.includes('Missing table'))).toBe(true);
    });

    it('should reject non-array table data', async () => {
      const backup = createValidBackup();
      (backup.data as any).wallet = 'not an array';

      // The validation currently doesn't catch this gracefully - it throws when
      // trying to .map() on non-array. This test documents current behavior.
      // In a future improvement, validation should catch this earlier.
      await expect(backupService.validateBackup(backup)).rejects.toThrow();
    });

    it('should include info in result', async () => {
      const backup = createValidBackup();
      const result = await backupService.validateBackup(backup);

      expect(result.info.createdAt).toBeDefined();
      expect(result.info.appVersion).toBe('0.4.0');
      expect(result.info.schemaVersion).toBe(1);
      expect(result.info.totalRecords).toBeGreaterThan(0);
      expect(result.info.tables.length).toBeGreaterThan(0);
    });

    it('should reject null input', async () => {
      const result = await backupService.validateBackup(null);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid backup format: not an object');
    });

    it('should reject non-object input', async () => {
      const result = await backupService.validateBackup('not an object');

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid backup format: not an object');
    });

    it('should warn about missing app version', async () => {
      const backup = createValidBackup();
      delete (backup.meta as any).appVersion;

      const result = await backupService.validateBackup(backup);

      expect(result.warnings).toContain('Missing app version');
    });
  });

  describe('getFormatVersion', () => {
    it('should return the current format version', () => {
      const version = backupService.getFormatVersion();

      expect(version).toBe('1.0.0');
    });
  });

  describe('createBackup', () => {
    beforeEach(() => {
      // Setup default mock returns for all tables
      // Using type assertion to access dynamic properties
      const client = mockPrismaClient as any;
      const tables = [
        'hardwareDeviceModel', 'systemSetting', 'nodeConfig', 'user', 'group',
        'groupMember', 'device', 'wallet', 'pushDevice', 'walletUser',
        'walletDevice', 'address', 'label', 'draftTransaction', 'transaction',
        'uTXO', 'transactionLabel', 'addressLabel', 'auditLog',
      ];

      tables.forEach((table) => {
        if (client[table]) {
          client[table].findMany.mockResolvedValue([]);
        }
      });

      // Return at least one admin user
      mockPrismaClient.user.findMany.mockResolvedValue([
        { ...sampleUsers.admin, id: 'admin-1' },
      ]);
    });

    it('should create backup with meta information', async () => {
      const backup = await backupService.createBackup('admin');

      expect(backup.meta).toBeDefined();
      expect(backup.meta.version).toBe('1.0.0');
      expect(backup.meta.createdBy).toBe('admin');
      expect(backup.meta.createdAt).toBeDefined();
      expect(backup.meta.includesCache).toBe(false);
    });

    it('should include description when provided', async () => {
      const backup = await backupService.createBackup('admin', {
        description: 'Pre-upgrade backup',
      });

      expect(backup.meta.description).toBe('Pre-upgrade backup');
    });

    it('should include record counts', async () => {
      mockPrismaClient.user.findMany.mockResolvedValue([
        { ...sampleUsers.admin, id: 'admin-1' },
        { ...sampleUsers.regularUser, id: 'user-1' },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.meta.recordCounts.user).toBe(2);
    });

    it('should serialize BigInt values', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          id: 'utxo-1',
          txid: 'abc123',
          vout: 0,
          amount: BigInt(1000000),
        },
      ]);

      const backup = await backupService.createBackup('admin');

      const utxoData = backup.data.uTXO[0];
      expect(utxoData.amount).toBe('__bigint__1000000');
    });

    it('should serialize Date values as ISO strings', async () => {
      const testDate = new Date('2024-01-15T10:30:00Z');
      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          ...sampleUsers.admin,
          id: 'admin-1',
          createdAt: testDate,
        },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.user[0].createdAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle tables that fail to export', async () => {
      mockPrismaClient.wallet.findMany.mockRejectedValue(new Error('DB error'));

      const backup = await backupService.createBackup('admin');

      expect(backup.data.wallet).toEqual([]);
      expect(backup.meta.recordCounts.wallet).toBe(0);
    });
  });

  describe('serialization helpers', () => {
    it('should correctly handle nested objects with BigInt', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          amount: BigInt(500000),
          fee: BigInt(1000),
          nested: {
            value: BigInt(100),
          },
        },
      ]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.transaction[0].amount).toBe('__bigint__500000');
      expect(backup.data.transaction[0].fee).toBe('__bigint__1000');
      expect(backup.data.transaction[0].nested.value).toBe('__bigint__100');
    });
  });
});

describe('Backup Data Structure', () => {
  describe('BigInt serialization format', () => {
    it('should use __bigint__ prefix for identification', () => {
      const marker = '__bigint__';
      const value = '12345';
      const serialized = `${marker}${value}`;

      expect(serialized.startsWith(marker)).toBe(true);
      expect(serialized.replace(marker, '')).toBe(value);
    });
  });

  describe('Date serialization format', () => {
    it('should use ISO 8601 format', () => {
      const date = new Date('2024-06-15T14:30:00Z');
      const serialized = date.toISOString();

      expect(serialized).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});

describe('Backup Validation Edge Cases', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
  });

  it('should handle backup with only required tables', async () => {
    const minimalBackup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: { user: 1 },
      },
      data: {
        user: [
          {
            id: 'user-1',
            username: 'admin',
            isAdmin: true,
          },
        ],
        // Other tables are empty arrays or missing
        wallet: [],
        device: [],
        walletUser: [],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    const result = await backupService.validateBackup(minimalBackup);

    expect(result.valid).toBe(true);
  });

  it('should count total records correctly', async () => {
    const backup = {
      meta: {
        version: '1.0.0',
        appVersion: '0.4.0',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        includesCache: false,
        recordCounts: {},
      },
      data: {
        user: [
          { id: 'u1', username: 'admin', isAdmin: true },
          { id: 'u2', username: 'user2', isAdmin: false },
        ],
        wallet: [
          { id: 'w1', name: 'Wallet 1' },
          { id: 'w2', name: 'Wallet 2' },
          { id: 'w3', name: 'Wallet 3' },
        ],
        device: [],
        walletUser: [{ walletId: 'w1', userId: 'u1', role: 'owner' }],
        walletDevice: [],
        address: [],
        transaction: [],
        uTXO: [],
        label: [],
        transactionLabel: [],
        addressLabel: [],
        group: [],
        groupMember: [],
        nodeConfig: [],
        systemSetting: [],
        auditLog: [],
        hardwareDeviceModel: [],
        pushDevice: [],
        draftTransaction: [],
      },
    };

    const result = await backupService.validateBackup(backup);

    expect(result.info.totalRecords).toBe(6); // 2 users + 3 wallets + 1 walletUser
  });
});
