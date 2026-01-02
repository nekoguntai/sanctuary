/**
 * Tests for Prisma helper functions
 */

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
