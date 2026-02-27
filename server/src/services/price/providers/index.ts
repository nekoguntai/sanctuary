/**
 * Price Providers Index
 *
 * Exports all price providers and creates the provider registry.
 */

import { ProviderRegistry } from '../../../providers';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { IPriceProvider } from '../types';

// Export provider classes
export { BasePriceProvider } from './base';
export { MempoolPriceProvider } from './mempool';
export { CoinGeckoPriceProvider } from './coingecko';
export { KrakenPriceProvider } from './kraken';
export { CoinbasePriceProvider } from './coinbase';
export { BinancePriceProvider } from './binance';

// Import providers for registry
import { MempoolPriceProvider } from './mempool';
import { CoinGeckoPriceProvider } from './coingecko';
import { KrakenPriceProvider } from './kraken';
import { CoinbasePriceProvider } from './coinbase';
import { BinancePriceProvider } from './binance';

const log = createLogger('PriceProviders');

/**
 * Supported currencies by provider (for backward compatibility with tests)
 */
export const supportedCurrencies: Record<string, string[]> = {
  mempool: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
  coingecko: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'KRW', 'INR'],
  kraken: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
  coinbase: ['USD', 'EUR', 'GBP', 'CAD'],
  binance: ['USD', 'EUR', 'GBP'],
};

/**
 * Create and configure the price provider registry
 */
export function createPriceProviderRegistry(): ProviderRegistry<IPriceProvider> {
  const registry = new ProviderRegistry<IPriceProvider>({
    name: 'PriceProviders',
    healthCheckIntervalMs: 60000, // Check every minute
    healthCacheTtlMs: 30000, // Cache health for 30 seconds
    defaultTimeoutMs: 10000, // 10 second timeout for price fetches
    defaultMaxRetries: 2,
  });

  return registry;
}

/**
 * Initialize and register all price providers
 */
export async function initializePriceProviders(
  registry: ProviderRegistry<IPriceProvider>
): Promise<void> {
  const providers: IPriceProvider[] = [
    new MempoolPriceProvider(),
    new CoinGeckoPriceProvider(),
    new KrakenPriceProvider(),
    new CoinbasePriceProvider(),
    new BinancePriceProvider(),
  ];

  for (const provider of providers) {
    try {
      await registry.register(provider);
      log.info('Registered price provider', { name: provider.name, priority: provider.priority });
    } catch (error) {
      log.error('Failed to register price provider', {
        name: provider.name,
        error: getErrorMessage(error),
      });
    }
  }

  // Start periodic health checks
  registry.startHealthChecks();
}

/**
 * Get all supported currencies across all providers
 */
export function getAllSupportedCurrencies(
  registry: ProviderRegistry<IPriceProvider>
): string[] {
  const allCurrencies = new Set<string>();

  for (const provider of registry.getAll()) {
    for (const currency of provider.supportedCurrencies) {
      allCurrencies.add(currency);
    }
  }

  return Array.from(allCurrencies).sort();
}

/**
 * Get providers that support a specific currency
 */
export async function getProvidersForCurrency(
  registry: ProviderRegistry<IPriceProvider>,
  currency: string
): Promise<IPriceProvider[]> {
  const healthyProviders = await registry.getHealthy();
  return healthyProviders.filter(p => p.supportsCurrency(currency));
}
