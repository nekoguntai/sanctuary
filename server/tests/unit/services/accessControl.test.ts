/**
 * Access Control Service Tests
 *
 * Tests authorization checks and role-based access control.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  default: {
    walletUser: {
      findFirst: vi.fn(),
    },
    wallet: {
      findFirst: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
    },
    address: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock Redis/cache
vi.mock('../../../src/infrastructure/redis', () => ({
  getNamespacedCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deletePattern: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import prisma from '../../../src/models/prisma';
import {
  getUserWalletRole,
  checkWalletAccess,
  requireWalletAccess,
  requireWalletEditAccess,
  requireWalletOwnerAccess,
  checkTransactionAccess,
  requireTransactionAccess,
  buildWalletAccessWhere,
} from '../../../src/services/accessControl';
import { NotFoundError, ForbiddenError, WalletNotFoundError } from '../../../src/errors';

describe('Access Control Service', () => {
  const userId = faker.string.uuid();
  const walletId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildWalletAccessWhere', () => {
    it('should build correct Prisma WHERE clause', () => {
      const where = buildWalletAccessWhere(userId);

      expect(where).toEqual({
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      });
    });
  });

  describe('getUserWalletRole', () => {
    it('should return owner role for direct owner access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'owner',
        addedAt: new Date(),
      });

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('owner');
      expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
        where: { walletId, userId },
      });
    });

    it('should return signer role for direct signer access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'signer',
        addedAt: new Date(),
      });

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('signer');
    });

    it('should return viewer role for direct viewer access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'viewer',
        addedAt: new Date(),
      });

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('viewer');
    });

    it('should check group access when no direct access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue({
        id: walletId,
        groupRole: 'viewer',
      } as never);

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('viewer');
      expect(prisma.wallet.findFirst).toHaveBeenCalled();
    });

    it('should return null when no access exists', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBeNull();
    });
  });

  describe('checkWalletAccess', () => {
    it('should return full access for owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'owner',
        addedAt: new Date(),
      });

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(true);
      expect(access.role).toBe('owner');
    });

    it('should return edit access for signer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'signer',
        addedAt: new Date(),
      });

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(true);
      expect(access.role).toBe('signer');
    });

    it('should return view-only access for viewer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'viewer',
        addedAt: new Date(),
      });

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(false);
      expect(access.role).toBe('viewer');
    });

    it('should return no access when user has no role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(false);
      expect(access.canEdit).toBe(false);
      expect(access.role).toBeNull();
    });
  });

  describe('requireWalletAccess', () => {
    it('should return context when user has access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'viewer',
        addedAt: new Date(),
      });

      const context = await requireWalletAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.role).toBe('viewer');
      expect(context.canEdit).toBe(false);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('requireWalletEditAccess', () => {
    it('should return context when user can edit', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'signer',
        addedAt: new Date(),
      });

      const context = await requireWalletEditAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.canEdit).toBe(true);
    });

    it('should throw ForbiddenError when user cannot edit', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'viewer',
        addedAt: new Date(),
      });

      await expect(requireWalletEditAccess(walletId, userId)).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when no access at all', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletEditAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('requireWalletOwnerAccess', () => {
    it('should return context when user is owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'owner',
        addedAt: new Date(),
      });

      const context = await requireWalletOwnerAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.role).toBe('owner');
    });

    it('should throw ForbiddenError when user is signer not owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'signer',
        addedAt: new Date(),
      });

      await expect(requireWalletOwnerAccess(walletId, userId)).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletOwnerAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('checkTransactionAccess', () => {
    const transactionId = faker.string.uuid();

    it('should return access when user has wallet access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
        walletId,
      } as never);
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'owner',
        addedAt: new Date(),
      });

      const access = await checkTransactionAccess(transactionId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.walletId).toBe(walletId);
      expect(access.canEdit).toBe(true);
    });

    it('should return no access when transaction not found', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

      const access = await checkTransactionAccess(transactionId, userId);

      expect(access.hasAccess).toBe(false);
      expect(access.walletId).toBeNull();
    });
  });

  describe('requireTransactionAccess', () => {
    const transactionId = faker.string.uuid();

    it('should return context when user has access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
        walletId,
      } as never);
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
        id: faker.string.uuid(),
        walletId,
        userId,
        role: 'viewer',
        addedAt: new Date(),
      });

      const result = await requireTransactionAccess(transactionId, userId);

      expect(result.walletId).toBe(walletId);
      expect(result.canEdit).toBe(false);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

      await expect(requireTransactionAccess(transactionId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('Address Access', () => {
    const addressId = faker.string.uuid();

    describe('checkAddressAccess', () => {
      it('should return access when user has wallet access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'owner',
          addedAt: new Date(),
        });

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(true);
        expect(access.walletId).toBe(walletId);
        expect(access.canEdit).toBe(true);
      });

      it('should return no access when address not found', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(false);
        expect(access.walletId).toBeNull();
      });

      it('should return view-only access for viewer', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(true);
        expect(access.canEdit).toBe(false);
      });
    });

    describe('requireAddressAccess', () => {
      it('should return context when user has access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'signer',
          addedAt: new Date(),
        });

        const { requireAddressAccess } = await import('../../../src/services/accessControl');
        const result = await requireAddressAccess(addressId, userId);

        expect(result.walletId).toBe(walletId);
        expect(result.canEdit).toBe(true);
      });

      it('should throw NotFoundError when no access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { requireAddressAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressAccess(addressId, userId)).rejects.toThrow(NotFoundError);
      });
    });

    describe('requireAddressEditAccess', () => {
      it('should return context when user can edit', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'owner',
          addedAt: new Date(),
        });

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        const result = await requireAddressEditAccess(addressId, userId);

        expect(result.walletId).toBe(walletId);
      });

      it('should throw ForbiddenError when user cannot edit', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressEditAccess(addressId, userId)).rejects.toThrow(ForbiddenError);
      });

      it('should throw NotFoundError when address not found', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressEditAccess(addressId, userId)).rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('Transaction Edit Access', () => {
    const transactionId = faker.string.uuid();

    describe('requireTransactionEditAccess', () => {
      it('should return context when user can edit', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'signer',
          addedAt: new Date(),
        });

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        const result = await requireTransactionEditAccess(transactionId, userId);

        expect(result.walletId).toBe(walletId);
      });

      it('should throw ForbiddenError when user cannot edit', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireTransactionEditAccess(transactionId, userId)).rejects.toThrow(ForbiddenError);
      });

      it('should throw NotFoundError when transaction not found', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireTransactionEditAccess(transactionId, userId)).rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('Cache Management', () => {
    describe('invalidateWalletAccessCache', () => {
      it('should delete cache pattern for wallet', async () => {
        const { invalidateWalletAccessCache } = await import('../../../src/services/accessControl');
        await invalidateWalletAccessCache(walletId);
        // Should complete without throwing
      });
    });

    describe('invalidateUserAccessCache', () => {
      it('should delete cache pattern for user', async () => {
        const { invalidateUserAccessCache } = await import('../../../src/services/accessControl');
        await invalidateUserAccessCache(userId);
        // Should complete without throwing
      });
    });

    describe('clearAccessCache', () => {
      it('should clear entire cache', async () => {
        const { clearAccessCache } = await import('../../../src/services/accessControl');
        await clearAccessCache();
        // Should complete without throwing
      });
    });
  });
});
