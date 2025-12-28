/**
 * User Repository
 *
 * Abstracts database operations for users.
 */

import prisma from '../models/prisma';
import type { User } from '@prisma/client';

/**
 * Find user by ID
 */
export async function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
  });
}

/**
 * Find user by email
 */
export async function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email },
  });
}

/**
 * Check if user exists
 */
export async function exists(id: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { id },
  });
  return count > 0;
}

// Export as namespace
export const userRepository = {
  findById,
  findByEmail,
  exists,
};

export default userRepository;
