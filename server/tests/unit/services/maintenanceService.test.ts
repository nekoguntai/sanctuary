import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/config', () => ({
  getConfig: () => ({
    maintenance: {
      auditLogRetentionDays: 90,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
      dailyCleanupIntervalMs: 1000,
      hourlyCleanupIntervalMs: 500,
      initialDelayMs: 200,
      weeklyMaintenanceIntervalMs: 7 * 24 * 60 * 60 * 1000,
      monthlyMaintenanceIntervalMs: 30 * 24 * 60 * 60 * 1000,
      diskWarningThresholdPercent: 80,
    },
  }),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { maintenanceService } from '../../../src/services/maintenanceService';

describe('MaintenanceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'setTimeout');
    vi.spyOn(global, 'setInterval');
    vi.spyOn(global, 'clearTimeout');
    vi.spyOn(global, 'clearInterval');
  });

  afterEach(() => {
    maintenanceService.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts timers when started', () => {
    maintenanceService.start();

    expect(setTimeout).toHaveBeenCalled();
    expect(setInterval).toHaveBeenCalled();
  });

  it('clears timers when stopped', () => {
    maintenanceService.start();
    maintenanceService.stop();

    expect(clearTimeout).toHaveBeenCalled();
    expect(clearInterval).toHaveBeenCalled();
  });
});
