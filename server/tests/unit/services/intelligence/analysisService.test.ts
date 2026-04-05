/**
 * Analysis Service Tests
 *
 * Tests for the Treasury Intelligence analysis pipeline orchestration.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const {
  mockGetRedisClient,
  mockIsRedisConnected,
  mockGetAIConfig,
  mockSyncConfigToContainer,
  mockGetContainerUrl,
  mockGetEnabledIntelligenceWallets,
  mockNotificationChannelRegistry,
  mockCreateInsight,
  mockGetTransactionVelocity,
  mockGetUtxoAgeDistribution,
  mockGetUtxoHealthProfile,
  mockGetRecentFees,
  mockGetLatestFeeSnapshot,
  mockLogger,
  redis,
} = vi.hoisted(() => {
  const redis = {
    exists: vi.fn(),
    set: vi.fn(),
  };

  return {
    mockGetRedisClient: vi.fn(() => redis),
    mockIsRedisConnected: vi.fn(() => true),
    mockGetAIConfig: vi.fn(),
    mockSyncConfigToContainer: vi.fn(),
    mockGetContainerUrl: vi.fn(() => 'http://ai:3100'),
    mockGetEnabledIntelligenceWallets: vi.fn(),
    mockNotificationChannelRegistry: {
      notifyInsight: vi.fn(),
    },
    mockCreateInsight: vi.fn(),
    mockGetTransactionVelocity: vi.fn(),
    mockGetUtxoAgeDistribution: vi.fn(),
    mockGetUtxoHealthProfile: vi.fn(),
    mockGetRecentFees: vi.fn(),
    mockGetLatestFeeSnapshot: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    redis,
  };
});

vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../../src/services/ai/config', () => ({
  getAIConfig: mockGetAIConfig,
  syncConfigToContainer: mockSyncConfigToContainer,
  getContainerUrl: mockGetContainerUrl,
}));

vi.mock('../../../../src/repositories/intelligenceRepository', () => ({
  intelligenceRepository: {
    createInsight: mockCreateInsight,
    getTransactionVelocity: mockGetTransactionVelocity,
    getUtxoAgeDistribution: mockGetUtxoAgeDistribution,
  },
}));

vi.mock('../../../../src/services/intelligence/settings', () => ({
  getEnabledIntelligenceWallets: mockGetEnabledIntelligenceWallets,
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockNotificationChannelRegistry,
}));

vi.mock('../../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: mockGetUtxoHealthProfile,
}));

vi.mock('../../../../src/services/autopilot/feeMonitor', () => ({
  getRecentFees: mockGetRecentFees,
  getLatestFeeSnapshot: mockGetLatestFeeSnapshot,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  runAnalysisPipelines,
  getIntelligenceStatus,
} from '../../../../src/services/intelligence/analysisService';

describe('Analysis Service', () => {
  const validConfig = {
    enabled: true,
    endpoint: 'http://ollama:11434',
    model: 'llama3',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redis.exists.mockResolvedValue(0);
    redis.set.mockResolvedValue('OK');
    (mockIsRedisConnected as Mock).mockReturnValue(true);
    (mockGetRedisClient as Mock).mockReturnValue(redis);
  });

  // ========================================
  // runAnalysisPipelines
  // ========================================

  describe('runAnalysisPipelines', () => {
    it('should skip when AI is not configured (not enabled)', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: false, endpoint: null, model: null });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when AI has no endpoint', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: true, endpoint: '', model: 'llama3' });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
    });

    it('should skip when AI has no model', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: true, endpoint: 'http://ollama:11434', model: '' });

      await runAnalysisPipelines();

      expect(mockSyncConfigToContainer).not.toHaveBeenCalled();
    });

    it('should skip when Ollama check fails', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await runAnalysisPipelines();

      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when Ollama check returns not compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false }),
      });

      await runAnalysisPipelines();

      expect(mockGetEnabledIntelligenceWallets).not.toHaveBeenCalled();
    });

    it('should skip when no wallets have intelligence enabled', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });
      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([]);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run analysis for enabled wallets and create insights', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      // Ollama check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: {
            enabled: true,
            notifyTelegram: true,
            notifyPush: true,
            severityFilter: 'info',
            typeFilter: ['utxo_health'],
          },
        },
      ]);

      // Context gathering: utxo_health
      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // Dedup check (not deduplicated)
      redis.exists.mockResolvedValue(0);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      // Create insight
      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-new',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      // Notification
      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'utxo_health',
          severity: 'warning',
          title: 'UTXO Health Alert',
        })
      );
      expect(redis.set).toHaveBeenCalled();
      expect(mockNotificationChannelRegistry.notifyInsight).toHaveBeenCalled();
    });

    it('should handle errors in individual wallet analysis gracefully', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      // Ollama check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: {
            enabled: true,
            typeFilter: ['utxo_health'],
          },
        },
      ]);

      // Context gathering throws
      (mockGetUtxoHealthProfile as Mock).mockRejectedValue(new Error('DB timeout'));

      // Should not throw; error is caught internally
      await expect(runAnalysisPipelines()).resolves.toBeUndefined();
    });

    it('should skip pipeline when insight is deduplicated', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      // Redis says key already exists (deduplicated)
      redis.exists.mockResolvedValue(1);

      await runAnalysisPipelines();

      // Should not call context gathering or AI
      expect(mockGetUtxoHealthProfile).not.toHaveBeenCalled();
      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when gatherContext returns null for utxo_health with 0 utxos', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 0,
        dustCount: 0,
        dustValue: BigInt(0),
        totalValue: BigInt(0),
        avgUtxoSize: BigInt(0),
        consolidationCandidates: 0,
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run fee_timing pipeline and create insight', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      const snapshots = Array.from({ length: 10 }, (_, i) => ({
        economy: 5 + i,
        fastest: 20 + i,
      }));

      (mockGetRecentFees as Mock).mockResolvedValue(snapshots);
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({
        economy: 8,
        fastest: 25,
      });

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Fee Timing Alert',
          summary: 'Fees are low',
          severity: 'info',
          analysis: 'Detailed fee analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-fee',
        walletId: 'wallet-1',
        type: 'fee_timing',
        severity: 'info',
        title: 'Fee Timing Alert',
        summary: 'Fees are low',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'fee_timing',
          severity: 'info',
          title: 'Fee Timing Alert',
        })
      );
    });

    it('should return null context for fee_timing when latest snapshot is missing', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      (mockGetRecentFees as Mock).mockResolvedValue(Array.from({ length: 10 }, () => ({ economy: 5, fastest: 20 })));
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should return null context for fee_timing when too few snapshots', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['fee_timing'] },
        },
      ]);

      (mockGetRecentFees as Mock).mockResolvedValue([{ economy: 5, fastest: 20 }]);
      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({ economy: 5, fastest: 20 });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run anomaly pipeline and create insight', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([{ count: 90, totalSats: BigInt(9000000) }]) // 90-day
        .mockResolvedValueOnce([{ count: 5, totalSats: BigInt(500000) }]); // 1-day

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Anomaly Detected',
          summary: 'Unusual spending pattern',
          severity: 'warning',
          analysis: 'Detailed anomaly analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-anomaly',
        walletId: 'wallet-1',
        type: 'anomaly',
        severity: 'warning',
        title: 'Anomaly Detected',
        summary: 'Unusual spending pattern',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'anomaly',
          severity: 'warning',
        })
      );
    });

    it('should return null context for anomaly when velocity is empty', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([]) // 90-day empty
        .mockResolvedValueOnce([]); // 1-day empty

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle anomaly when velocity objects have undefined count/totalSats', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['anomaly'] },
        },
      ]);

      // 90-day returns object with undefined fields (triggers ?? 0 defaults on lines 185-187)
      (mockGetTransactionVelocity as Mock)
        .mockResolvedValueOnce([{ count: undefined, totalSats: undefined }]) // 90-day with nullish fields
        .mockResolvedValueOnce([{ count: undefined, totalSats: undefined }]); // 1-day with nullish fields

      // AI analysis
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Anomaly Check',
          summary: 'Low activity',
          severity: 'info',
          analysis: 'Analysis details',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-anomaly-2',
        walletId: 'wallet-1',
        type: 'anomaly',
        severity: 'info',
        title: 'Anomaly Check',
        summary: 'Low activity',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });

    it('should run tax pipeline and create insight', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['tax'] },
        },
      ]);

      (mockGetUtxoAgeDistribution as Mock).mockResolvedValue({
        shortTerm: { count: 5, totalSats: BigInt(50000) },
        longTerm: { count: 10, totalSats: BigInt(500000) },
      });

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Tax Optimization',
          summary: 'Consider holding for long-term gains',
          severity: 'info',
          analysis: 'Detailed tax analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-tax',
        walletId: 'wallet-1',
        type: 'tax',
        severity: 'info',
        title: 'Tax Optimization',
        summary: 'Consider holding for long-term gains',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'tax',
        })
      );
    });

    it('should return null context for tax when both short and long term counts are zero', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['tax'] },
        },
      ]);

      (mockGetUtxoAgeDistribution as Mock).mockResolvedValue({
        shortTerm: { count: 0, totalSats: BigInt(0) },
        longTerm: { count: 0, totalSats: BigInt(0) },
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should run consolidation pipeline and create insight', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        consolidationCandidates: 3,
        totalValue: BigInt(500000),
        dustValue: BigInt(5000),
        avgUtxoSize: BigInt(20000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue({
        economy: 8,
        fastest: 25,
      });

      (mockGetRecentFees as Mock).mockResolvedValue([
        { economy: 5, fastest: 20 },
        { economy: 8, fastest: 25 },
      ]);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Consolidation Opportunity',
          summary: 'Low fees make consolidation favorable',
          severity: 'info',
          analysis: 'Detailed consolidation analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-consolidation',
        walletId: 'wallet-1',
        type: 'consolidation',
        severity: 'info',
        title: 'Consolidation Opportunity',
        summary: 'Low fees make consolidation favorable',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: 'consolidation',
        })
      );
    });

    it('should return null context for consolidation when fewer than 5 utxos', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 3,
        dustCount: 0,
        consolidationCandidates: 0,
        totalValue: BigInt(300000),
        dustValue: BigInt(0),
        avgUtxoSize: BigInt(100000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);
      (mockGetRecentFees as Mock).mockResolvedValue([]);

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle consolidation with null latest fee snapshot and empty snapshots', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['consolidation'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 10,
        dustCount: 2,
        consolidationCandidates: 2,
        totalValue: BigInt(100000),
        dustValue: BigInt(2000),
        avgUtxoSize: BigInt(10000),
      });

      (mockGetLatestFeeSnapshot as Mock).mockResolvedValue(null);
      (mockGetRecentFees as Mock).mockResolvedValue([]);

      // AI analysis call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Consolidation Note',
          summary: 'Consider consolidating',
          severity: 'info',
          analysis: 'Analysis',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-c2',
        walletId: 'wallet-1',
        type: 'consolidation',
        severity: 'info',
        title: 'Consolidation Note',
        summary: 'Consider consolidating',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });

    it('should skip when AI analysis returns non-ok response', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI analysis returns non-ok
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when AI analysis returns invalid response (missing title)', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI returns response without title
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: 'Some summary but no title',
          severity: 'info',
          analysis: 'Analysis',
        }),
      });

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should skip when AI analysis fetch throws an error', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      // AI fetch throws
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await runAnalysisPipelines();

      expect(mockCreateInsight).not.toHaveBeenCalled();
    });

    it('should handle notification dispatch error gracefully', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-notify-fail',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      // Notification throws
      (mockNotificationChannelRegistry.notifyInsight as Mock).mockRejectedValue(
        new Error('Notification failed')
      );

      // Should not throw; notification error is caught internally
      await expect(runAnalysisPipelines()).resolves.toBeUndefined();
      expect(mockCreateInsight).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to dispatch insight notification',
        expect.objectContaining({ insightId: 'insight-notify-fail' })
      );
    });

    it('should handle dedup check when Redis is not connected', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      // Redis not connected - isDeduplicated should return false, setDedup should be noop
      (mockIsRedisConnected as Mock).mockReturnValue(false);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-no-redis',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Health Alert',
        summary: 'Consider consolidating dust',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      // Should still create insight even without Redis
      expect(mockCreateInsight).toHaveBeenCalled();
      // Redis.set should not be called since redis is not connected
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('should handle dedup check when Redis client is null', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      // Redis client is null
      (mockGetRedisClient as Mock).mockReturnValue(null);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Alert',
          summary: 'Consolidate',
          severity: 'info',
          analysis: 'Details',
        }),
      });

      (mockCreateInsight as Mock).mockResolvedValue({
        id: 'insight-null-redis',
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'info',
        title: 'UTXO Alert',
        summary: 'Consolidate',
      });

      (mockNotificationChannelRegistry.notifyInsight as Mock).mockResolvedValue(undefined);

      await runAnalysisPipelines();

      expect(mockCreateInsight).toHaveBeenCalled();
    });

    it('should catch and log error when createInsight throws in runPipeline', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true }),
      });

      (mockGetEnabledIntelligenceWallets as Mock).mockResolvedValue([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: { enabled: true, typeFilter: ['utxo_health'] },
        },
      ]);

      (mockGetUtxoHealthProfile as Mock).mockResolvedValue({
        totalUtxos: 25,
        dustCount: 5,
        dustValue: BigInt(5000),
        totalValue: BigInt(500000),
        avgUtxoSize: BigInt(20000),
        consolidationCandidates: 3,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'UTXO Health Alert',
          summary: 'Consider consolidating dust',
          severity: 'warning',
          analysis: 'Detailed analysis text',
        }),
      });

      // createInsight throws, which propagates to the wallet-level catch
      (mockCreateInsight as Mock).mockRejectedValue(new Error('DB write failed'));

      await expect(runAnalysisPipelines()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error analyzing wallet',
        expect.objectContaining({ walletId: 'wallet-1', error: 'DB write failed' })
      );
    });

    it('should catch and log top-level error in runAnalysisPipelines', async () => {
      (mockGetAIConfig as Mock).mockRejectedValue(new Error('Config fetch failed'));

      await expect(runAnalysisPipelines()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in runAnalysisPipelines',
        expect.objectContaining({ error: 'Config fetch failed' })
      );
    });
  });

  // ========================================
  // getIntelligenceStatus
  // ========================================

  describe('getIntelligenceStatus', () => {
    it('should return unavailable when AI is not configured', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue({ enabled: false, endpoint: null, model: null });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_not_configured',
      });
    });

    it('should return available when Ollama is compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: true, endpointType: 'bundled' }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: true,
        ollamaConfigured: true,
        endpointType: 'bundled',
      });
    });

    it('should return unavailable when Ollama check returns not compatible', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false, reason: 'ollama_required' }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ollama_required',
      });
    });

    it('should return default reason when Ollama check is not compatible and reason is falsy', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ compatible: false }),
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ollama_required',
      });
    });

    it('should return unreachable when AI container request fails', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_container_unreachable',
      });
    });

    it('should return unreachable when fetch throws', async () => {
      (mockGetAIConfig as Mock).mockResolvedValue(validConfig);
      (mockSyncConfigToContainer as Mock).mockResolvedValue(undefined);

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await getIntelligenceStatus();

      expect(result).toEqual({
        available: false,
        ollamaConfigured: false,
        reason: 'ai_container_unreachable',
      });
    });
  });
});
