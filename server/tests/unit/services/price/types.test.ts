import { describe, expect, it } from 'vitest';
import { hasHistoricalSupport, type IPriceProvider } from '../../../../src/services/price/types';

function createProvider(overrides: Partial<IPriceProvider> = {}): IPriceProvider {
  return {
    name: 'test-provider',
    priority: 1,
    healthCheck: async () => true,
    supportedCurrencies: ['USD'],
    getPrice: async () => ({
      provider: 'test-provider',
      price: 50000,
      currency: 'USD',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    }),
    supportsCurrency: (currency: string) => currency === 'USD',
    ...overrides,
  };
}

describe('price types', () => {
  it('detects providers with historical support', () => {
    const provider = createProvider({
      getHistoricalPrice: async () => ({
        provider: 'test-provider',
        price: 49999,
        currency: 'USD',
        timestamp: new Date('2025-12-31T00:00:00.000Z'),
      }),
      getPriceHistory: async () => [],
    } as any);

    expect(hasHistoricalSupport(provider)).toBe(true);
  });

  it('returns false when historical methods are missing', () => {
    const provider = createProvider();

    expect(hasHistoricalSupport(provider)).toBe(false);
  });

  it('returns false when historical properties exist but are not functions', () => {
    const provider = createProvider({
      getHistoricalPrice: 'not-a-function' as any,
      getPriceHistory: [] as any,
    } as any);

    expect(hasHistoricalSupport(provider)).toBe(false);
  });
});
