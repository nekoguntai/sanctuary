import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeletePriceData,
  mockDeleteFeeEstimates,
  mockDeleteDrafts,
  mockDeleteRefreshTokens,
  mockDeletePushDevices,
  mockExecuteRaw,
  mockAuditCleanup,
  mockAuditLog,
  mockExpireOldTransfers,
  mockLogInfo,
  mockLogWarn,
  mockLogError,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockDeletePriceData: vi.fn(),
  mockDeleteFeeEstimates: vi.fn(),
  mockDeleteDrafts: vi.fn(),
  mockDeleteRefreshTokens: vi.fn(),
  mockDeletePushDevices: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockAuditCleanup: vi.fn(),
  mockAuditLog: vi.fn(),
  mockExpireOldTransfers: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/repositories/db', () => ({
  db: {
    priceData: { deleteMany: mockDeletePriceData },
    feeEstimate: { deleteMany: mockDeleteFeeEstimates },
    draftTransaction: { deleteMany: mockDeleteDrafts },
    refreshToken: { deleteMany: mockDeleteRefreshTokens },
    pushDevice: { deleteMany: mockDeletePushDevices },
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    cleanup: mockAuditCleanup,
    log: mockAuditLog,
  },
  AuditCategory: {
    SYSTEM: 'SYSTEM',
  },
}));

vi.mock('../../../src/services/transferService', () => ({
  expireOldTransfers: mockExpireOldTransfers,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  }),
}));

import {
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
  cleanupExpiredDraftsJob,
  cleanupExpiredTransfersJob,
  cleanupExpiredTokensJob,
  weeklyVacuumJob,
  monthlyCleanupJob,
  maintenanceJobs,
} from '../../../src/jobs/definitions/maintenance';

function sqlFromCall(call: any[]): string {
  const [template] = call;
  if (Array.isArray(template)) {
    return template.join('?');
  }
  return String(template);
}

describe('Maintenance job definitions behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeletePriceData.mockResolvedValue({ count: 0 });
    mockDeleteFeeEstimates.mockResolvedValue({ count: 0 });
    mockDeleteDrafts.mockResolvedValue({ count: 0 });
    mockDeleteRefreshTokens.mockResolvedValue({ count: 0 });
    mockDeletePushDevices.mockResolvedValue({ count: 0 });
    mockExecuteRaw.mockResolvedValue(0);
    mockAuditCleanup.mockResolvedValue(0);
    mockAuditLog.mockResolvedValue(undefined);
    mockExpireOldTransfers.mockResolvedValue(0);
  });

  it('runs cleanup jobs and returns counts with configured defaults', async () => {
    mockAuditCleanup.mockResolvedValueOnce(5);
    mockDeletePriceData.mockResolvedValueOnce({ count: 3 });
    mockDeleteFeeEstimates.mockResolvedValueOnce({ count: 2 });

    const auditCount = await cleanupAuditLogsJob.handler({ data: {} } as any);
    const priceCount = await cleanupPriceDataJob.handler({ data: {} } as any);
    const feeCount = await cleanupFeeEstimatesJob.handler({ data: {} } as any);

    expect(auditCount).toBe(5);
    expect(priceCount).toBe(3);
    expect(feeCount).toBe(2);
    expect(mockAuditCleanup).toHaveBeenCalledWith(expect.any(Date));
    expect(mockDeletePriceData).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      })
    );
    expect(mockDeleteFeeEstimates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      })
    );
  });

  it('cleans up expired drafts and audits only when rows were deleted', async () => {
    mockDeleteDrafts.mockResolvedValueOnce({ count: 4 });
    mockDeleteDrafts.mockResolvedValueOnce({ count: 0 });

    const first = await cleanupExpiredDraftsJob.handler();
    const second = await cleanupExpiredDraftsJob.handler();

    expect(first).toBe(4);
    expect(second).toBe(0);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.draft_cleanup',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('cleans up expired transfers and audits only when rows were expired', async () => {
    mockExpireOldTransfers.mockResolvedValueOnce(2);
    mockExpireOldTransfers.mockResolvedValueOnce(0);

    const first = await cleanupExpiredTransfersJob.handler();
    const second = await cleanupExpiredTransfersJob.handler();

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.transfer_expiry',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('cleans up expired refresh tokens and returns deleted count', async () => {
    mockDeleteRefreshTokens.mockResolvedValueOnce({ count: 7 });

    const deleted = await cleanupExpiredTokensJob.handler();

    expect(deleted).toBe(7);
    expect(mockDeleteRefreshTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      })
    );
  });

  it('runs weekly vacuum + reindex job and resets statement timeout', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);

    await weeklyVacuumJob.handler({
      data: { timeout: 12345, tables: ['audit_logs', 'Transaction', 'UTXO'] },
      updateProgress,
    } as any);

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes('SET statement_timeout = ?'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('VACUUM ANALYZE'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "audit_logs"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "Transaction"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes('REINDEX TABLE "UTXO"'))).toBe(true);
    expect(sqlCalls.some(sql => sql.includes("SET statement_timeout = '0'"))).toBe(true);

    expect(updateProgress).toHaveBeenCalledWith(10);
    expect(updateProgress).toHaveBeenCalledWith(50);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.weekly_db_maintenance',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('always resets statement timeout even when weekly vacuum fails', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      const sql = template.join('?');
      if (sql.includes('VACUUM ANALYZE')) {
        throw new Error('vacuum failed');
      }
      return 0;
    });

    await expect(
      weeklyVacuumJob.handler({
        data: {},
        updateProgress,
      } as any)
    ).rejects.toThrow('vacuum failed');

    const sqlCalls = mockExecuteRaw.mock.calls.map(sqlFromCall);
    expect(sqlCalls.some(sql => sql.includes("SET statement_timeout = '0'"))).toBe(true);
  });

  it('runs monthly cleanup job, reports progress, and returns summary', async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    mockDeletePushDevices.mockResolvedValueOnce({ count: 6 });
    mockExecuteRaw.mockImplementation(async (template: TemplateStringsArray) => {
      const sql = template.join('?');
      if (sql.includes('DELETE FROM "DraftTransaction"')) {
        return 3;
      }
      return 0;
    });

    const result = await monthlyCleanupJob.handler({
      data: {},
      updateProgress,
    } as any);

    expect(result).toEqual({
      stalePushDevices: 6,
      orphanedDrafts: 3,
    });
    expect(updateProgress).toHaveBeenCalledWith(10);
    expect(updateProgress).toHaveBeenCalledWith(50);
    expect(updateProgress).toHaveBeenCalledWith(90);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.monthly_stale_cleanup',
        category: 'SYSTEM',
        success: true,
      })
    );
  });

  it('exports the complete maintenance job list', () => {
    expect(maintenanceJobs).toEqual([
      cleanupAuditLogsJob,
      cleanupPriceDataJob,
      cleanupFeeEstimatesJob,
      cleanupExpiredDraftsJob,
      cleanupExpiredTransfersJob,
      cleanupExpiredTokensJob,
      weeklyVacuumJob,
      monthlyCleanupJob,
    ]);
  });
});
