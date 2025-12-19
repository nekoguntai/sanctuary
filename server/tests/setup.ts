/**
 * Jest Test Setup
 *
 * Global test configuration and setup that runs before each test file.
 * Sets up environment variables, mocks, and global test utilities.
 */

// Set test environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '1h';

// Mock the logger to prevent console spam during tests
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock the requestContext
jest.mock('../src/utils/requestContext', () => ({
  requestContext: {
    setUser: jest.fn(),
    getUser: jest.fn(() => ({ userId: 'test-user-id', username: 'testuser' })),
    clear: jest.fn(),
  },
}));

// Global test utilities
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

// Extend Jest matchers with custom matchers
expect.extend({
  /**
   * Custom matcher to check if a value is a valid Bitcoin address format
   */
  toBeValidBitcoinAddress(received: string) {
    const mainnetP2PKH = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const mainnetP2SH = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const mainnetBech32 = /^bc1[a-z0-9]{39,59}$/;
    const testnetP2PKH = /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const testnetP2SH = /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const testnetBech32 = /^tb1[a-z0-9]{39,59}$/;

    const isValid =
      mainnetP2PKH.test(received) ||
      mainnetP2SH.test(received) ||
      mainnetBech32.test(received) ||
      testnetP2PKH.test(received) ||
      testnetP2SH.test(received) ||
      testnetBech32.test(received);

    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid Bitcoin address`
          : `Expected ${received} to be a valid Bitcoin address`,
    };
  },

  /**
   * Custom matcher to check if value is a valid transaction ID (64 hex chars)
   */
  toBeValidTxid(received: string) {
    const isValid = /^[a-f0-9]{64}$/i.test(received);
    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid transaction ID`
          : `Expected ${received} to be a valid transaction ID (64 hex characters)`,
    };
  },

  /**
   * Custom matcher to check if value is a valid PSBT (base64 encoded)
   */
  toBeValidPsbt(received: string) {
    // PSBT starts with "cHNi" when base64 encoded (from "psbt" magic bytes)
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(received);
    const startsWithPsbtMagic = received.startsWith('cHNi');
    const isValid = isBase64 && startsWithPsbtMagic;
    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received.substring(0, 20)}... not to be a valid PSBT`
          : `Expected value to be a valid PSBT (base64 encoded starting with psbt magic bytes)`,
    };
  },
});

// Type declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidBitcoinAddress(): R;
      toBeValidTxid(): R;
      toBeValidPsbt(): R;
    }
  }
}

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn() as any,
    debug: jest.fn() as any,
    info: jest.fn() as any,
    warn: jest.fn() as any,
    // Keep error for debugging test failures
    error: console.error,
  };
}

export {};
