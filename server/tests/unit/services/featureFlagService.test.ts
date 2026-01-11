/**
 * Feature Flag Service Tests
 *
 * Tests for the feature flag service including:
 * - Service initialization
 * - Flag state checking (isEnabled)
 * - Flag updates with audit logging
 * - Cache behavior
 * - Bulk operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist all mocks
const { mockPrisma, mockCache, mockConfig } = vi.hoisted(() => {
  const mockPrisma = {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    featureFlagAudit: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn((queries: any[]) => Promise.all(queries)),
  };

  const mockCache = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  const mockConfig = {
    features: {
      hardwareWalletSigning: true,
      qrCodeSigning: true,
      multisigWallets: true,
      batchSync: false,
      payjoinSupport: false,
      batchTransactions: true,
      rbfTransactions: true,
      priceAlerts: false,
      aiAssistant: false,
      telegramNotifications: false,
      websocketV2Events: true,
      experimental: {
        taprootAddresses: false,
        silentPayments: false,
        coinJoin: false,
      },
    },
  };

  return { mockPrisma, mockCache, mockConfig };
});

// Mock dependencies
vi.mock('../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('../../../src/infrastructure', () => ({
  getDistributedCache: () => mockCache,
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => mockConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { featureFlagService } from '../../../src/services/featureFlagService';

describe('Feature Flag Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset service state by clearing local cache
    (featureFlagService as any).localCache = new Map();
    (featureFlagService as any).initialized = false;
  });

  describe('initialize', () => {
    it('should sync environment flags to database', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'test', enabled: true });
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();

      // Should check for each environment flag
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalled();
      // Should create flags that don't exist
      expect(mockPrisma.featureFlag.create).toHaveBeenCalled();
    });

    it('should not recreate existing flags', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        id: '1',
        key: 'hardwareWalletSigning',
        enabled: true,
      });
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'hardwareWalletSigning', enabled: true },
      ]);

      await featureFlagService.initialize();

      // Should not create since flag exists
      const createCalls = mockPrisma.featureFlag.create.mock.calls.filter(
        (call: any) => call[0]?.data?.key === 'hardwareWalletSigning'
      );
      expect(createCalls.length).toBe(0);
    });

    it('should load flags into local cache after init', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ id: '1', key: 'test', enabled: true });
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { key: 'hardwareWalletSigning', enabled: true },
        { key: 'aiAssistant', enabled: false },
      ]);

      await featureFlagService.initialize();

      // Local cache should be populated
      expect((featureFlagService as any).localCache.get('hardwareWalletSigning')).toBe(true);
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(false);
    });

    it('should only initialize once', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.initialize();
      const firstCallCount = mockPrisma.featureFlag.findMany.mock.calls.length;

      await featureFlagService.initialize();
      const secondCallCount = mockPrisma.featureFlag.findMany.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount); // No additional calls
    });

    it('should handle initialization errors gracefully', async () => {
      mockPrisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(featureFlagService.initialize()).resolves.toBeUndefined();

      // Service should still be marked as initialized (fallback mode)
      expect((featureFlagService as any).initialized).toBe(true);
    });
  });

  describe('isEnabled', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should return value from local cache if available', async () => {
      (featureFlagService as any).localCache.set('hardwareWalletSigning', true);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).not.toHaveBeenCalled(); // Didn't need distributed cache
    });

    it('should check distributed cache if local cache misses', async () => {
      mockCache.get.mockResolvedValue({
        hardwareWalletSigning: true,
        aiAssistant: false,
      });

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalled();
    });

    it('should query database if cache misses', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
      });

      const result = await featureFlagService.isEnabled('aiAssistant');

      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
      });
    });

    it('should fall back to environment config if database misses', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      // Should return env default
      expect(result).toBe(true);
    });

    it('should handle experimental flags in environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('experimental.taprootAddresses');

      expect(result).toBe(false); // From mockConfig
    });
  });

  describe('setFlag', () => {
    const mockExistingFlag = {
      id: 'flag-1',
      key: 'aiAssistant',
      enabled: false,
      description: 'AI assistant feature',
      category: 'general',
      modifiedBy: 'system',
      updatedAt: new Date(),
    };

    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update flag and create audit entry', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
        reason: 'Enable for testing',
        ipAddress: '192.168.1.1',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should throw error if flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        featureFlagService.setFlag('nonExistent' as any, true, {
          userId: 'admin-123',
        })
      ).rejects.toThrow("Feature flag 'nonExistent' does not exist");
    });

    it('should skip update if value unchanged', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        ...mockExistingFlag,
        enabled: true, // Already true
      });

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      // Transaction should not be called
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should invalidate cache after update', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockCache.delete).toHaveBeenCalled();
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
    });
  });

  describe('getAllFlags', () => {
    it('should return all flags with metadata', async () => {
      const mockFlags = [
        {
          key: 'hardwareWalletSigning',
          enabled: true,
          description: 'Hardware wallet support',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
        {
          key: 'aiAssistant',
          enabled: false,
          description: 'AI assistant',
          category: 'general',
          modifiedBy: 'system',
          updatedAt: new Date(),
        },
      ];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      const result = await featureFlagService.getAllFlags();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          key: 'hardwareWalletSigning',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should order flags by category and key', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.getAllFlags();

      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      });
    });
  });

  describe('getAuditLog', () => {
    it('should return audit entries for specific flag', async () => {
      const mockAuditEntries = [
        {
          id: 'audit-1',
          key: 'aiAssistant',
          previousValue: false,
          newValue: true,
          changedBy: 'admin-123',
          reason: 'Enable for testing',
          ipAddress: '192.168.1.1',
          createdAt: new Date(),
        },
      ];
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue(mockAuditEntries);

      const result = await featureFlagService.getAuditLog('aiAssistant');

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('aiAssistant');
    });

    it('should return all audit entries when no key specified', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog();

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('should respect limit parameter', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog('aiAssistant', 10);

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('getFlag', () => {
    it('should return flag info by key', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
        description: 'AI assistant feature',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      });

      const result = await featureFlagService.getFlag('aiAssistant');

      expect(result).toEqual(
        expect.objectContaining({
          key: 'aiAssistant',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should return null for non-existent flag', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.getFlag('nonExistent' as any);

      expect(result).toBeNull();
    });
  });

  describe('resetToDefault', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should reset flag to environment default', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'hardwareWalletSigning',
        enabled: false, // Changed from true default
        description: 'Hardware wallet support',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('hardwareWalletSigning', {
        userId: 'admin-123',
      });

      // Should be called with the env default (true)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should handle experimental flags', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'experimental.taprootAddresses',
        enabled: true, // Changed from false default
        description: 'Taproot support',
        category: 'experimental',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('experimental.taprootAddresses', {
        userId: 'admin-123',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('bulkUpdate', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update multiple flags', async () => {
      const mockFlags = [
        { id: 'flag-1', key: 'aiAssistant', enabled: false },
        { id: 'flag-2', key: 'priceAlerts', enabled: false },
      ];

      let callIndex = 0;
      mockPrisma.featureFlag.findUnique.mockImplementation(() => {
        const flag = mockFlags[callIndex];
        callIndex = (callIndex + 1) % mockFlags.length;
        return Promise.resolve(flag);
      });
      mockPrisma.featureFlag.update.mockResolvedValue({});
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.bulkUpdate(
        [
          { key: 'aiAssistant', enabled: true },
          { key: 'priceAlerts', enabled: true },
        ],
        { userId: 'admin-123' }
      );

      // Should be called for each update
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
