import { vi } from 'vitest';
/**
 * Read Replica Tests
 *
 * Tests for read replica routing and health monitoring.
 */

import {
  getReadClient,
  getPrimaryClient,
  isReadReplicaEnabled,
  withReadReplica,
  withPrimary,
  executeAnalyticsQuery,
  getLastKnownLag,
  isReplicaAcceptable,
} from '../../../src/infrastructure/readReplica';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => {
  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ ts: new Date() }]),
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { default: mockPrisma };
});

describe('Read Replica', () => {
  describe('getReadClient', () => {
    it('should return primary client when replica not enabled', () => {
      const client = getReadClient();
      expect(client).toBeDefined();
    });
  });

  describe('getPrimaryClient', () => {
    it('should always return primary client', () => {
      const client = getPrimaryClient();
      expect(client).toBeDefined();
    });
  });

  describe('isReadReplicaEnabled', () => {
    it('should return false when replica not configured', () => {
      expect(isReadReplicaEnabled()).toBe(false);
    });
  });

  describe('withReadReplica', () => {
    it('should execute query with read client', async () => {
      const mockResult = [{ id: '1' }];
      const queryFn = vi.fn().mockResolvedValue(mockResult);

      const result = await withReadReplica(queryFn);

      expect(queryFn).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('withPrimary', () => {
    it('should execute query with primary client', async () => {
      const mockResult = { id: '1' };
      const queryFn = vi.fn().mockResolvedValue(mockResult);

      const result = await withPrimary(queryFn);

      expect(queryFn).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('executeAnalyticsQuery', () => {
    it('should execute query successfully', async () => {
      const mockResult = { count: 100 };
      const queryFn = vi.fn().mockResolvedValue(mockResult);

      const result = await executeAnalyticsQuery(queryFn);

      expect(result).toEqual(mockResult);
    });

    it('should timeout long-running queries', async () => {
      const slowQuery = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      );

      await expect(
        executeAnalyticsQuery(slowQuery, { timeout: 50 })
      ).rejects.toThrow('Analytics query timeout');
    });

    it('should clean up timeout on success', async () => {
      const fastQuery = vi.fn().mockResolvedValue({ result: 'fast' });

      // Should not leave dangling timers
      const result = await executeAnalyticsQuery(fastQuery, { timeout: 5000 });

      expect(result).toEqual({ result: 'fast' });
    });
  });

  describe('replication lag', () => {
    it('should return lag information', () => {
      const lag = getLastKnownLag();

      expect(lag).toHaveProperty('lagMs');
      expect(lag).toHaveProperty('checkedAt');
      expect(typeof lag.lagMs).toBe('number');
      expect(typeof lag.checkedAt).toBe('number');
    });

    it('should check if replica is acceptable', () => {
      // Without replica enabled, should return false
      const acceptable = isReplicaAcceptable();

      expect(typeof acceptable).toBe('boolean');
    });

    it('should respect max lag threshold', () => {
      // With replica disabled, always returns false
      expect(isReplicaAcceptable(1000)).toBe(false);
      expect(isReplicaAcceptable(10000)).toBe(false);
    });
  });
});
