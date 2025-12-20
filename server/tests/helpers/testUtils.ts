/**
 * Test Utilities
 *
 * Common helper functions for testing.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// JWT secret for testing
const TEST_JWT_SECRET = 'test-jwt-secret-key-for-testing-only';

/**
 * Create a mock Express request
 */
export function createMockRequest(options: {
  body?: Record<string, any>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  user?: {
    userId: string;
    username: string;
    isAdmin: boolean;
  };
  ip?: string;
}): Partial<Request> {
  const mockHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };

  const req = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: mockHeaders,
    user: options.user,
    ip: options.ip || '127.0.0.1',
    get: jest.fn((header: string): string | undefined => {
      return mockHeaders[header.toLowerCase()];
    }),
  };

  return req as unknown as Partial<Request>;
}

/**
 * Create a mock Express response
 */
export function createMockResponse(): {
  res: Partial<Response>;
  getResponse: () => { statusCode: number; body: any };
} {
  let statusCode = 200;
  let responseBody: any = null;

  const res: Partial<Response> = {
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((body: any) => {
      responseBody = body;
      return res;
    }),
    send: jest.fn().mockImplementation((body: any) => {
      responseBody = body;
      return res;
    }),
    end: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
  };

  return {
    res,
    getResponse: () => ({ statusCode, body: responseBody }),
  };
}

/**
 * Create a mock next function
 */
export function createMockNext(): NextFunction {
  return jest.fn();
}

/**
 * Generate a valid JWT token for testing
 * SEC-006: Includes audience claim for proper token type identification
 */
export function generateTestToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
  pending2FA?: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Generate an expired JWT token for testing
 */
export function generateExpiredToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    TEST_JWT_SECRET,
    { expiresIn: '-1h' }
  );
}

/**
 * Generate a token with invalid signature
 */
export function generateInvalidSignatureToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, aud: 'sanctuary:access' },
    'wrong-secret',
    { expiresIn: '1h' }
  );
}

/**
 * Generate a 2FA temporary token for testing
 */
export function generate2FATestToken(payload: {
  userId: string;
  username: string;
  isAdmin: boolean;
}): string {
  return jwt.sign(
    { ...payload, pending2FA: true, aud: 'sanctuary:2fa' },
    TEST_JWT_SECRET,
    { expiresIn: '5m' }
  );
}

/**
 * Generate a refresh token for testing
 */
export function generateRefreshTestToken(userId: string): string {
  return jwt.sign(
    { userId, type: 'refresh', aud: 'sanctuary:refresh' },
    TEST_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a promise that resolves after the current event loop
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Assert that a function throws an error with a specific message
 */
export async function expectAsyncError(
  fn: () => Promise<any>,
  expectedMessage: string | RegExp
): Promise<void> {
  let error: Error | null = null;
  try {
    await fn();
  } catch (e) {
    error = e as Error;
  }

  expect(error).not.toBeNull();
  if (typeof expectedMessage === 'string') {
    expect(error!.message).toContain(expectedMessage);
  } else {
    expect(error!.message).toMatch(expectedMessage);
  }
}

/**
 * Create a spy on console methods and restore after callback
 */
export async function withSuppressedConsole<T>(
  fn: () => Promise<T>
): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

/**
 * Deep clone an object (for creating test fixtures)
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a random hex string of specified length
 */
export function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate a random transaction ID
 */
export function randomTxid(): string {
  return randomHex(64);
}

/**
 * Generate a random Bitcoin address (testnet native segwit)
 */
export function randomAddress(): string {
  // This is a simplified mock, not a valid address
  return 'tb1q' + randomHex(38);
}

/**
 * Convert satoshis to BTC for display
 */
export function satsToBtc(sats: number | bigint): number {
  return Number(sats) / 100000000;
}

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * 100000000);
}

export default {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  generateInvalidSignatureToken,
  generate2FATestToken,
  generateRefreshTestToken,
  wait,
  flushPromises,
  expectAsyncError,
  withSuppressedConsole,
  deepClone,
  randomHex,
  randomTxid,
  randomAddress,
  satsToBtc,
  btcToSats,
};
