/**
 * Price Feed Service
 *
 * Aggregates Bitcoin price data from multiple sources using the
 * ProviderRegistry pattern with caching and fallback mechanisms.
 */

import { LRUCache } from 'lru-cache';
import { ProviderRegistry } from '../../providers';
import { createLogger } from '../../utils/logger';
import {
  createPriceProviderRegistry,
  initializePriceProviders,
  getAllSupportedCurrencies,
  getProvidersForCurrency,
  CoinGeckoPriceProvider,
} from './providers';
import type {
  IPriceProvider,
  IPriceProviderWithHistory,
  PriceData,
  AggregatedPrice,
  PriceHistoryPoint,
} from './types';
import { hasHistoricalSupport } from './types';

const log = createLogger('PRICE');

interface CachedPrice {
  data?: PriceData;
  expiresAt?: Date;
  fetchedAt?: Date;
  price?: number;
  prices?: PriceHistoryPoint[];
  provider?: string;
  currency?: string;
  timestamp?: Date;
}

class PriceService {
  private cache = new LRUCache<string, CachedPrice>({ max: 500 });
  private cacheDuration = 60 * 1000; // 1 minute default
  private cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours for historical data
  private registry: ProviderRegistry<IPriceProvider>;
  private initialized = false;

  constructor() {
    this.registry = createPriceProviderRegistry();
  }

