/**
 * BeaconClient Unit Tests
 *
 * Tests for the Beacon Lightning service client.
 */

import axios from 'axios';
import {
  BeaconClient,
  BeaconApiError,
  getBeaconClient,
  isBeaconEnabled,
  resetBeaconClient,
} from '../../../../src/services/lightning/beaconClient';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('BeaconClient', () => {
  let client: BeaconClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn(),
        },
      },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    client = new BeaconClient({
      baseUrl: 'https://beacon.example.com',
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create axios instance with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://beacon.example.com',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
      });
    });

    it('should use custom timeout when provided', () => {
      new BeaconClient({
        baseUrl: 'https://beacon.example.com',
        apiKey: 'test-api-key',
        timeoutMs: 5000,
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('should register response interceptor', () => {
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return true when health endpoint returns ok', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'ok' } });

      const result = await client.isHealthy();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/health');
    });

    it('should return false when health endpoint returns non-ok status', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'degraded' } });

      const result = await client.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false when health endpoint throws', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      const result = await client.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return service info', async () => {
      const mockInfo = {
        features: {
          swaps: true,
          federation: false,
          lightning: true,
          taprootAssets: false,
        },
        version: '1.0.0',
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockInfo },
      });

      const result = await client.getInfo();

      expect(result).toEqual(mockInfo);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/info');
    });

    it('should throw BeaconApiError on API error response', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: false,
          error: { code: 'SERVICE_ERROR', message: 'Service unavailable' },
        },
      });

      await expect(client.getInfo()).rejects.toThrow(BeaconApiError);
    });
  });

  describe('createSwap', () => {
    it('should create a normal swap', async () => {
      const mockSwap = {
        id: 'swap-123',
        type: 'normal',
        status: 'created',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        onchain: {
          address: 'bc1qswapaddress...',
          expectedAmountSats: '100000',
        },
        lightning: {
          invoice: 'lnbc...',
          amountSats: '99000',
          paymentHash: 'hash123',
        },
        fees: {
          serviceFeePercent: 1,
          serviceFeeSats: '1000',
          networkFeeSats: '500',
        },
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: mockSwap },
      });

      const result = await client.createSwap({
        type: 'normal',
        invoice: 'lnbc...',
        refundAddress: 'bc1qrefund...',
      });

      expect(result).toEqual(mockSwap);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/swaps', {
        type: 'normal',
        invoice: 'lnbc...',
        refundAddress: 'bc1qrefund...',
      });
    });
  });

  describe('payFromCold', () => {
    it('should create a normal swap with invoice and refund address', async () => {
      const mockSwap = {
        id: 'swap-456',
        type: 'normal',
        status: 'created',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: mockSwap },
      });

      const result = await client.payFromCold({
        invoice: 'lnbc1000...',
        refundAddress: 'bc1qtest...',
      });

      expect(result.id).toBe('swap-456');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/swaps', {
        type: 'normal',
        invoice: 'lnbc1000...',
        refundAddress: 'bc1qtest...',
      });
    });
  });

  describe('getSwap', () => {
    it('should get swap by ID', async () => {
      const mockSwap = { id: 'swap-789', status: 'completed' };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockSwap },
      });

      const result = await client.getSwap('swap-789');

      expect(result).toEqual(mockSwap);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/swaps/swap-789');
    });
  });

  describe('listSwaps', () => {
    it('should list all swaps', async () => {
      const mockSwaps = [
        { id: 'swap-1', status: 'completed' },
        { id: 'swap-2', status: 'pending' },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockSwaps },
      });

      const result = await client.listSwaps();

      expect(result).toEqual(mockSwaps);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/swaps');
    });
  });

  describe('createInvoice', () => {
    it('should create a Lightning invoice', async () => {
      const mockInvoice = {
        paymentHash: 'hash123',
        paymentRequest: 'lnbc...',
        amountMsat: '1000000',
        description: 'Test payment',
        expiresAt: Date.now() + 3600000,
        status: 'pending',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: mockInvoice },
      });

      const result = await client.createInvoice({
        amountMsat: '1000000',
        description: 'Test payment',
      });

      expect(result).toEqual(mockInvoice);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/invoices', {
        amountMsat: '1000000',
        description: 'Test payment',
      });
    });
  });

  describe('getInvoice', () => {
    it('should get invoice by payment hash', async () => {
      const mockInvoice = { paymentHash: 'hash123', status: 'settled' };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockInvoice },
      });

      const result = await client.getInvoice('hash123');

      expect(result).toEqual(mockInvoice);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/invoices/hash123');
    });
  });

  describe('listInvoices', () => {
    it('should list invoices with filters', async () => {
      const mockInvoices = [{ paymentHash: 'hash1', status: 'settled' }];

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockInvoices },
      });

      const result = await client.listInvoices({ status: 'settled', limit: 10 });

      expect(result).toEqual(mockInvoices);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/invoices', {
        params: { status: 'settled', limit: 10 },
      });
    });
  });

  describe('payInvoice', () => {
    it('should pay a Lightning invoice', async () => {
      const mockPayment = {
        paymentHash: 'hash123',
        paymentPreimage: 'preimage123',
        amountMsat: '1000000',
        feeMsat: '1000',
        status: 'succeeded',
        createdAt: Date.now(),
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, data: mockPayment },
      });

      const result = await client.payInvoice({
        invoice: 'lnbc...',
        maxFeeMsat: '10000',
      });

      expect(result).toEqual(mockPayment);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/payments', {
        invoice: 'lnbc...',
        maxFeeMsat: '10000',
      });
    });
  });

  describe('getPayment', () => {
    it('should get payment by hash', async () => {
      const mockPayment = { paymentHash: 'hash123', status: 'succeeded' };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockPayment },
      });

      const result = await client.getPayment('hash123');

      expect(result).toEqual(mockPayment);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/payments/hash123');
    });
  });

  describe('listPayments', () => {
    it('should list payments with filters', async () => {
      const mockPayments = [{ paymentHash: 'hash1', status: 'succeeded' }];

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockPayments },
      });

      const result = await client.listPayments({ status: 'succeeded' });

      expect(result).toEqual(mockPayments);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/payments', {
        params: { status: 'succeeded' },
      });
    });
  });

  describe('getBalance', () => {
    it('should get Lightning balance', async () => {
      const mockBalance = {
        totalSats: '1000000',
        spendableSats: '900000',
        receivableSats: '500000',
        pendingSats: '100000',
        swapPendingSats: '0',
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: mockBalance },
      });

      const result = await client.getBalance();

      expect(result).toEqual(mockBalance);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/balance');
    });
  });
});

