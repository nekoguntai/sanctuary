import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({
  getCachedBlockHeight: vi.fn(),
}));

vi.mock('../../../src/repositories/db', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    db: prisma,
    default: prisma,
  };
});

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: mocks.getCachedBlockHeight,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import crossWalletRouter from '../../../src/api/transactions/crossWallet';

describe('transactions cross-wallet routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1' };
      next();
    });
    app.use('/api/v1', crossWalletRouter);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mocks.getCachedBlockHeight.mockReturnValue(850000);
    (mockPrismaClient as any).$queryRawUnsafe = vi.fn().mockResolvedValue([]);
  });

  it('GET /transactions/recent returns empty array when user has no wallets', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /transactions/recent serializes transactions with dynamic confirmations and labels', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        txid: 'a'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-12000),
        fee: BigInt(220),
        balanceAfter: BigInt(88000),
        blockHeight: BigInt(849990),
        confirmations: 0,
        blockTime: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        address: { address: 'bc1qdest', derivationPath: "m/84'/0'/0'/0/1" },
        transactionLabels: [{ label: { id: 'l1', name: 'Rent', color: '#f00' } }],
        rbfStatus: null,
      },
    ]);
    mocks.getCachedBlockHeight.mockReturnValue(850000);

    const response = await request(app).get('/api/v1/transactions/recent').query({ limit: '5' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      amount: -12000,
      fee: 220,
      balanceAfter: 88000,
      blockHeight: 849990,
      confirmations: 11,
      walletName: 'Main Wallet',
    });
    expect(response.body[0].labels).toEqual([{ id: 'l1', name: 'Rent', color: '#f00' }]);
  });

  it('GET /transactions/pending returns mempool entries sorted by fee rate', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'b'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-5000),
        fee: BigInt(300),
        rawTx: 'aa'.repeat(120),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        txid: 'c'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-7000),
        fee: BigInt(100),
        rawTx: 'aa'.repeat(200),
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ]);

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].txid).toBe('b'.repeat(64));
    expect(response.body[0].feeRate).toBeGreaterThan(response.body[1].feeRate);
  });

  it('GET /transactions/pending returns empty array when no wallets are accessible', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /transactions/pending returns 500 on query failure', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet' },
    ]);
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('transaction query failed'));

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });

  it('GET /transactions/balance-history returns flat line when no wallets are accessible', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 1000 },
      { name: 'Now', value: 1000 },
    ]);
  });

  it('GET /transactions/balance-history reconstructs running balances from bucket deltas', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRawUnsafe.mockResolvedValue([
      { bucket: new Date('2026-01-01T00:00:00.000Z'), amount: BigInt(100) },
      { bucket: new Date('2026-01-02T00:00:00.000Z'), amount: BigInt(-50) },
    ]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(200);
    expect(response.body.map((p: any) => p.value)).toEqual([950, 1050, 1000]);
  });

  it('GET /transactions/balance-history returns flat line when there are no bucketed deltas', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRawUnsafe.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1500' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 1500 },
      { name: 'Now', value: 1500 },
    ]);
  });

  it.each([
    { timeframe: '1D', expectedUnit: 'hour', expectedDays: 1 },
    { timeframe: '1M', expectedUnit: 'day', expectedDays: 30 },
    { timeframe: '1Y', expectedUnit: 'week', expectedDays: 365 },
    { timeframe: 'ALL', expectedUnit: 'month', expectedDays: null as number | null },
  ])(
    'GET /transactions/balance-history uses correct bucket config for $timeframe',
    async ({ timeframe, expectedUnit, expectedDays }) => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      (mockPrismaClient as any).$queryRawUnsafe.mockResolvedValue([
        { bucket: new Date('2026-01-01T00:00:00.000Z'), amount: BigInt(0) },
      ]);

      const before = Date.now();
      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe, totalBalance: '2000' });
      const after = Date.now();

      expect(response.status).toBe(200);
      expect((mockPrismaClient as any).$queryRawUnsafe).toHaveBeenCalledTimes(1);

      const callArgs = (mockPrismaClient as any).$queryRawUnsafe.mock.calls[0];
      const query = callArgs[0] as string;
      const walletIds = callArgs[1] as string[];
      const startDate = callArgs[2] as Date;

      expect(query).toContain(`date_trunc('${expectedUnit}'`);
      expect(walletIds).toEqual(['wallet-1']);
      expect(startDate).toBeInstanceOf(Date);

      if (expectedDays === null) {
        expect(startDate.getTime()).toBe(0);
      } else {
        const expectedMs = expectedDays * 24 * 60 * 60 * 1000;
        expect(startDate.getTime()).toBeGreaterThanOrEqual(before - expectedMs - 1500);
        expect(startDate.getTime()).toBeLessThanOrEqual(after - expectedMs + 1500);
      }

      expect(response.body).toHaveLength(2);
    }
  );

  it('GET /transactions/balance-history returns 500 when aggregation query fails', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRawUnsafe.mockRejectedValue(new Error('aggregation failed'));

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });

  it('returns 500 when wallet lookup fails for recent transactions', async () => {
    mockPrismaClient.wallet.findMany.mockRejectedValue(new Error('database down'));

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });
});
