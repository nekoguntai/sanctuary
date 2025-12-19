/**
 * Integration Test Helpers
 *
 * Common helper functions for integration tests.
 */

import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Test user credentials
 */
export const TEST_USER = {
  username: 'testuser',
  password: 'TestPassword123!',
  email: 'test@example.com',
};

export const TEST_ADMIN = {
  username: 'admin',
  password: 'AdminPassword123!',
  email: 'admin@example.com',
};

/**
 * Create a test user in the database
 */
export async function createTestUser(
  prisma: PrismaClient,
  user: { username: string; password: string; email?: string; isAdmin?: boolean }
): Promise<{ id: string; username: string }> {
  const hashedPassword = await bcrypt.hash(user.password, 10);

  const created = await prisma.user.create({
    data: {
      username: user.username,
      password: hashedPassword,
      email: user.email,
      isAdmin: user.isAdmin ?? false,
      preferences: {},
    },
  });

  return { id: created.id, username: created.username };
}

/**
 * Login and get auth token
 */
export async function loginTestUser(
  app: Express,
  credentials: { username: string; password: string }
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send(credentials)
    .expect(200);

  return response.body.token;
}

/**
 * Create a test user and login
 */
export async function createAndLoginUser(
  app: Express,
  prisma: PrismaClient,
  user?: { username: string; password: string; isAdmin?: boolean }
): Promise<{ userId: string; token: string }> {
  const testUser = user ?? TEST_USER;
  const { id } = await createTestUser(prisma, testUser);
  const token = await loginTestUser(app, testUser);
  return { userId: id, token };
}

/**
 * Create a test wallet
 */
export async function createTestWallet(
  app: Express,
  token: string,
  walletData?: Partial<{
    name: string;
    type: string;
    scriptType: string;
    network: string;
    descriptor: string;
  }>
): Promise<{ id: string; name: string }> {
  const defaultDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)";

  const response = await request(app)
    .post('/api/v1/wallets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: walletData?.name ?? 'Test Wallet',
      type: walletData?.type ?? 'single_sig',
      scriptType: walletData?.scriptType ?? 'native_segwit',
      network: walletData?.network ?? 'testnet',
      descriptor: walletData?.descriptor ?? defaultDescriptor,
    })
    .expect(201);

  return { id: response.body.id, name: response.body.name };
}

/**
 * Auth header helper
 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
