/**
 * Binance Price Provider
 *
 * Fetches Bitcoin price from Binance API.
 * High-volume exchange with good uptime.
 */

import { BasePriceProvider } from './base';
import type { PriceData } from '../types';

interface BinancePriceResponse {
  symbol: string;
  price: string;
}

export class BinancePriceProvider extends BasePriceProvider {
  private symbolMap: Record<string, string> = {
    USD: 'BTCUSDT', // Binance uses USDT for USD
    EUR: 'BTCEUR',
    GBP: 'BTCGBP',
  };

  constructor() {
    super({
      name: 'binance',
      priority: 60, // Fifth priority
      supportedCurrencies: ['USD', 'EUR', 'GBP'],
    });
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const symbol = this.symbolMap[currency];

    if (!symbol) {
      throw new Error(`Currency ${currency} not supported by Binance`);
    }

    const data = await this.httpGet<BinancePriceResponse>(
      'https://api.binance.com/api/v3/ticker/price',
      { symbol }
    );

    const price = parseFloat(data.price);

    return {
      provider: this.name,
      price,
      currency,
      timestamp: new Date(),
    };
  }
}
