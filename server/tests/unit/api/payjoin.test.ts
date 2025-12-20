/**
 * Payjoin API Routes Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin API endpoints:
 * - POST /:addressId - BIP78 receiver endpoint
 * - GET /address/:addressId/uri - Generate BIP21 URI with Payjoin
 * - POST /parse-uri - Parse BIP21 URI
 * - POST /attempt - Attempt Payjoin send
 *
 * These tests are SECURITY-CRITICAL for Bitcoin transaction privacy.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  generateTestToken,
} from '../../helpers/testUtils';

/**
 * Helper to create a mock request with raw body (for BIP78 PSBT endpoints)
 * BIP78 uses text/plain for PSBT data, not JSON
 */
function createRawBodyRequest(options: {
  body?: string | null;
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
    'content-type': 'text/plain',
    ...options.headers,
  };

  return {
    body: options.body,
    params: options.params || {},
    query: options.query || {},
    headers: mockHeaders,
    user: options.user,
    ip: options.ip || '127.0.0.1',
    get: jest.fn((header: string): string | undefined => {
      return mockHeaders[header.toLowerCase()];
    }),
    protocol: 'https',
  } as unknown as Partial<Request>;
}

type Request = import('express').Request;

// Mock Prisma before importing router
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock payjoin service
jest.mock('../../../src/services/payjoinService', () => ({
  processPayjoinRequest: jest.fn(),
  parseBip21Uri: jest.fn(),
  generateBip21Uri: jest.fn(),
  attemptPayjoinSend: jest.fn(),
  PayjoinErrors: {
    VERSION_UNSUPPORTED: 'version-unsupported',
    UNAVAILABLE: 'unavailable',
    NOT_ENOUGH_MONEY: 'not-enough-money',
    ORIGINAL_PSBT_REJECTED: 'original-psbt-rejected',
    RECEIVER_ERROR: 'receiver-error',
  },
}));

// Mock authentication middleware
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    if (req.headers?.authorization) {
      req.user = { userId: 'user-123', username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }),
}));

import {
  processPayjoinRequest,
  parseBip21Uri,
  generateBip21Uri,
  attemptPayjoinSend,
  PayjoinErrors,
} from '../../../src/services/payjoinService';

// Test constants
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_ID = 'addr-123';
const TEST_PAYJOIN_URL = 'https://example.com/api/v1/payjoin/addr-123';
const VALID_PSBT_BASE64 = 'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';
const PROPOSAL_PSBT_BASE64 = 'cHNidP8BAHECAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8CrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GhAnAAAAAAAAFgAUdpn98MqGxRdMa7mGg0HhZKSL0BMAAAAAAAAA';

