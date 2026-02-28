import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDb,
  mockExecSync,
  mockLog,
} = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
  },
  mockExecSync: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/repositories/db', () => ({
  db: mockDb,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import {
  migrationService,
  getExpectedSchemaVersion,
} from '../../../src/services/migrationService';

describe('migrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$queryRaw.mockResolvedValue([]);
    mockExecSync.mockReturnValue(undefined);
  });

  it('exposes expected schema version', () => {
    expect(getExpectedSchemaVersion()).toBeGreaterThan(0);
  });

  it('returns applied migrations and handles query errors', async () => {
    const migrations = [
      { migration_name: 'm1', finished_at: new Date('2025-01-01T00:00:00.000Z') },
      { migration_name: 'm2', finished_at: new Date('2025-01-02T00:00:00.000Z') },
    ];
    mockDb.$queryRaw.mockResolvedValueOnce(migrations);
    await expect(migrationService.getAppliedMigrations()).resolves.toEqual(migrations);

    mockDb.$queryRaw.mockRejectedValueOnce(new Error('missing table'));
    await expect(migrationService.getAppliedMigrations()).resolves.toEqual([]);
  });

  it('computes schema version and version info', async () => {
    const m1 = { migration_name: 'm1', finished_at: new Date('2025-01-01T00:00:00.000Z') };
    const m2 = { migration_name: 'm2', finished_at: new Date('2025-01-02T00:00:00.000Z') };
    vi.spyOn(migrationService, 'getAppliedMigrations').mockResolvedValueOnce([m1 as any, m2 as any]);
    await expect(migrationService.getSchemaVersion()).resolves.toBe(2);

    vi.spyOn(migrationService, 'getAppliedMigrations').mockResolvedValueOnce([m1 as any, m2 as any]);
    const info = await migrationService.getSchemaVersionInfo();
    expect(info).toEqual(expect.objectContaining({
      version: 2,
      latestMigration: 'm2',
      appliedAt: m2.finished_at,
      pendingMigrations: getExpectedSchemaVersion() - 2,
    }));
  });

  it('verifies migration manifest and checks individual migration presence', async () => {
    vi.spyOn(migrationService, 'getAppliedMigrations').mockResolvedValueOnce([
      { migration_name: '20251211212018_init' } as any,
    ]);

    const result = await migrationService.verifyMigrations();
    expect(result.valid).toBe(false);
    expect(result.applied).toBe(1);
    expect(result.expected).toBe(getExpectedSchemaVersion());
    expect(result.missing.length).toBeGreaterThan(0);

    vi.spyOn(migrationService, 'getAppliedMigrations').mockResolvedValueOnce([
      { migration_name: 'migration_a' } as any,
    ]);
    await expect(migrationService.isMigrationApplied('migration_a')).resolves.toBe(true);

    vi.spyOn(migrationService, 'getAppliedMigrations').mockResolvedValueOnce([
      { migration_name: 'migration_a' } as any,
    ]);
    await expect(migrationService.isMigrationApplied('migration_b')).resolves.toBe(false);
  });

  it('runMigrations returns success when no pending migrations', async () => {
    vi.spyOn(migrationService, 'getSchemaVersionInfo').mockResolvedValueOnce({
      version: getExpectedSchemaVersion(),
      latestMigration: 'latest',
      appliedAt: new Date(),
      totalMigrations: getExpectedSchemaVersion(),
      pendingMigrations: 0,
    });

    const result = await migrationService.runMigrations();
    expect(result).toEqual({ success: true, applied: 0 });
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('runMigrations applies pending migrations and reports failures', async () => {
    vi.spyOn(migrationService, 'getSchemaVersionInfo')
      .mockResolvedValueOnce({
        version: 1,
        latestMigration: 'm1',
        appliedAt: new Date(),
        totalMigrations: 3,
        pendingMigrations: 2,
      })
      .mockResolvedValueOnce({
        version: 3,
        latestMigration: 'm3',
        appliedAt: new Date(),
        totalMigrations: 3,
        pendingMigrations: 0,
      });

    const success = await migrationService.runMigrations();
    expect(success).toEqual({ success: true, applied: 2 });
    expect(mockExecSync).toHaveBeenCalledWith('npx prisma migrate deploy', expect.any(Object));

    vi.spyOn(migrationService, 'getSchemaVersionInfo').mockResolvedValueOnce({
      version: 1,
      latestMigration: 'm1',
      appliedAt: new Date(),
      totalMigrations: 3,
      pendingMigrations: 2,
    });
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('deploy failed');
    });

    const failed = await migrationService.runMigrations();
    expect(failed).toEqual({
      success: false,
      applied: 0,
      error: 'deploy failed',
    });
  });

  it('logs migration status for pending and up-to-date states', async () => {
    vi.spyOn(migrationService, 'getSchemaVersionInfo')
      .mockResolvedValueOnce({
        version: 1,
        latestMigration: 'm1',
        appliedAt: new Date(),
        totalMigrations: 3,
        pendingMigrations: 2,
      })
      .mockResolvedValueOnce({
        version: 3,
        latestMigration: 'm3',
        appliedAt: new Date(),
        totalMigrations: 3,
        pendingMigrations: 0,
      });

    await migrationService.logMigrationStatus();
    await migrationService.logMigrationStatus();

    expect(mockLog.warn).toHaveBeenCalledWith('Database schema is behind', expect.any(Object));
    expect(mockLog.info).toHaveBeenCalledWith('Database schema is up to date', expect.any(Object));
  });
});