  /**
   * Initialize the price service and register all providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await initializePriceProviders(this.registry);
    this.initialized = true;
    log.info('Price service initialized with provider registry');
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get current Bitcoin price with fallback and caching
   */
  async getPrice(
    currency: string = 'USD',
    useCache: boolean = true
  ): Promise<AggregatedPrice> {
    await this.ensureInitialized();

    const cacheKey = `price:${currency.toUpperCase()}`;

    // Check cache first
    if (useCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          price: cached.price,
          currency: cached.currency,
          sources: [cached],
          median: cached.price,
          average: cached.price,
          timestamp: cached.timestamp,
          cached: true,
          change24h: cached.change24h,
        };
      }
    }

    // Get providers that support this currency
    const providers = await getProvidersForCurrency(this.registry, currency);

    if (providers.length === 0) {
      throw new Error(`Currency ${currency} is not supported by any provider`);
    }

    // Fetch from all available providers
    const results = await this.fetchFromProviders(providers, currency);

    if (results.length === 0) {
      throw new Error('Failed to fetch price from any provider');
    }

    // Calculate aggregated price
    const prices = results.map((r) => r.price);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const median = this.calculateMedian(prices);

    // Get 24h change from CoinGecko if available
    const coinGeckoSource = results.find(r => r.provider === 'coingecko');
    const change24h = coinGeckoSource?.change24h;

    const aggregated: AggregatedPrice = {
      price: median,
      currency: currency.toUpperCase(),
      sources: results,
      median,
      average,
      timestamp: new Date(),
      cached: false,
      change24h,
    };

    // Cache the result
    if (results.length > 0) {
      const sourceToCache = coinGeckoSource || results[0];
      if (change24h !== undefined && !sourceToCache.change24h) {
        sourceToCache.change24h = change24h;
      }
      this.setCache(cacheKey, sourceToCache);
    }

    return aggregated;
  }

  /**
   * Get price from specific provider
   */
  async getPriceFrom(
    providerName: string,
    currency: string = 'USD'
  ): Promise<PriceData> {
    await this.ensureInitialized();

    const provider = this.registry.get(providerName);

    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    if (!provider.supportsCurrency(currency)) {
      throw new Error(`Provider ${providerName} does not support currency ${currency}`);
    }

    return provider.getPrice(currency);
  }

  /**
   * Fetch price from multiple providers in parallel
   */
  private async fetchFromProviders(
    providers: IPriceProvider[],
    currency: string
  ): Promise<PriceData[]> {
    const promises = providers.map(async (provider) => {
      try {
        return await provider.getPrice(currency);
      } catch (error) {
        log.debug(`Failed to fetch from ${provider.name}`, { error: (error as Error).message });
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((r): r is PriceData => r !== null);
  }

  /**
   * Get prices for multiple currencies at once
   */
  async getPrices(currencies: string[]): Promise<Record<string, AggregatedPrice>> {
    const promises = currencies.map(async (currency) => {
      try {
        const price = await this.getPrice(currency);
        return { currency, price };
      } catch (error) {
        log.error(`Failed to get price for ${currency}`, { error: (error as Error).message });
        return null;
      }
    });

    const results = await Promise.all(promises);
    const priceMap: Record<string, AggregatedPrice> = {};

    for (const result of results) {
      if (result) {
        priceMap[result.currency] = result.price;
      }
    }

    return priceMap;
  }

  /**
   * Convert satoshis to fiat
   */
  async convertToFiat(
    sats: number,
    currency: string = 'USD'
  ): Promise<number> {
    const priceData = await this.getPrice(currency);
    const btc = sats / 100000000;
    return btc * priceData.price;
  }

  /**
   * Convert fiat to satoshis
   */
  async convertToSats(
    amount: number,
    currency: string = 'USD'
  ): Promise<number> {
    const priceData = await this.getPrice(currency);
    const btc = amount / priceData.price;
    return Math.round(btc * 100000000);
  }

  /**
   * Get historical price for a specific date
   */
  async getHistoricalPrice(
    currency: string = 'USD',
    date: Date
  ): Promise<number> {
    await this.ensureInitialized();

    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      const cacheKey = `historical_${currency}_${normalizedDate.toISOString()}`;
      const cached = this.cache.get(cacheKey);

      if (cached && cached.fetchedAt && cached.price !== undefined && Date.now() - cached.fetchedAt.getTime() < this.cacheTimeout) {
        log.debug(`Using cached historical price for ${currency} on ${normalizedDate.toDateString()}`);
        return cached.price;
      }

      // Find a provider with historical support
      const provider = await this.getHistoricalProvider();

      if (!provider) {
        throw new Error('No provider available with historical price support');
      }

      const priceData = await provider.getHistoricalPrice(normalizedDate, currency);

      this.cache.set(cacheKey, {
        ...priceData,
        fetchedAt: new Date(),
      });

      log.debug(`Fetched historical price from ${priceData.provider}: ${priceData.price} ${priceData.currency}`);

      return priceData.price;
    } catch (error: any) {
      log.error('Failed to fetch historical price', { error: error.message });
      throw new Error(`Failed to fetch historical price: ${error.message}`);
    }
  }

  /**
   * Get price history over a date range
   */
  async getPriceHistory(
    currency: string = 'USD',
    days: number = 30
  ): Promise<PriceHistoryPoint[]> {
    await this.ensureInitialized();

    try {
      const cacheKey = `history_${currency}_${days}d`;
      const cached = this.cache.get(cacheKey);

      if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt.getTime() < this.cacheTimeout) {
        log.debug(`Using cached price history for ${currency} (${days} days)`);
        return cached.prices || [];
      }

      const provider = await this.getHistoricalProvider();

      if (!provider) {
        throw new Error('No provider available with price history support');
      }

      const priceHistory = await provider.getPriceHistory(days, currency);

      this.cache.set(cacheKey, {
        provider: 'coingecko',
        price: priceHistory[priceHistory.length - 1]?.price || 0,
        currency,
        timestamp: new Date(),
        fetchedAt: new Date(),
        prices: priceHistory,
      });

      log.debug(`Fetched price history: ${priceHistory.length} data points`);

      return priceHistory;
    } catch (error: any) {
      log.error('Failed to fetch price history', { error: error.message });
      throw new Error(`Failed to fetch price history: ${error.message}`);
    }
  }

  /**
   * Get a provider that supports historical data
   */
  private async getHistoricalProvider(): Promise<IPriceProviderWithHistory | null> {
    const providers = this.registry.getAll();

    for (const provider of providers) {
      if (hasHistoricalSupport(provider)) {
        const healthy = await provider.healthCheck();
        if (healthy) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Set cache duration (in milliseconds)
   */
  setCacheDuration(ms: number): void {
    this.cacheDuration = ms;
  }

  /**
   * Get supported currencies across all providers
   */
  getSupportedCurrencies(): string[] {
    if (!this.initialized) {
      // Return default list if not initialized
      return ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'KRW', 'INR'];
    }
    return getAllSupportedCurrencies(this.registry);
  }

  /**
   * Get list of available providers
   */
  getProviders(): string[] {
    if (!this.initialized) {
      return ['mempool', 'coingecko', 'kraken', 'coinbase', 'binance'];
    }
    return this.registry.getAll().map(p => p.name);
  }

  /**
   * Health check - test connectivity to providers
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Record<string, boolean>;
  }> {
    await this.ensureInitialized();

    const health = await this.registry.getHealth();
    const results: Record<string, boolean> = {};

    for (const status of health.providers) {
      results[status.name] = status.healthy;
    }

    return {
      healthy: health.healthyProviders > 0,
      providers: results,
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.registry.shutdown();
    this.initialized = false;
    log.info('Price service shut down');
  }

  private getFromCache(key: string): PriceData | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (cached.expiresAt && new Date() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data || null;
  }

  private setCache(key: string, data: PriceData): void {
    const expiresAt = new Date(Date.now() + this.cacheDuration);
    this.cache.set(key, { data, expiresAt });
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
  }
}

// Singleton instance
let priceService: PriceService | null = null;

/**
 * Get price service instance
 */
export function getPriceService(): PriceService {
  if (!priceService) {
    priceService = new PriceService();
  }
  return priceService;
}

export default PriceService;
export type { PriceData, AggregatedPrice, PriceHistoryPoint, IPriceProvider };
