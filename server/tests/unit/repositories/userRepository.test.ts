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
});
