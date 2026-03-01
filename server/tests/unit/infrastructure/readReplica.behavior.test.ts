import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoadOptions = {
  replicaUrl?: string;
  nodeEnv?: string;
  connectError?: Error;
  replicaQueryError?: Error;
  replicaNow?: Date;
  primaryNow?: Date;
};

async function loadReadReplicaModule(options: LoadOptions = {}) {
  vi.resetModules();

  if (options.replicaUrl === undefined) {
    delete process.env.READ_REPLICA_URL;
  } else {
    process.env.READ_REPLICA_URL = options.replicaUrl;
  }
  if (options.nodeEnv) {
    process.env.NODE_ENV = options.nodeEnv;
  }

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const primaryDb = {
    name: 'primary-db-client',
    $queryRaw: vi.fn().mockResolvedValue([{ ts: options.primaryNow ?? new Date('2026-01-01T00:00:10.000Z') }]),
  };

  const primaryModelClient = {
    $queryRaw: vi.fn().mockResolvedValue([{ ts: options.primaryNow ?? new Date('2026-01-01T00:00:10.000Z') }]),
  };

  const replicaClient = {
    name: 'replica-db-client',
    $connect: options.connectError
      ? vi.fn().mockRejectedValue(options.connectError)
      : vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: options.replicaQueryError
      ? vi.fn().mockRejectedValue(options.replicaQueryError)
      : vi.fn().mockResolvedValue([{ ts: options.replicaNow ?? new Date('2026-01-01T00:00:00.000Z') }]),
  };

  const prismaCtorSpy = vi.fn();
  class MockPrismaClient {
    constructor(options: any) {
      prismaCtorSpy(options);
      return replicaClient;
    }
  }

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => log,
  }));
  vi.doMock('../../../src/repositories/db', () => ({
    db: primaryDb,
    default: primaryDb,
  }));
  vi.doMock('../../../src/models/prisma', () => ({
    default: primaryModelClient,
  }));
  vi.doMock('@prisma/client', () => ({
    PrismaClient: MockPrismaClient,
  }));

  const mod = await import('../../../src/infrastructure/readReplica');
  return {
    ...mod,
    mocks: {
      log,
      primaryDb,
      primaryModelClient,
      replicaClient,
      PrismaClient: prismaCtorSpy,
    },
  };
}

