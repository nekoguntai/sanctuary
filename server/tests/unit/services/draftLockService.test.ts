/**
 * Draft UTXO Lock Service Tests
 *
 * Tests for UTXO locking functionality used by draft transactions
 * to prevent double-spending when multiple drafts exist.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock the Prisma client before importing the service
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Now import the service after mocks are set up
import {
  lockUtxosForDraft,
  unlockUtxosForDraft,
  getAvailableUtxoIds,
  getLocksForDraft,
  isUtxoLocked,
  resolveUtxoIds,
} from '../../../src/services/draftLockService';

describe('Draft UTXO Lock Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  describe('lockUtxosForDraft', () => {
    const draftId = 'draft-123';
    const utxoIds = ['utxo-1', 'utxo-2', 'utxo-3'];

    it('should skip locking for RBF drafts and return success', async () => {
      const result = await lockUtxosForDraft(draftId, utxoIds, { isRBF: true });

      expect(result.success).toBe(true);
      expect(result.lockedCount).toBe(0);
      expect(result.failedUtxoIds).toEqual([]);
      expect(result.lockedByDraftIds).toEqual([]);
      expect(mockPrismaClient.draftUtxoLock.findMany).not.toHaveBeenCalled();
    });

    it('should return success for empty UTXO list', async () => {
      const result = await lockUtxosForDraft(draftId, []);

      expect(result.success).toBe(true);
      expect(result.lockedCount).toBe(0);
      expect(result.failedUtxoIds).toEqual([]);
    });

    it('should lock UTXOs when none are already locked', async () => {
      // No existing locks
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      const result = await lockUtxosForDraft(draftId, utxoIds);

      expect(result.success).toBe(true);
      expect(result.lockedCount).toBe(3);
      expect(result.failedUtxoIds).toEqual([]);
      expect(result.lockedByDraftIds).toEqual([]);

      // Verify transaction was called
      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it('should fail when UTXOs are already locked by another draft', async () => {
      // Simulate UTXOs locked by another draft
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        {
          id: 'lock-1',
          draftId: 'other-draft-456',
          utxoId: 'utxo-1',
          createdAt: new Date(),
          draft: { id: 'other-draft-456', label: 'Other Draft' },
          utxo: { txid: 'abc', vout: 0 },
        },
        {
          id: 'lock-2',
          draftId: 'other-draft-456',
          utxoId: 'utxo-2',
          createdAt: new Date(),
          draft: { id: 'other-draft-456', label: 'Other Draft' },
          utxo: { txid: 'def', vout: 1 },
        },
      ]);

      const result = await lockUtxosForDraft(draftId, utxoIds);

      expect(result.success).toBe(false);
      expect(result.lockedCount).toBe(0);
      expect(result.failedUtxoIds).toEqual(['utxo-1', 'utxo-2']);
      expect(result.lockedByDraftIds).toEqual(['other-draft-456']);
    });

    it('should handle unique constraint violation (race condition)', async () => {
      // No existing locks found initially
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      // But createMany fails with unique constraint (race condition)
      mockPrismaClient.$transaction.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`utxoId`)')
      );

      const result = await lockUtxosForDraft(draftId, utxoIds);

      expect(result.success).toBe(false);
      expect(result.failedUtxoIds).toEqual(utxoIds);
    });

    it('should allow re-locking by the same draft', async () => {
      // Locks exist but belong to the same draft (excluded by query)
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);
      // Reset the $transaction mock to default success behavior
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return callback(mockPrismaClient);
        }
        return Promise.all(callback);
      });

      const result = await lockUtxosForDraft(draftId, utxoIds);

      expect(result.success).toBe(true);
      expect(result.lockedCount).toBe(3);
    });

    it('should throw for unexpected errors', async () => {
      mockPrismaClient.draftUtxoLock.findMany.mockRejectedValue(
        new Error('Database connection lost')
      );

      await expect(lockUtxosForDraft(draftId, utxoIds)).rejects.toThrow(
        'Database connection lost'
      );
    });
  });

  describe('unlockUtxosForDraft', () => {
    const draftId = 'draft-123';

    it('should unlock all UTXOs for a draft', async () => {
      mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 3 });

      const result = await unlockUtxosForDraft(draftId);

      expect(result).toBe(3);
      expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
        where: { draftId },
      });
    });

    it('should return 0 when no locks exist', async () => {
      mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 0 });

      const result = await unlockUtxosForDraft(draftId);

      expect(result).toBe(0);
    });

    it('should throw on database error', async () => {
      mockPrismaClient.draftUtxoLock.deleteMany.mockRejectedValue(
        new Error('Database error')
      );

      await expect(unlockUtxosForDraft(draftId)).rejects.toThrow('Database error');
    });
  });

  describe('getAvailableUtxoIds', () => {
    const utxoIds = ['utxo-1', 'utxo-2', 'utxo-3'];

    it('should return all UTXOs as available when none are locked', async () => {
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      const result = await getAvailableUtxoIds(utxoIds);

      expect(result.available).toEqual(utxoIds);
      expect(result.locked).toEqual([]);
    });

    it('should filter out locked UTXOs', async () => {
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        {
          id: 'lock-1',
          draftId: 'draft-456',
          utxoId: 'utxo-2',
          createdAt: new Date('2024-01-15'),
          draft: { id: 'draft-456', label: 'Pending Payment' },
          utxo: { id: 'utxo-2', txid: 'txid-abc', vout: 1 },
        },
      ]);

      const result = await getAvailableUtxoIds(utxoIds);

      expect(result.available).toEqual(['utxo-1', 'utxo-3']);
      expect(result.locked).toHaveLength(1);
      expect(result.locked[0]).toMatchObject({
        utxoId: 'utxo-2',
        draftId: 'draft-456',
        draftLabel: 'Pending Payment',
      });
    });

    it('should exclude specified draft from lock check', async () => {
      // First call without excludeDraftId returns locks
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      const result = await getAvailableUtxoIds(utxoIds, 'my-draft');

      expect(result.available).toEqual(utxoIds);
      expect(mockPrismaClient.draftUtxoLock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            draftId: { not: 'my-draft' },
          }),
        })
      );
    });

    it('should return empty arrays for empty input', async () => {
      const result = await getAvailableUtxoIds([]);

      expect(result.available).toEqual([]);
      expect(result.locked).toEqual([]);
      expect(mockPrismaClient.draftUtxoLock.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getLocksForDraft', () => {
    const draftId = 'draft-123';

    it('should return all locks for a specific draft', async () => {
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        {
          id: 'lock-1',
          draftId,
          utxoId: 'utxo-1',
          createdAt: new Date('2024-01-15'),
          draft: { id: draftId, label: 'My Draft' },
          utxo: { id: 'utxo-1', txid: 'txid-abc', vout: 0 },
        },
        {
          id: 'lock-2',
          draftId,
          utxoId: 'utxo-2',
          createdAt: new Date('2024-01-15'),
          draft: { id: draftId, label: 'My Draft' },
          utxo: { id: 'utxo-2', txid: 'txid-def', vout: 1 },
        },
      ]);

      const result = await getLocksForDraft(draftId);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        utxoId: 'utxo-1',
        txid: 'txid-abc',
        vout: 0,
        draftId,
        draftLabel: 'My Draft',
      });
    });

    it('should return empty array when no locks exist', async () => {
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      const result = await getLocksForDraft(draftId);

      expect(result).toEqual([]);
    });
  });

  describe('isUtxoLocked', () => {
    const utxoId = 'utxo-123';

    it('should return locked=true when UTXO is locked', async () => {
      mockPrismaClient.draftUtxoLock.findUnique.mockResolvedValue({
        id: 'lock-1',
        draftId: 'draft-456',
        utxoId,
        createdAt: new Date(),
      });

      const result = await isUtxoLocked(utxoId);

      expect(result.locked).toBe(true);
      expect(result.draftId).toBe('draft-456');
    });

    it('should return locked=false when UTXO is not locked', async () => {
      mockPrismaClient.draftUtxoLock.findUnique.mockResolvedValue(null);

      const result = await isUtxoLocked(utxoId);

      expect(result.locked).toBe(false);
      expect(result.draftId).toBeUndefined();
    });
  });

  describe('resolveUtxoIds', () => {
    const walletId = 'wallet-123';

    it('should resolve txid:vout references to UTXO IDs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'txid-aaa', vout: 0 },
        { id: 'utxo-2', txid: 'txid-bbb', vout: 1 },
      ]);

      const result = await resolveUtxoIds(walletId, [
        'txid-aaa:0',
        'txid-bbb:1',
      ]);

      expect(result.found).toEqual(['utxo-1', 'utxo-2']);
      expect(result.notFound).toEqual([]);
    });

    it('should report UTXOs that could not be found', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'txid-aaa', vout: 0 },
      ]);

      const result = await resolveUtxoIds(walletId, [
        'txid-aaa:0',
        'txid-missing:5',
        'txid-gone:3',
      ]);

      expect(result.found).toEqual(['utxo-1']);
      expect(result.notFound).toEqual(['txid-missing:5', 'txid-gone:3']);
    });

    it('should return empty arrays for empty input', async () => {
      const result = await resolveUtxoIds(walletId, []);

      expect(result.found).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalled();
    });

    it('should query with correct wallet filter', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await resolveUtxoIds(walletId, ['txid-abc:0']);

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            walletId,
          }),
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle UTXOs with same txid but different vouts', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'same-txid', vout: 0 },
        { id: 'utxo-2', txid: 'same-txid', vout: 1 },
        { id: 'utxo-3', txid: 'same-txid', vout: 2 },
      ]);

      const result = await resolveUtxoIds('wallet-1', [
        'same-txid:0',
        'same-txid:1',
        'same-txid:2',
      ]);

      expect(result.found).toHaveLength(3);
      expect(result.notFound).toEqual([]);
    });

    it('should handle locking single UTXO', async () => {
      // Reset all relevant mocks for this test
      resetPrismaMocks();
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      const result = await lockUtxosForDraft('draft-1', ['single-utxo']);

      expect(result.success).toBe(true);
      expect(result.lockedCount).toBe(1);
    });

    it('should handle concurrent lock requests to same UTXO', async () => {
      // First request finds no locks
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([]);

      // But second concurrent request already locked it (unique constraint)
      mockPrismaClient.$transaction.mockRejectedValueOnce(
        new Error('Unique constraint failed')
      );

      const result = await lockUtxosForDraft('draft-late', ['contested-utxo']);

      expect(result.success).toBe(false);
    });
  });
});
