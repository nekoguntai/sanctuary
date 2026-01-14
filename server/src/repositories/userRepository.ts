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

/**
 * Update email verification status
 */
export async function updateEmailVerification(
  id: string,
  verified: boolean
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      emailVerified: verified,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}

/**
 * Update user email (triggers need for re-verification)
 */
export async function updateEmail(
  id: string,
  email: string
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      email,
      emailVerified: false,
      emailVerifiedAt: null,
    },
  });
}

/**
 * Check if email is already in use
 */
export async function emailExists(email: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { email },
  });
  return count > 0;
}

// Export as namespace
export const userRepository = {
  findById,
  findByEmail,
  exists,
  updateEmailVerification,
  updateEmail,
  emailExists,
};

export default userRepository;
