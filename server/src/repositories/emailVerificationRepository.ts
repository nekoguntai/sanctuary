/**
 * Email Verification Repository
 *
 * Abstracts database operations for email verification tokens.
 */

import prisma from '../models/prisma';
import type { EmailVerificationToken } from '@prisma/client';

/**
 * Create a new email verification token
 */
export async function create(data: {
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<EmailVerificationToken> {
  return prisma.emailVerificationToken.create({
    data,
  });
}

/**
 * Find verification token by hash
 */
export async function findByTokenHash(
  tokenHash: string
): Promise<EmailVerificationToken | null> {
  return prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });
}

/**
 * Find pending (unused, not expired) verification token for a user
 */
export async function findPendingByUserId(
  userId: string
): Promise<EmailVerificationToken | null> {
  return prisma.emailVerificationToken.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all pending tokens for a user (for cleanup when new token is created)
 */
export async function findAllPendingByUserId(
  userId: string
): Promise<EmailVerificationToken[]> {
  return prisma.emailVerificationToken.findMany({
    where: {
      userId,
      usedAt: null,
    },
  });
}

/**
 * Mark a token as used (verified)
 */
export async function markUsed(id: string): Promise<EmailVerificationToken> {
  return prisma.emailVerificationToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

/**
 * Delete all tokens for a user (cleanup after verification or user deletion)
 */
export async function deleteByUserId(userId: string): Promise<number> {
  const result = await prisma.emailVerificationToken.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete expired tokens (maintenance job)
 */
export async function deleteExpired(): Promise<number> {
  const result = await prisma.emailVerificationToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Delete unused tokens for a user (when creating a new token)
 */
export async function deleteUnusedByUserId(userId: string): Promise<number> {
  const result = await prisma.emailVerificationToken.deleteMany({
    where: {
      userId,
      usedAt: null,
    },
  });
  return result.count;
}

/**
 * Count pending tokens for a user (for rate limiting)
 */
export async function countPendingByUserId(userId: string): Promise<number> {
  return prisma.emailVerificationToken.count({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Count tokens created in timeframe for a user (for rate limiting)
 */
export async function countCreatedSince(
  userId: string,
  since: Date
): Promise<number> {
  return prisma.emailVerificationToken.count({
    where: {
      userId,
      createdAt: { gt: since },
    },
  });
}

// Export as namespace
export const emailVerificationRepository = {
  create,
  findByTokenHash,
  findPendingByUserId,
  findAllPendingByUserId,
  markUsed,
  deleteByUserId,
  deleteExpired,
  deleteUnusedByUserId,
  countPendingByUserId,
  countCreatedSince,
};

export default emailVerificationRepository;
