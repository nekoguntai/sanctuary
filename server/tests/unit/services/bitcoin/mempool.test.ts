import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  nodeConfig: {
    findFirst: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => hoisted.axiosGet(...args),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: hoisted.nodeConfig,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import {
  getRecentBlocks,
  getRecommendedFees,
  getBlocksAndMempool,
} from '../../../../src/services/bitcoin/mempool';

const mockBlocks = (timestamp: number) => ([
  {
    id: 'b1',
    height: 100,
    version: 1,
    timestamp,
    tx_count: 2000,
    size: 1000000,
    weight: 4000000,
    merkle_root: 'm',
    previousblockhash: 'p',
    medianFee: 0,
    feeRange: [1, 2, 3, 4, 5],
    extras: {
      medianFee: 0,
      feeRange: [1, 2, 3, 4, 5],
      reward: 0,
      totalFees: 100000,
    },
  },
  {
    id: 'b2',
    height: 99,
    version: 1,
    timestamp: timestamp - 600,
    tx_count: 1500,
    size: 900000,
    weight: 3600000,
    merkle_root: 'm2',
    previousblockhash: 'p2',
    medianFee: 10,
    feeRange: [10, 20],
    extras: {
      medianFee: 10,
      feeRange: [10, 20],
      reward: 0,
      totalFees: 200000,
    },
  },
]);

describe('mempool service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.nodeConfig.findFirst.mockResolvedValue(null);
  });

  it('uses feeEstimatorUrl when configured', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.custom/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('uses explorerUrl when feeEstimatorUrl is missing', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      explorerUrl: 'https://explorer.example',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://explorer.example/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('derives fee estimates from projected blocks when available', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({
      data: [
        { medianFee: 5.56, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 4.44, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 3.33, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 2.22, feeRange: [0.5, 1], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
      ],
    });

    const fees = await getRecommendedFees();
    expect(fees).toEqual({
      fastestFee: 5.6,
      halfHourFee: 4.4,
      hourFee: 3.3,
      economyFee: 2.2,
      minimumFee: 0.5,
    });
  });

  it('falls back to recommended endpoint when projected blocks fail', async () => {
    hoisted.axiosGet.mockRejectedValueOnce(new Error('no projected'));
    hoisted.axiosGet.mockResolvedValueOnce({
      data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 4, minimumFee: 1 },
    });

    const fees = await getRecommendedFees();
    expect(fees.fastestFee).toBe(10);
    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/v1/fees/recommended'),
      expect.any(Object)
    );
  });

  it('builds dashboard blocks and mempool using simple estimator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: 'simple',
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        const blocks = mockBlocks(1735689600);
        blocks[0].extras.totalFees = 0;
        blocks[0].extras.avgFeeRate = 0;
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 100, vsize: 2500000, total_fee: 5000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 6, hourFee: 4, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool.length).toBeGreaterThan(0);
    expect(result.blocks.length).toBe(2);
    expect(result.mempoolInfo.size).toBeCloseTo(2.5, 2);

    vi.useRealTimers();
  });

  it('builds dashboard blocks using projected mempool data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: 'mempool_space',
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: mockBlocks(1735689600) });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 100, vsize: 2500000, total_fee: 5000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.resolve({
          data: [
            { blockVSize: 1000000, totalFees: 100000, medianFee: 10, feeRange: [5, 15], nTx: 200 },
            { blockVSize: 1000000, totalFees: 90000, medianFee: 8, feeRange: [4, 12], nTx: 180 },
            { blockVSize: 1000000, totalFees: 80000, medianFee: 6, feeRange: [3, 10], nTx: 160 },
            { blockVSize: 2000000, totalFees: 50000, medianFee: 2, feeRange: [1, 3], nTx: 100 },
          ],
        });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool[0].height).toBe('+3');
    expect(result.mempool[result.mempool.length - 1].height).toBe('Next');
    expect(result.queuedBlocksSummary?.blockCount).toBeGreaterThan(0);
    expect(result.blocks[0].medianFee).toBe(0.1);

    vi.useRealTimers();
  });
});