describe('ReadReplica behavior', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('runs in primary-only mode when READ_REPLICA_URL is not set', async () => {
    const { initializeReadReplica, isReadReplicaEnabled, getReadClient, mocks } = await loadReadReplicaModule({
      replicaUrl: undefined,
    });

    await initializeReadReplica();

    expect(isReadReplicaEnabled()).toBe(false);
    expect(getReadClient()).toBe(mocks.primaryDb as any);
    expect(mocks.log.info).toHaveBeenCalledWith(
      'Read replica not configured, using primary for all queries'
    );
  });

  it('initializes replica client successfully and routes reads to replica', async () => {
    const {
      initializeReadReplica,
      isReadReplicaEnabled,
      getReadClient,
      checkReadReplicaHealth,
      withReadReplica,
      withPrimary,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
      nodeEnv: 'development',
    });

    await initializeReadReplica();

    expect(mocks.PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        datasources: {
          db: { url: 'postgresql://replica:5432/sanctuary' },
        },
        log: ['query', 'error'],
      })
    );
    expect(mocks.replicaClient.$connect).toHaveBeenCalled();
    expect(mocks.replicaClient.$queryRaw).toHaveBeenCalled();
    expect(isReadReplicaEnabled()).toBe(true);
    expect(getReadClient()).toBe(mocks.replicaClient as any);

    const health = await checkReadReplicaHealth();
    expect(health.enabled).toBe(true);
    expect(health.healthy).toBe(true);
    expect(typeof health.latencyMs).toBe('number');

    const readResult = await withReadReplica(async (client: any) => client.name);
    const primaryResult = await withPrimary(async (client: any) => client.name);
    expect(readResult).toBe('replica-db-client');
    expect(primaryResult).toBe('primary-db-client');

    await shutdownReadReplica();
    expect(mocks.replicaClient.$disconnect).toHaveBeenCalled();
    expect(isReadReplicaEnabled()).toBe(false);
    expect(getReadClient()).toBe(mocks.primaryDb as any);
  });

  it('falls back to primary when replica initialization fails', async () => {
    const {
      initializeReadReplica,
      isReadReplicaEnabled,
      getReadClient,
      checkReadReplicaHealth,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
      nodeEnv: 'production',
      connectError: new Error('connect failed'),
    });

    await initializeReadReplica();

    expect(mocks.PrismaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        log: ['error'],
      })
    );
    expect(isReadReplicaEnabled()).toBe(false);
    expect(getReadClient()).toBe(mocks.primaryDb as any);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to initialize read replica, falling back to primary',
      expect.objectContaining({
        error: 'connect failed',
      })
    );

    const health = await checkReadReplicaHealth();
    expect(health).toEqual({ enabled: false, healthy: false });
  });

  it('logs unknown error when replica initialization fails with non-Error rejection', async () => {
    const {
      initializeReadReplica,
      isReadReplicaEnabled,
      getReadClient,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
      connectError: 'connect failed' as any,
    });

    await initializeReadReplica();

    expect(isReadReplicaEnabled()).toBe(false);
    expect(getReadClient()).toBe(mocks.primaryDb as any);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to initialize read replica, falling back to primary',
      expect.objectContaining({
        error: 'Unknown error',
      })
    );
  });

  it('reports unhealthy replica when health query fails after init', async () => {
    const {
      initializeReadReplica,
      checkReadReplicaHealth,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
    });

    await initializeReadReplica();
    mocks.replicaClient.$queryRaw.mockRejectedValueOnce(new Error('read failed'));

    const health = await checkReadReplicaHealth();
    expect(health).toEqual({
      enabled: true,
      healthy: false,
      error: 'read failed',
    });

    await shutdownReadReplica();
  });

  it('reports unknown error when health query rejects with non-Error value', async () => {
    const {
      initializeReadReplica,
      checkReadReplicaHealth,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
    });

    await initializeReadReplica();
    mocks.replicaClient.$queryRaw.mockRejectedValueOnce('read failed');

    const health = await checkReadReplicaHealth();
    expect(health).toEqual({
      enabled: true,
      healthy: false,
      error: 'Unknown error',
    });

    await shutdownReadReplica();
  });

  it('estimates replication lag, tracks last check, and flags stale checks as acceptable', async () => {
    const {
      initializeReadReplica,
      estimateReplicationLag,
      getLastKnownLag,
      isReplicaAcceptable,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
      primaryNow: new Date('2026-01-01T00:00:10.000Z'),
      replicaNow: new Date('2026-01-01T00:00:00.000Z'),
    });

    await initializeReadReplica();

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    const lag = await estimateReplicationLag();
    expect(lag).toBe(10000);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      'High replication lag detected',
      expect.objectContaining({ lagMs: 10000 })
    );

    const last = getLastKnownLag();
    expect(last.lagMs).toBe(10000);
    expect(last.checkedAt).toBe(1000);

    nowSpy.mockReturnValue(1005);
    expect(isReplicaAcceptable(5000)).toBe(false);
    expect(isReplicaAcceptable(20000)).toBe(true);

    nowSpy.mockReturnValue(1000 + 60001);
    expect(isReplicaAcceptable(1)).toBe(true);
    nowSpy.mockRestore();

    await shutdownReadReplica();
  });

  it('does not warn when replication lag is within threshold', async () => {
    const {
      initializeReadReplica,
      estimateReplicationLag,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
      primaryNow: new Date('2026-01-01T00:00:05.000Z'),
      replicaNow: new Date('2026-01-01T00:00:03.000Z'),
    });

    await initializeReadReplica();
    await expect(estimateReplicationLag()).resolves.toBe(2000);
    expect(mocks.log.warn).not.toHaveBeenCalledWith(
      'High replication lag detected',
      expect.anything()
    );

    await shutdownReadReplica();
  });

  it('returns -1 when lag estimation query fails', async () => {
    const {
      initializeReadReplica,
      estimateReplicationLag,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
    });

    await initializeReadReplica();
    mocks.primaryDb.$queryRaw.mockRejectedValueOnce(new Error('primary query failed'));

    await expect(estimateReplicationLag()).resolves.toBe(-1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to estimate replication lag',
      expect.objectContaining({
        error: 'primary query failed',
      })
    );

    await shutdownReadReplica();
  });

  it('returns -1 with unknown error label when lag estimation throws non-Error', async () => {
    const {
      initializeReadReplica,
      estimateReplicationLag,
      shutdownReadReplica,
      mocks,
    } = await loadReadReplicaModule({
      replicaUrl: 'postgresql://replica:5432/sanctuary',
    });

    await initializeReadReplica();
    mocks.primaryDb.$queryRaw.mockRejectedValueOnce('primary failed');

    await expect(estimateReplicationLag()).resolves.toBe(-1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to estimate replication lag',
      expect.objectContaining({
        error: 'Unknown error',
      })
    );

    await shutdownReadReplica();
  });

  it('handles shutdown when replica was never initialized', async () => {
    const { shutdownReadReplica } = await loadReadReplicaModule({
      replicaUrl: undefined,
    });

    await expect(shutdownReadReplica()).resolves.toBeUndefined();
  });

  it('returns zero lag and non-acceptable replica when replica is disabled', async () => {
    const { estimateReplicationLag, isReplicaAcceptable } = await loadReadReplicaModule({
      replicaUrl: undefined,
    });

    await expect(estimateReplicationLag()).resolves.toBe(0);
    expect(isReplicaAcceptable()).toBe(false);
  });
});