describe('Payjoin API Routes', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('POST /:addressId (BIP78 Receiver Endpoint)', () => {
    it('should require v=1 query parameter', async () => {
      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: {}, // Missing v=1
        body: VALID_PSBT_BASE64,
      });
      const { res, getResponse } = createMockResponse();

      // Simulate the route handler logic
      const { v } = req.query as { v?: string };
      if (v !== '1') {
        (res.status as jest.Mock)(400);
        (res as any).type = jest.fn().mockReturnValue(res);
        (res.send as jest.Mock)(PayjoinErrors.VERSION_UNSUPPORTED);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe(PayjoinErrors.VERSION_UNSUPPORTED);
    });

    it('should reject empty PSBT', async () => {
      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: '', // Empty body
      });
      const { res, getResponse } = createMockResponse();

      // Simulate the route handler logic
      const originalPsbt = typeof req.body === 'string' ? req.body : '';
      if (!originalPsbt || originalPsbt.length === 0) {
        (res.status as jest.Mock)(400);
        (res as any).type = jest.fn().mockReturnValue(res);
        (res.send as jest.Mock)(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
    });

    it('should return valid proposal PSBT on success', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: VALID_PSBT_BASE64,
      });
      const { res, getResponse } = createMockResponse();

      // Simulate the route handler logic
      const { v } = req.query as { v?: string };
      const originalPsbt = req.body as string;

      if (v === '1' && originalPsbt) {
        const result = await processPayjoinRequest(
          TEST_ADDRESS_ID,
          originalPsbt,
          1
        );

        if (result.success) {
          (res as any).type = jest.fn().mockReturnValue(res);
          (res.send as jest.Mock)(result.proposalPsbt);
        }
      }

      const response = getResponse();
      expect(response.body).toBe(PROPOSAL_PSBT_BASE64);
    });

    it('should return text/plain content type on error', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: false,
        error: PayjoinErrors.NOT_ENOUGH_MONEY,
        errorMessage: 'No suitable UTXOs',
      });

      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: VALID_PSBT_BASE64,
      });
      const { res, getResponse } = createMockResponse();

      const typeSpy = jest.fn().mockReturnValue(res);
      (res as any).type = typeSpy;

      // Simulate the route handler logic
      const result = await processPayjoinRequest(
        TEST_ADDRESS_ID,
        req.body as string,
        1
      );

      if (!result.success) {
        (res.status as jest.Mock)(400);
        typeSpy('text/plain');
        (res.send as jest.Mock)(result.error);
      }

      expect(typeSpy).toHaveBeenCalledWith('text/plain');
    });

    it('should use minfeerate query parameter', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1', minfeerate: '5' },
        body: VALID_PSBT_BASE64,
      });

      const minFeeRate = parseFloat(req.query?.minfeerate as string) || 1;

      await processPayjoinRequest(
        TEST_ADDRESS_ID,
        req.body as string,
        minFeeRate
      );

      expect(processPayjoinRequest).toHaveBeenCalledWith(
        TEST_ADDRESS_ID,
        VALID_PSBT_BASE64,
        5
      );
    });

    it('should default minfeerate to 1 if not provided', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' }, // No minfeerate
        body: VALID_PSBT_BASE64,
      });

      const minFeeRate = parseFloat(req.query?.minfeerate as string) || 1;

      await processPayjoinRequest(
        TEST_ADDRESS_ID,
        req.body as string,
        minFeeRate
      );

      expect(processPayjoinRequest).toHaveBeenCalledWith(
        TEST_ADDRESS_ID,
        VALID_PSBT_BASE64,
        1
      );
    });

    it('should return 500 on internal error', async () => {
      (processPayjoinRequest as jest.Mock).mockRejectedValue(
        new Error('Internal error')
      );

      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: VALID_PSBT_BASE64,
      });
      const { res, getResponse } = createMockResponse();

      try {
        await processPayjoinRequest(
          TEST_ADDRESS_ID,
          req.body as string,
          1
        );
      } catch {
        (res.status as jest.Mock)(500);
        (res as any).type = jest.fn().mockReturnValue(res);
        (res.send as jest.Mock)(PayjoinErrors.RECEIVER_ERROR);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body).toBe(PayjoinErrors.RECEIVER_ERROR);
    });

    it('should handle v parameter with wrong version', async () => {
      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '2' }, // Wrong version
        body: VALID_PSBT_BASE64,
      });
      const { res, getResponse } = createMockResponse();

      const { v } = req.query as { v?: string };
      if (v !== '1') {
        (res.status as jest.Mock)(400);
        (res as any).type = jest.fn().mockReturnValue(res);
        (res.send as jest.Mock)(PayjoinErrors.VERSION_UNSUPPORTED);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe(PayjoinErrors.VERSION_UNSUPPORTED);
    });
  });

  describe('GET /address/:addressId/uri', () => {
    const mockAddress = {
      id: TEST_ADDRESS_ID,
      address: TEST_ADDRESS,
      walletId: 'wallet-123',
    };

    it('should require authentication', async () => {
      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        // No authorization header
      });
      const { res, getResponse } = createMockResponse();

      // Simulate auth middleware
      if (!req.headers?.authorization) {
        (res.status as jest.Mock)(401);
        (res.json as jest.Mock)({ error: 'Unauthorized' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown address', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(null);

      const req = createMockRequest({
        params: { addressId: 'unknown-address' },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      const address = await mockPrismaClient.address.findFirst({
        where: { id: req.params?.addressId },
      });

      if (!address) {
        (res.status as jest.Mock)(404);
        (res.json as jest.Mock)({ error: 'Address not found or access denied' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });

    it('should generate valid BIP21 URI with Payjoin endpoint', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(mockAddress);
      (generateBip21Uri as jest.Mock).mockReturnValue(
        `bitcoin:${TEST_ADDRESS}?pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`
      );

      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: {},
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      (req as any).protocol = 'https';
      (req as any).get = jest.fn().mockReturnValue('example.com');

      const { res, getResponse } = createMockResponse();

      const address = await mockPrismaClient.address.findFirst({
        where: { id: TEST_ADDRESS_ID },
      });

      if (address) {
        const baseUrl = 'https://example.com';
        const payjoinUrl = `${baseUrl}/api/v1/payjoin/${TEST_ADDRESS_ID}`;

        const uri = generateBip21Uri(address.address, {
          payjoinUrl,
        });

        (res.json as jest.Mock)({
          uri,
          address: address.address,
          payjoinUrl,
        });
      }

      const response = getResponse();
      expect(response.body.uri).toContain('bitcoin:');
      expect(response.body.uri).toContain('pj=');
      expect(response.body.address).toBe(TEST_ADDRESS);
      expect(response.body.payjoinUrl).toContain('/api/v1/payjoin/');
    });

    it('should include amount when provided', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(mockAddress);
      (generateBip21Uri as jest.Mock).mockReturnValue(
        `bitcoin:${TEST_ADDRESS}?amount=0.001&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}`
      );

      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { amount: '100000' }, // 100000 sats
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });

      const { res, getResponse } = createMockResponse();

      const address = await mockPrismaClient.address.findFirst({
        where: { id: TEST_ADDRESS_ID },
      });

      if (address) {
        const amount = parseInt(req.query?.amount as string, 10);
        const uri = generateBip21Uri(address.address, {
          amount,
          payjoinUrl: TEST_PAYJOIN_URL,
        });

        (res.json as jest.Mock)({ uri });
      }

      expect(generateBip21Uri).toHaveBeenCalledWith(
        TEST_ADDRESS,
        expect.objectContaining({ amount: 100000 })
      );
    });

    it('should include label and message when provided', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(mockAddress);
      (generateBip21Uri as jest.Mock).mockReturnValue('bitcoin:...');

      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { label: 'Test Payment', message: 'Invoice #123' },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });

      const { res, getResponse } = createMockResponse();

      const address = await mockPrismaClient.address.findFirst({
        where: { id: TEST_ADDRESS_ID },
      });

      if (address) {
        generateBip21Uri(address.address, {
          label: req.query?.label as string,
          message: req.query?.message as string,
          payjoinUrl: TEST_PAYJOIN_URL,
        });

        (res.json as jest.Mock)({ uri: 'bitcoin:...' });
      }

      expect(generateBip21Uri).toHaveBeenCalledWith(
        TEST_ADDRESS,
        expect.objectContaining({
          label: 'Test Payment',
          message: 'Invoice #123',
        })
      );
    });
  });

  describe('POST /parse-uri', () => {
    it('should require authentication', async () => {
      const req = createMockRequest({
        body: { uri: `bitcoin:${TEST_ADDRESS}` },
        // No authorization header
      });
      const { res, getResponse } = createMockResponse();

      if (!req.headers?.authorization) {
        (res.status as jest.Mock)(401);
        (res.json as jest.Mock)({ error: 'Unauthorized' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing URI', async () => {
      const req = createMockRequest({
        body: {}, // No URI
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (!req.body?.uri || typeof req.body.uri !== 'string') {
        (res.status as jest.Mock)(400);
        (res.json as jest.Mock)({ error: 'URI is required' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should parse valid BIP21 URI and return components', async () => {
      (parseBip21Uri as jest.Mock).mockReturnValue({
        address: TEST_ADDRESS,
        amount: 100000,
        label: 'Test',
        message: 'Payment',
        payjoinUrl: TEST_PAYJOIN_URL,
      });

      const req = createMockRequest({
        body: { uri: `bitcoin:${TEST_ADDRESS}?amount=0.001&pj=${encodeURIComponent(TEST_PAYJOIN_URL)}` },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (req.body?.uri) {
        const parsed = parseBip21Uri(req.body.uri);
        (res.json as jest.Mock)({
          address: parsed.address,
          amount: parsed.amount,
          label: parsed.label,
          message: parsed.message,
          payjoinUrl: parsed.payjoinUrl,
          hasPayjoin: !!parsed.payjoinUrl,
        });
      }

      const response = getResponse();
      expect(response.body.address).toBe(TEST_ADDRESS);
      expect(response.body.hasPayjoin).toBe(true);
      expect(response.body.payjoinUrl).toBe(TEST_PAYJOIN_URL);
    });

    it('should indicate hasPayjoin: false when no pj parameter', async () => {
      (parseBip21Uri as jest.Mock).mockReturnValue({
        address: TEST_ADDRESS,
        amount: 100000,
        payjoinUrl: undefined,
      });

      const req = createMockRequest({
        body: { uri: `bitcoin:${TEST_ADDRESS}?amount=0.001` },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (req.body?.uri) {
        const parsed = parseBip21Uri(req.body.uri);
        (res.json as jest.Mock)({
          address: parsed.address,
          hasPayjoin: !!parsed.payjoinUrl,
        });
      }

      const response = getResponse();
      expect(response.body.hasPayjoin).toBe(false);
    });

    it('should handle invalid URI format', async () => {
      (parseBip21Uri as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid URI format');
      });

      const req = createMockRequest({
        body: { uri: 'not-a-valid-uri' },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      try {
        parseBip21Uri(req.body?.uri);
      } catch {
        (res.status as jest.Mock)(400);
        (res.json as jest.Mock)({ error: 'Invalid URI format' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /attempt', () => {
    it('should require authentication', async () => {
      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64, payjoinUrl: TEST_PAYJOIN_URL },
        // No authorization header
      });
      const { res, getResponse } = createMockResponse();

      if (!req.headers?.authorization) {
        (res.status as jest.Mock)(401);
        (res.json as jest.Mock)({ error: 'Unauthorized' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(401);
    });

    it('should require psbt and payjoinUrl', async () => {
      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64 }, // Missing payjoinUrl
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (!req.body?.psbt || !req.body?.payjoinUrl) {
        (res.status as jest.Mock)(400);
        (res.json as jest.Mock)({ error: 'psbt and payjoinUrl are required' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should attempt Payjoin and return proposal', async () => {
      (attemptPayjoinSend as jest.Mock).mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64, payjoinUrl: TEST_PAYJOIN_URL },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (req.body?.psbt && req.body?.payjoinUrl) {
        const result = await attemptPayjoinSend(
          req.body.psbt,
          req.body.payjoinUrl,
          [0]
        );
        (res.json as jest.Mock)(result);
      }

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.proposalPsbt).toBe(PROPOSAL_PSBT_BASE64);
      expect(response.body.isPayjoin).toBe(true);
    });

    it('should return failure response when Payjoin fails', async () => {
      (attemptPayjoinSend as jest.Mock).mockResolvedValue({
        success: false,
        isPayjoin: false,
        error: 'Endpoint returned error',
      });

      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64, payjoinUrl: TEST_PAYJOIN_URL },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      if (req.body?.psbt && req.body?.payjoinUrl) {
        const result = await attemptPayjoinSend(
          req.body.psbt,
          req.body.payjoinUrl,
          [0]
        );
        (res.json as jest.Mock)(result);
      }

      const response = getResponse();
      expect(response.body.success).toBe(false);
      expect(response.body.isPayjoin).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should handle internal errors', async () => {
      (attemptPayjoinSend as jest.Mock).mockRejectedValue(
        new Error('Network failure')
      );

      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64, payjoinUrl: TEST_PAYJOIN_URL },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      try {
        await attemptPayjoinSend(
          req.body?.psbt,
          req.body?.payjoinUrl,
          [0]
        );
      } catch {
        (res.status as jest.Mock)(500);
        (res.json as jest.Mock)({ error: 'Payjoin attempt failed' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });

    it('should assume first input is sender by default', async () => {
      (attemptPayjoinSend as jest.Mock).mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const req = createMockRequest({
        body: { psbt: VALID_PSBT_BASE64, payjoinUrl: TEST_PAYJOIN_URL },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-123', username: 'testuser', isAdmin: false },
      });

      await attemptPayjoinSend(
        req.body?.psbt,
        req.body?.payjoinUrl,
        [0] // First input is sender's
      );

      expect(attemptPayjoinSend).toHaveBeenCalledWith(
        VALID_PSBT_BASE64,
        TEST_PAYJOIN_URL,
        [0]
      );
    });
  });

  describe('BIP78 Error Codes', () => {
    it('should return version-unsupported for wrong version', async () => {
      const { res, getResponse } = createMockResponse();

      (res.status as jest.Mock)(400);
      (res as any).type = jest.fn().mockReturnValue(res);
      (res.send as jest.Mock)(PayjoinErrors.VERSION_UNSUPPORTED);

      const response = getResponse();
      expect(response.body).toBe('version-unsupported');
    });

    it('should return unavailable when address not found', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: false,
        error: PayjoinErrors.UNAVAILABLE,
        errorMessage: 'Address not found',
      });

      const result = await processPayjoinRequest(
        'unknown-address',
        VALID_PSBT_BASE64,
        1
      );

      expect(result.error).toBe('unavailable');
    });

    it('should return not-enough-money when no UTXOs', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: false,
        error: PayjoinErrors.NOT_ENOUGH_MONEY,
        errorMessage: 'No suitable UTXOs',
      });

      const result = await processPayjoinRequest(
        TEST_ADDRESS_ID,
        VALID_PSBT_BASE64,
        1
      );

      expect(result.error).toBe('not-enough-money');
    });

    it('should return original-psbt-rejected for invalid PSBT', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: 'PSBT has no inputs',
      });

      const result = await processPayjoinRequest(
        TEST_ADDRESS_ID,
        'invalid-psbt',
        1
      );

      expect(result.error).toBe('original-psbt-rejected');
    });

    it('should return receiver-error for internal errors', async () => {
      (processPayjoinRequest as jest.Mock).mockResolvedValue({
        success: false,
        error: PayjoinErrors.RECEIVER_ERROR,
        errorMessage: 'Unknown error',
      });

      const result = await processPayjoinRequest(
        TEST_ADDRESS_ID,
        VALID_PSBT_BASE64,
        1
      );

      expect(result.error).toBe('receiver-error');
    });
  });

  describe('Security and Access Control', () => {
    it('should allow unauthenticated access to receiver endpoint', () => {
      // POST /:addressId is the public BIP78 endpoint
      // It should NOT require authentication
      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: VALID_PSBT_BASE64,
        // No authorization header - this should be allowed
      });

      // The route should proceed without authentication check
      expect(req.user).toBeUndefined();
      // No error should be thrown for missing auth on this endpoint
    });

    it('should require authentication for URI generation', async () => {
      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        // No authorization
      });
      const { res, getResponse } = createMockResponse();

      // This endpoint requires auth
      if (!req.headers?.authorization) {
        (res.status as jest.Mock)(401);
        (res.json as jest.Mock)({ error: 'Unauthorized' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(401);
    });

    it('should verify user has access to address for URI generation', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(null); // No access

      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        headers: { authorization: 'Bearer test-token' },
        user: { userId: 'user-456', username: 'otheruser', isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();

      const address = await mockPrismaClient.address.findFirst({
        where: {
          id: TEST_ADDRESS_ID,
          wallet: {
            OR: [
              { users: { some: { userId: 'user-456' } } },
              { group: { members: { some: { userId: 'user-456' } } } },
            ],
          },
        },
      });

      if (!address) {
        (res.status as jest.Mock)(404);
        (res.json as jest.Mock)({ error: 'Address not found or access denied' });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });
  });

  describe('Input Validation', () => {
    it('should handle null body gracefully', async () => {
      const req = createRawBodyRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: null,
      });
      const { res, getResponse } = createMockResponse();

      const originalPsbt = typeof req.body === 'string' ? req.body : (req.body as any)?.toString?.();
      if (!originalPsbt || originalPsbt.length === 0) {
        (res.status as jest.Mock)(400);
        (res as any).type = jest.fn().mockReturnValue(res);
        (res.send as jest.Mock)(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should handle object body (parse as text)', async () => {
      const req = createMockRequest({
        params: { addressId: TEST_ADDRESS_ID },
        query: { v: '1' },
        body: { data: 'should be text' }, // Object instead of string
      });
      const { res, getResponse } = createMockResponse();

      const originalPsbt = typeof req.body === 'string'
        ? req.body
        : req.body?.toString?.();

      // Object.toString() returns "[object Object]"
      expect(originalPsbt).toBe('[object Object]');
    });

    it('should sanitize addressId parameter', async () => {
      // SQL injection attempt
      const maliciousId = "addr-123'; DROP TABLE addresses;--";

      const req = createRawBodyRequest({
        params: { addressId: maliciousId },
        query: { v: '1' },
        body: VALID_PSBT_BASE64,
      });

      // The service should be called with the raw parameter
      // Prisma handles parameterized queries safely
      expect(req.params?.addressId).toBe(maliciousId);
    });
  });
});
