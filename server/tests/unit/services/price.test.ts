/**
 * Price Service Tests
 *
 * Tests for Bitcoin price aggregation, caching, and conversion.
 * Mocks external API calls to test business logic.
 */

import axios from 'axios';

// Mock axios before importing the module
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import PriceService, { getPriceService } from '../../../src/services/price/index';
import { supportedCurrencies } from '../../../src/services/price/providers';

describe('Price Service', () => {
  let priceService: PriceService;

  beforeEach(() => {
    // Create fresh instance for each test
    priceService = new PriceService();
    priceService.clearCache();
    jest.clearAllMocks();
  });

  describe('getPrice', () => {
    it('should aggregate prices from multiple providers', async () => {
      // Mock responses from different providers
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: {
              bitcoin: {
                usd: 50100,
                usd_24h_change: 2.5,
              },
            },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['50050.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '49950.00' } },
          });
        }
        if (url.includes('binance')) {
          return Promise.resolve({
            data: { price: '50000.00' },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result).toBeDefined();
      expect(result.currency).toBe('USD');
      expect(result.price).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.cached).toBe(false);
    });

    it('should calculate median price from multiple sources', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 52000 } },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['51000.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '53000.00' } },
          });
        }
        if (url.includes('binance')) {
          return Promise.resolve({
            data: { price: '54000.00' },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await priceService.getPrice('USD', false);

      // Median of [50000, 51000, 52000, 53000, 54000] = 52000
      expect(result.median).toBe(52000);
    });

    it('should use cache when available and not expired', async () => {
      // First call
      mockedAxios.get.mockResolvedValue({ data: { USD: 50000 } });

      await priceService.getPrice('USD', true);
      const callCountAfterFirst = mockedAxios.get.mock.calls.length;

      // Second call - should use cache
      const result = await priceService.getPrice('USD', true);

      expect(result.cached).toBe(true);
      expect(mockedAxios.get.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('should bypass cache when useCache is false', async () => {
      mockedAxios.get.mockResolvedValue({ data: { USD: 50000 } });

      await priceService.getPrice('USD', true);
      const callCountAfterFirst = mockedAxios.get.mock.calls.length;

      // Second call with useCache=false
      await priceService.getPrice('USD', false);

      expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it('should throw error for unsupported currency', async () => {
      await expect(priceService.getPrice('XYZ', false)).rejects.toThrow(
        'Currency XYZ is not supported by any provider'
      );
    });

    it('should throw error when all providers fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(priceService.getPrice('USD', false)).rejects.toThrow(
        'Failed to fetch price from any provider'
      );
    });

    it('should include 24h change from CoinGecko', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: {
              bitcoin: {
                usd: 50000,
                usd_24h_change: -3.5,
              },
            },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result.change24h).toBe(-3.5);
    });

    it('should handle EUR currency', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { EUR: 45000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { eur: 45100 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('EUR', false);

      expect(result.currency).toBe('EUR');
      expect(result.price).toBeGreaterThan(0);
    });
  });

  describe('getPriceFrom', () => {
    it('should fetch from specific provider', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      const result = await priceService.getPriceFrom('coingecko', 'USD');

      expect(result.provider).toBe('coingecko');
      expect(result.price).toBe(50000);
    });

    it('should throw for unknown provider', async () => {
      await expect(priceService.getPriceFrom('unknown', 'USD')).rejects.toThrow(
        'Provider unknown not found'
      );
    });

    it('should throw when provider does not support currency', async () => {
      // Binance only supports USD, EUR, GBP
      await expect(priceService.getPriceFrom('binance', 'JPY')).rejects.toThrow(
        'Provider binance does not support currency JPY'
      );
    });
  });

  describe('convertToFiat', () => {
    it('should convert satoshis to fiat', async () => {
      // Mock all providers for consistent results
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(100000000, 'USD');

      expect(result).toBe(50000); // 1 BTC = $50,000
    });

    it('should handle small amounts', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(1, 'USD');

      expect(result).toBeCloseTo(0.0005, 5); // 1 sat at $50k/BTC
    });

    it('should handle zero satoshis', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(0, 'USD');

      expect(result).toBe(0);
    });
  });

  describe('convertToSats', () => {
    it('should convert fiat to satoshis', async () => {
      // Mock all providers for consistent results
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(50000, 'USD');

      expect(result).toBe(100000000); // $50,000 = 1 BTC = 100M sats
    });

    it('should handle small amounts and round to nearest satoshi', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(0.01, 'USD');

      expect(result).toBe(20); // $0.01 at $50k/BTC = 20 sats
    });

    it('should handle zero fiat', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(0, 'USD');

      expect(result).toBe(0);
    });
  });

  describe('cache management', () => {
    it('should report cache statistics', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      await priceService.getPrice('USD', true);

      const stats = priceService.getCacheStats();

      expect(stats.size).toBeGreaterThan(0);
      expect(stats.entries.length).toBeGreaterThan(0);
    });

    it('should clear cache', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      await priceService.getPrice('USD', true);
      priceService.clearCache();

      const stats = priceService.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should allow setting cache duration', () => {
      priceService.setCacheDuration(30000);
      // No assertion needed - just verify it doesn't throw
    });
  });

  describe('getSupportedCurrencies', () => {
    it('should return list of supported currencies', () => {
      const currencies = priceService.getSupportedCurrencies();

      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
      expect(Array.isArray(currencies)).toBe(true);
    });

    it('should return sorted list', () => {
      const currencies = priceService.getSupportedCurrencies();
      const sorted = [...currencies].sort();

      expect(currencies).toEqual(sorted);
    });
  });

  describe('getProviders', () => {
    it('should return list of available providers', () => {
      const providers = priceService.getProviders();

      expect(providers).toContain('mempool');
      expect(providers).toContain('coingecko');
      expect(providers).toContain('kraken');
      expect(providers).toContain('coinbase');
      expect(providers).toContain('binance');
    });
  });

  describe('healthCheck', () => {
    it('should report healthy when at least one provider works', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider down'));
      });

      const result = await priceService.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.providers.coingecko).toBe(true);
    });

    it('should report unhealthy when all providers fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('All providers down'));

      const result = await priceService.healthCheck();

      expect(result.healthy).toBe(false);
      Object.values(result.providers).forEach((status) => {
        expect(status).toBe(false);
      });
    });

    it('should report per-provider status', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.healthCheck();

      expect(result.providers.mempool).toBe(true);
      expect(result.providers.coingecko).toBe(true);
      expect(result.providers.kraken).toBe(false);
    });
  });

  describe('getPriceService singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getPriceService();
      const instance2 = getPriceService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('calculateMedian (via getPrice)', () => {
    it('should handle single price correctly', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result.median).toBe(50000);
      expect(result.average).toBe(50000);
    });

    it('should handle even number of prices', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 52000 } },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['51000.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '53000.00' } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      // Median of [50000, 51000, 52000, 53000] = (51000 + 52000) / 2 = 51500
      expect(result.median).toBe(51500);
    });
  });

  describe('supportedCurrencies', () => {
    it('should have defined currencies for each provider', () => {
      expect(supportedCurrencies.mempool).toBeDefined();
      expect(supportedCurrencies.coingecko).toBeDefined();
      expect(supportedCurrencies.kraken).toBeDefined();
      expect(supportedCurrencies.coinbase).toBeDefined();
      expect(supportedCurrencies.binance).toBeDefined();
    });

    it('should include USD for all providers', () => {
      Object.values(supportedCurrencies).forEach((currencies) => {
        expect(currencies).toContain('USD');
      });
    });
  });
});
