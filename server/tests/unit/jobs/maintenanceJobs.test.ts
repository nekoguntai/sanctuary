import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanupAuditLogsJob,
  cleanupPriceDataJob,
  cleanupFeeEstimatesJob,
} from '../../../src/jobs/definitions/maintenance';

vi.mock('../../../src/models/prisma', () => ({
  priceData: {
    deleteMany: vi.fn(),
  },
  feeEstimate: {
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    cleanup: vi.fn(),
  },
  AuditCategory: {},
}));

vi.mock('../../../src/services/transferService', () => ({
  expireOldTransfers: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import prisma from '../../../src/models/prisma';
import { auditService } from '../../../src/services/auditService';

const mockDeletePrice = vi.mocked(prisma.priceData.deleteMany);
const mockDeleteFee = vi.mocked(prisma.feeEstimate.deleteMany);
const mockAuditCleanup = vi.mocked(auditService.cleanup);

describe('Maintenance Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleanupAuditLogsJob returns deleted count', async () => {
    mockAuditCleanup.mockResolvedValue(5);

    const job = { data: { retentionDays: 30 } } as any;
    const result = await cleanupAuditLogsJob.handler(job);

    expect(mockAuditCleanup).toHaveBeenCalled();
    expect(result).toBe(5);
  });

  it('cleanupPriceDataJob deletes old rows', async () => {
    mockDeletePrice.mockResolvedValue({ count: 3 } as any);

    const job = { data: {} } as any;
    const result = await cleanupPriceDataJob.handler(job);

    expect(mockDeletePrice).toHaveBeenCalled();
    expect(result).toBe(3);
  });

  it('cleanupFeeEstimatesJob deletes old fee rows', async () => {
    mockDeleteFee.mockResolvedValue({ count: 2 } as any);

    const job = { data: {} } as any;
    const result = await cleanupFeeEstimatesJob.handler(job);

    expect(mockDeleteFee).toHaveBeenCalled();
    expect(result).toBe(2);
  });
});
