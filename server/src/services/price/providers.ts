/**
 * Price Feed Providers
 *
 * Individual provider implementations for fetching Bitcoin prices
 * from various APIs.
 */

import axios from 'axios';

export interface PriceData {
  provider: string;
  price: number;
  currency: string;
  timestamp: Date;
}

/**
 * Mempool.space API
 * Provides Bitcoin price data with good reliability
 */
export async function fetchMempoolPrice(currency: string = 'USD'): Promise<PriceData> {
  try {
    const response = await axios.get('https://mempool.space/api/v1/prices', {
      timeout: 5000,
    });

    const currencyKey = currency.toUpperCase();
    const price = response.data[currencyKey];

    if (!price) {
      throw new Error(`Currency ${currency} not available from Mempool`);
    }

    return {
      provider: 'mempool',
      price,
      currency: currencyKey,
      timestamp: new Date(),
    };
  } catch (error: any) {
    throw new Error(`Mempool API error: ${error.message}`);
  }
}

/**
 * CoinGecko API
 * Free tier with good coverage of fiat currencies
 */
export async function fetchCoinGeckoPrice(currency: string = 'USD'): Promise<PriceData> {
  try {
    const currencyLower = currency.toLowerCase();
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: {
          ids: 'bitcoin',
          vs_currencies: currencyLower,
        },
        timeout: 5000,
      }
    );

    const price = response.data.bitcoin?.[currencyLower];

    if (!price) {
      throw new Error(`Currency ${currency} not available from CoinGecko`);
    }

    return {
      provider: 'coingecko',
      price,
      currency: currency.toUpperCase(),
      timestamp: new Date(),
    };
  } catch (error: any) {
    throw new Error(`CoinGecko API error: ${error.message}`);
  }
}

/**
 * Kraken API
 * Exchange price data, good for major fiat currencies
 */
export async function fetchKrakenPrice(currency: string = 'USD'): Promise<PriceData> {
  try {
    // Kraken uses different currency codes
    const krakenCurrency = currency.toUpperCase();
    const pair = `XXBTZ${krakenCurrency}`;

    const response = await axios.get(
      `https://api.kraken.com/0/public/Ticker`,
      {
        params: {
          pair,
        },
        timeout: 5000,
      }
    );

    if (response.data.error?.length > 0) {
      throw new Error(response.data.error[0]);
    }

    // Kraken returns data with a dynamic key
    const pairData = Object.values(response.data.result)[0] as any;
    const price = parseFloat(pairData.c[0]); // Last trade closed array [price, lot volume]

    return {
      provider: 'kraken',
      price,
      currency: krakenCurrency,
      timestamp: new Date(),
    };
  } catch (error: any) {
    throw new Error(`Kraken API error: ${error.message}`);
  }
}

/**
 * Coinbase API
 * Another reliable exchange source
 */
export async function fetchCoinbasePrice(currency: string = 'USD'): Promise<PriceData> {
  try {
    const currencyUpper = currency.toUpperCase();
    const pair = `BTC-${currencyUpper}`;

    const response = await axios.get(
      `https://api.coinbase.com/v2/prices/${pair}/spot`,
      {
        timeout: 5000,
      }
    );

    const price = parseFloat(response.data.data.amount);

    return {
      provider: 'coinbase',
      price,
      currency: currencyUpper,
      timestamp: new Date(),
    };
  } catch (error: any) {
    throw new Error(`Coinbase API error: ${error.message}`);
  }
}

/**
 * Binance API
 * High-volume exchange with good uptime
 */
export async function fetchBinancePrice(currency: string = 'USD'): Promise<PriceData> {
  try {
    // Binance uses USDT for USD
    let symbol = 'BTCUSDT';
    if (currency.toUpperCase() === 'EUR') {
      symbol = 'BTCEUR';
    } else if (currency.toUpperCase() === 'GBP') {
      symbol = 'BTCGBP';
    }

    const response = await axios.get(
      'https://api.binance.com/api/v3/ticker/price',
      {
        params: { symbol },
        timeout: 5000,
      }
    );

    const price = parseFloat(response.data.price);

    return {
      provider: 'binance',
      price,
      currency: currency.toUpperCase(),
      timestamp: new Date(),
    };
  } catch (error: any) {
    throw new Error(`Binance API error: ${error.message}`);
  }
}

/**
 * Get all available providers
 */
export const providers = {
  mempool: fetchMempoolPrice,
  coingecko: fetchCoinGeckoPrice,
  kraken: fetchKrakenPrice,
  coinbase: fetchCoinbasePrice,
  binance: fetchBinancePrice,
};

/**
 * CoinGecko Historical Price API
 * Get Bitcoin price at a specific date
 */
export async function fetchCoinGeckoHistoricalPrice(
  date: Date,
  currency: string = 'USD'
): Promise<PriceData> {
  try {
    const currencyLower = currency.toLowerCase();

    // Format date as DD-MM-YYYY (CoinGecko format)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}-${month}-${year}`;

    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/bitcoin/history`,
      {
        params: {
          date: dateStr,
        },
        timeout: 10000, // Historical queries can be slower
      }
    );

    // CoinGecko historical API returns market data
    const price = response.data.market_data?.current_price?.[currencyLower];

    if (!price) {
      throw new Error(`Historical price not available for ${currency} on ${dateStr}`);
    }

    return {
      provider: 'coingecko',
      price,
      currency: currency.toUpperCase(),
      timestamp: date,
    };
  } catch (error: any) {
    throw new Error(`CoinGecko historical API error: ${error.message}`);
  }
}

/**
 * CoinGecko Market Chart API (for date ranges)
 * Get Bitcoin price history over a range
 */
export async function fetchCoinGeckoMarketChart(
  days: number,
  currency: string = 'USD'
): Promise<Array<{ timestamp: Date; price: number }>> {
  try {
    const currencyLower = currency.toLowerCase();

    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart`,
      {
        params: {
          vs_currency: currencyLower,
          days: days,
          interval: days <= 1 ? 'hourly' : 'daily',
        },
        timeout: 10000,
      }
    );

    // CoinGecko returns prices as [timestamp_ms, price]
    const prices = response.data.prices;

    if (!prices || !Array.isArray(prices)) {
      throw new Error('Invalid response format from CoinGecko');
    }

    return prices.map(([timestamp, price]: [number, number]) => ({
      timestamp: new Date(timestamp),
      price,
    }));
  } catch (error: any) {
    throw new Error(`CoinGecko market chart API error: ${error.message}`);
  }
}

/**
 * Supported currencies by provider
 */
export const supportedCurrencies: Record<string, string[]> = {
  mempool: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
  coingecko: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'KRW', 'INR'],
  kraken: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
  coinbase: ['USD', 'EUR', 'GBP', 'CAD'],
  binance: ['USD', 'EUR', 'GBP'],
};
