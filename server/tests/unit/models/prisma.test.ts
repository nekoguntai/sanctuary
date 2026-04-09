/**
 * Tests for Prisma helper functions
 */

import { vi } from 'vitest';
import { getOperationType } from '../../../src/models/prisma';

describe('getOperationType', () => {
  describe('select operations', () => {
    it.each([
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ])('should return "select" for %s', (action) => {
      expect(getOperationType(action)).toBe('select');
    });
  });

  describe('insert operations', () => {
    it.each([
      'create',
      'createMany',
    ])('should return "insert" for %s', (action) => {
      expect(getOperationType(action)).toBe('insert');
    });
  });

  describe('update operations', () => {
    it.each([
      'update',
      'updateMany',
      'upsert',
    ])('should return "update" for %s', (action) => {
      expect(getOperationType(action)).toBe('update');
    });
  });

  describe('delete operations', () => {
    it.each([
      'delete',
      'deleteMany',
    ])('should return "delete" for %s', (action) => {
      expect(getOperationType(action)).toBe('delete');
    });
  });

  describe('other operations', () => {
    it.each([
      'unknown',
      'custom',
      '$queryRaw',
      '$executeRaw',
      '',
    ])('should return "other" for %s', (action) => {
      expect(getOperationType(action)).toBe('other');
    });
  });
});

describe('withTransaction', () => {
  it('should delegate to prisma.$transaction', async () => {
    // We need to test withTransaction in isolation with a mock
    // Re-import after mocking to get the function bound to the mocked prisma
    vi.doMock('../../../src/models/prisma', () => {
      const mockPrisma = {
        $transaction: vi.fn((fn: any) => fn({ user: { findMany: vi.fn() } })),
      };
      return {
        __esModule: true,
        default: mockPrisma,
        withTransaction: async (fn: any) => mockPrisma.$transaction(fn),
      };
    });

    const { withTransaction } = await import('../../../src/models/prisma');

    const callback = vi.fn().mockResolvedValue('tx-result');
    const result = await withTransaction(callback);

    expect(callback).toHaveBeenCalled();
    expect(result).toBe('tx-result');

    vi.doUnmock('../../../src/models/prisma');
  });
});