describe('BeaconApiError', () => {
  it('should create error with code and message', () => {
    const error = new BeaconApiError('INVALID_INVOICE', 'Invoice has expired');

    expect(error.code).toBe('INVALID_INVOICE');
    expect(error.message).toBe('Invoice has expired');
    expect(error.name).toBe('BeaconApiError');
    expect(error instanceof Error).toBe(true);
  });
});

describe('Factory Functions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    resetBeaconClient();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isBeaconEnabled', () => {
    it('should return true when both BEACON_URL and BEACON_API_KEY are set', () => {
      process.env.BEACON_URL = 'https://beacon.example.com';
      process.env.BEACON_API_KEY = 'test-key';

      expect(isBeaconEnabled()).toBe(true);
    });

    it('should return false when BEACON_URL is missing', () => {
      delete process.env.BEACON_URL;
      process.env.BEACON_API_KEY = 'test-key';

      expect(isBeaconEnabled()).toBe(false);
    });

    it('should return false when BEACON_API_KEY is missing', () => {
      process.env.BEACON_URL = 'https://beacon.example.com';
      delete process.env.BEACON_API_KEY;

      expect(isBeaconEnabled()).toBe(false);
    });

    it('should return false when both are missing', () => {
      delete process.env.BEACON_URL;
      delete process.env.BEACON_API_KEY;

      expect(isBeaconEnabled()).toBe(false);
    });
  });

  describe('getBeaconClient', () => {
    it('should return null when not configured', () => {
      delete process.env.BEACON_URL;
      delete process.env.BEACON_API_KEY;

      const client = getBeaconClient();

      expect(client).toBeNull();
    });

    it('should return client when configured', () => {
      process.env.BEACON_URL = 'https://beacon.example.com';
      process.env.BEACON_API_KEY = 'test-key';

      const client = getBeaconClient();

      expect(client).toBeInstanceOf(BeaconClient);
    });

    it('should return same instance on multiple calls (singleton)', () => {
      process.env.BEACON_URL = 'https://beacon.example.com';
      process.env.BEACON_API_KEY = 'test-key';

      const client1 = getBeaconClient();
      const client2 = getBeaconClient();

      expect(client1).toBe(client2);
    });
  });

  describe('resetBeaconClient', () => {
    it('should reset singleton allowing new instance creation', () => {
      process.env.BEACON_URL = 'https://beacon.example.com';
      process.env.BEACON_API_KEY = 'test-key';

      const client1 = getBeaconClient();
      resetBeaconClient();
      const client2 = getBeaconClient();

      expect(client1).not.toBe(client2);
    });
  });
});
