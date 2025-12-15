/**
 * Price Feed Service
 *
 * Aggregates Bitcoin price data from multiple sources with caching
 * and fallback mechanisms for reliability.
 */

import { providers, PriceData, supportedCurrencies } from './providers';

interface CachedPrice {
  data?: PriceData;
  expiresAt?: Date;
  fetchedAt?: Date;
  price?: number;
  prices?: Array<{ timestamp: Date; price: number }>;
  provider?: string;
  currency?: string;
  timestamp?: Date;
}

interface AggregatedPrice {
  price: number;
  currency: string;
  sources: PriceData[];
  median: number;
  average: number;
  timestamp: Date;
  cached: boolean;
  change24h?: number;
}

class PriceService {
  private cache = new Map<string, CachedPrice>();
  private cacheDuration = 60 * 1000; // 1 minute default
  private cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours for historical data

  /**
   * Get current Bitcoin price with fallback and caching
   */
  async getPrice(
    currency: string = 'USD',
    useCache: boolean = true
  ): Promise<AggregatedPrice> {
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

    // Determine which providers support this currency
    const availableProviders = Object.entries(supportedCurrencies)
      .filter(([_, currencies]) => currencies.includes(currency.toUpperCase()))
      .map(([provider]) => provider);

    if (availableProviders.length === 0) {
      throw new Error(`Currency ${currency} is not supported by any provider`);
    }

    // Fetch from all available providers
    const results = await this.fetchFromProviders(availableProviders, currency);

    if (results.length === 0) {
      throw new Error('Failed to fetch price from any provider');
    }

    // Calculate aggregated price
    const prices = results.map((r) => r.price);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const median = this.calculateMedian(prices);

    // Get 24h change from CoinGecko if available (they provide this data)
    const coinGeckoSource = results.find(r => r.provider === 'coingecko');
    const change24h = coinGeckoSource?.change24h;

    // Use median as the main price (more resistant to outliers)
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

    // Cache the result - prefer coingecko (has change24h) or first available
    if (results.length > 0) {
      const sourceToCache = coinGeckoSource || results[0];
      // Ensure change24h is preserved in cache even if using non-coingecko source
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
    provider: string,
    currency: string = 'USD'
  ): Promise<PriceData> {
    const providerFn = providers[provider as keyof typeof providers];

    if (!providerFn) {
      throw new Error(`Provider ${provider} not found`);
    }

    // Check if provider supports currency
    const currencies = supportedCurrencies[provider];
    if (!currencies?.includes(currency.toUpperCase())) {
      throw new Error(`Provider ${provider} does not support currency ${currency}`);
    }

    return providerFn(currency);
  }

  /**
   * Fetch price from multiple providers in parallel
   */
  private async fetchFromProviders(
    providerNames: string[],
    currency: string
  ): Promise<PriceData[]> {
    const promises = providerNames.map(async (name) => {
      try {
        return await this.getPriceFrom(name, currency);
      } catch (error) {
        console.error(`[PRICE] Failed to fetch from ${name}:`, error);
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
        console.error(`[PRICE] Failed to get price for ${currency}:`, error);
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
    try {
      // Normalize date to start of day
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      // Check cache first
      const cacheKey = `historical_${currency}_${normalizedDate.toISOString()}`;
      const cached = this.cache.get(cacheKey);

      if (cached && cached.fetchedAt && cached.price !== undefined && Date.now() - cached.fetchedAt.getTime() < this.cacheTimeout) {
        console.log(`[PRICE] Using cached historical price for ${currency} on ${normalizedDate.toDateString()}`);
        return cached.price;
      }

      // Fetch historical price from CoinGecko
      const providers = await import('./providers');
      const priceData = await providers.fetchCoinGeckoHistoricalPrice(normalizedDate, currency);

      // Cache the result (historical prices don't change, so use longer cache)
      this.cache.set(cacheKey, {
        ...priceData,
        fetchedAt: new Date(),
      });

      console.log(`[PRICE] Fetched historical price from ${priceData.provider}: ${priceData.price} ${priceData.currency}`);

      return priceData.price;
    } catch (error: any) {
      console.error('[PRICE] Failed to fetch historical price:', error.message);
      throw new Error(`Failed to fetch historical price: ${error.message}`);
    }
  }

  /**
   * Get price history over a date range
   */
  async getPriceHistory(
    currency: string = 'USD',
    days: number = 30
  ): Promise<Array<{ timestamp: Date; price: number }>> {
    try {
      // Check cache first
      const cacheKey = `history_${currency}_${days}d`;
      const cached = this.cache.get(cacheKey);

      if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt.getTime() < this.cacheTimeout) {
        console.log(`[PRICE] Using cached price history for ${currency} (${days} days)`);
        return cached.prices || [];
      }

      // Fetch price history from CoinGecko
      const providers = await import('./providers');
      const priceHistory = await providers.fetchCoinGeckoMarketChart(days, currency);

      // Cache the result
      this.cache.set(cacheKey, {
        provider: 'coingecko',
        price: priceHistory[priceHistory.length - 1]?.price || 0,
        currency,
        timestamp: new Date(),
        fetchedAt: new Date(),
        prices: priceHistory,
      });

      console.log(`[PRICE] Fetched price history from CoinGecko: ${priceHistory.length} data points`);

      return priceHistory;
    } catch (error: any) {
      console.error('[PRICE] Failed to fetch price history:', error.message);
      throw new Error(`Failed to fetch price history: ${error.message}`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: string[];
  } {
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
    const allCurrencies = new Set<string>();
    Object.values(supportedCurrencies).forEach((currencies) => {
      currencies.forEach((c) => allCurrencies.add(c));
    });
    return Array.from(allCurrencies).sort();
  }

  /**
   * Get list of available providers
   */
  getProviders(): string[] {
    return Object.keys(providers);
  }

  /**
   * Private: Get from cache if not expired
   */
  private getFromCache(key: string): PriceData | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (cached.expiresAt && new Date() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data || null;
  }

  /**
   * Private: Set cache with expiration
   */
  private setCache(key: string, data: PriceData): void {
    const expiresAt = new Date(Date.now() + this.cacheDuration);
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Private: Calculate median of an array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
  }

  /**
   * Health check - test connectivity to providers
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Record<string, boolean>;
  }> {
    const providerNames = this.getProviders();
    const results: Record<string, boolean> = {};

    for (const provider of providerNames) {
      try {
        await this.getPriceFrom(provider, 'USD');
        results[provider] = true;
      } catch (error) {
        results[provider] = false;
      }
    }

    const healthyCount = Object.values(results).filter(Boolean).length;
    const healthy = healthyCount > 0;

    return {
      healthy,
      providers: results,
    };
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
export { PriceData, AggregatedPrice };
