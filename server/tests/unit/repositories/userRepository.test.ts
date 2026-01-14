/**
 * User Repository Tests
 *
 * Tests for user data access layer operations.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { userRepository } from '../../../src/repositories/userRepository';

describe('User Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.findUnique as Mock).mockResolvedValue(mockUser);

      const result = await userRepository.findById('user-123');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should return null when user not found', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      const result = await userRepository.findById('non-existent');

      expect(result).toBeNull();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.findUnique as Mock).mockRejectedValue(new Error('Database connection failed'));

      await expect(userRepository.findById('user-123')).rejects.toThrow('Database connection failed');
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by email', async () => {
      const mockUser = {
        id: 'user-456',
        email: 'found@example.com',
        username: 'founduser',
        password: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.findUnique as Mock).mockResolvedValue(mockUser);

      const result = await userRepository.findByEmail('found@example.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'found@example.com' },
      });
    });

    it('should return null when email not found', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      const result = await userRepository.findByEmail('notfound@example.com');

      expect(result).toBeNull();
    });

    it('should handle case-sensitive email lookup', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      await userRepository.findByEmail('Test@Example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'Test@Example.com' },
      });
    });
  });

  describe('exists', () => {
    it('should return true when user exists', async () => {
      (prisma.user.count as Mock).mockResolvedValue(1);

      const result = await userRepository.exists('user-123');

      expect(result).toBe(true);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should return false when user does not exist', async () => {
      (prisma.user.count as Mock).mockResolvedValue(0);

      const result = await userRepository.exists('non-existent');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      (prisma.user.count as Mock).mockRejectedValue(new Error('Database error'));

      await expect(userRepository.exists('user-123')).rejects.toThrow('Database error');
    });
  });

  describe('updateEmailVerification', () => {
    it('should set emailVerified to true with timestamp', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmailVerification('user-123', true);

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        },
      });
    });

    it('should set emailVerified to false with null timestamp', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: false,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmailVerification('user-123', false);

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.update as Mock).mockRejectedValue(new Error('Update failed'));

      await expect(userRepository.updateEmailVerification('user-123', true))
        .rejects.toThrow('Update failed');
    });
  });

  describe('updateEmail', () => {
    it('should update email and reset verification status', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'new@example.com',
        username: 'testuser',
        emailVerified: false,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmail('user-123', 'new@example.com');

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          email: 'new@example.com',
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.update as Mock).mockRejectedValue(new Error('Email update failed'));

      await expect(userRepository.updateEmail('user-123', 'new@example.com'))
        .rejects.toThrow('Email update failed');
    });
  });

  describe('emailExists', () => {
    it('should return true when email exists', async () => {
      (prisma.user.count as Mock).mockResolvedValue(1);

      const result = await userRepository.emailExists('existing@example.com');

      expect(result).toBe(true);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { email: 'existing@example.com' },
      });
    });

    it('should return false when email does not exist', async () => {
      (prisma.user.count as Mock).mockResolvedValue(0);

      const result = await userRepository.emailExists('new@example.com');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      (prisma.user.count as Mock).mockRejectedValue(new Error('Database error'));

      await expect(userRepository.emailExists('test@example.com'))
        .rejects.toThrow('Database error');
    });
  });
});
