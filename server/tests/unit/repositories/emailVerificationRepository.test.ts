/**
 * Email Verification Repository Tests
 *
 * Tests for email verification token data access operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import type { Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    emailVerificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { emailVerificationRepository } from '../../../src/repositories/emailVerificationRepository';

describe('Email Verification Repository', () => {
  const testUserId = faker.string.uuid();
  const testTokenId = faker.string.uuid();
  const testEmail = faker.internet.email().toLowerCase();
  const testTokenHash = faker.string.alphanumeric(64);
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const mockToken = {
    id: testTokenId,
    userId: testUserId,
    email: testEmail,
    tokenHash: testTokenHash,
    expiresAt: futureDate,
    createdAt: new Date(),
    usedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new verification token', async () => {
      (prisma.emailVerificationToken.create as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.create({
        userId: testUserId,
        email: testEmail,
        tokenHash: testTokenHash,
        expiresAt: futureDate,
      });

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.emailVerificationToken.create as Mock).mockRejectedValue(
        new Error('Unique constraint violation')
      );

      await expect(
        emailVerificationRepository.create({
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        })
      ).rejects.toThrow('Unique constraint violation');
    });
  });

  describe('findByTokenHash', () => {
    it('should find token by hash', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.findByTokenHash(testTokenHash);

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: testTokenHash },
      });
    });

    it('should return null when token not found', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(null);

      const result = await emailVerificationRepository.findByTokenHash('non-existent-hash');

      expect(result).toBeNull();
    });
  });

  describe('findPendingByUserId', () => {
    it('should find unused, non-expired token for user', async () => {
      (prisma.emailVerificationToken.findFirst as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.findPendingByUserId(testUserId);

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null when no pending token exists', async () => {
      (prisma.emailVerificationToken.findFirst as Mock).mockResolvedValue(null);

      const result = await emailVerificationRepository.findPendingByUserId(testUserId);

      expect(result).toBeNull();
    });
  });

  describe('findAllPendingByUserId', () => {
    it('should find all unused tokens for user', async () => {
      const tokens = [mockToken, { ...mockToken, id: faker.string.uuid() }];
      (prisma.emailVerificationToken.findMany as Mock).mockResolvedValue(tokens);

      const result = await emailVerificationRepository.findAllPendingByUserId(testUserId);

      expect(result).toEqual(tokens);
      expect(prisma.emailVerificationToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
    });

    it('should return empty array when no tokens exist', async () => {
      (prisma.emailVerificationToken.findMany as Mock).mockResolvedValue([]);

      const result = await emailVerificationRepository.findAllPendingByUserId(testUserId);

      expect(result).toEqual([]);
    });
  });

  describe('markUsed', () => {
    it('should mark token as used with timestamp', async () => {
      const usedToken = { ...mockToken, usedAt: new Date() };
      (prisma.emailVerificationToken.update as Mock).mockResolvedValue(usedToken);

      const result = await emailVerificationRepository.markUsed(testTokenId);

      expect(result.usedAt).toBeDefined();
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: testTokenId },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('should throw when token not found', async () => {
      (prisma.emailVerificationToken.update as Mock).mockRejectedValue(
        new Error('Record not found')
      );

      await expect(emailVerificationRepository.markUsed('non-existent-id')).rejects.toThrow(
        'Record not found'
      );
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all tokens for user and return count', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 3 });

      const result = await emailVerificationRepository.deleteByUserId(testUserId);

      expect(result).toBe(3);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId },
      });
    });

    it('should return 0 when no tokens exist', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired tokens and return count', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 5 });

      const result = await emailVerificationRepository.deleteExpired();

      expect(result).toBe(5);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it('should return 0 when no expired tokens', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteExpired();

      expect(result).toBe(0);
    });
  });

  describe('deleteUnusedByUserId', () => {
    it('should delete only unused tokens for user', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 2 });

      const result = await emailVerificationRepository.deleteUnusedByUserId(testUserId);

      expect(result).toBe(2);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
    });

    it('should not delete used tokens', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteUnusedByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('countPendingByUserId', () => {
    it('should count pending tokens for user', async () => {
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(3);

      const result = await emailVerificationRepository.countPendingByUserId(testUserId);

      expect(result).toBe(3);
      expect(prisma.emailVerificationToken.count).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('should return 0 when no pending tokens', async () => {
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(0);

      const result = await emailVerificationRepository.countPendingByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('countCreatedSince', () => {
    it('should count tokens created since timestamp', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(4);

      const result = await emailVerificationRepository.countCreatedSince(testUserId, oneHourAgo);

      expect(result).toBe(4);
      expect(prisma.emailVerificationToken.count).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          createdAt: { gt: oneHourAgo },
        },
      });
    });

    it('should return 0 when no tokens created in timeframe', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(0);

      const result = await emailVerificationRepository.countCreatedSince(testUserId, oneHourAgo);

      expect(result).toBe(0);
    });
  });
});
