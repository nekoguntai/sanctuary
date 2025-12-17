import React, { createContext, useContext, useState, useEffect } from 'react';
import { useUser } from './UserContext';
import * as priceApi from '../src/api/price';
import { createLogger } from '../utils/logger';

const log = createLogger('Currency');

export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY';
export type BitcoinUnit = 'sats' | 'btc';

interface CurrencyContextType {
  showFiat: boolean;
  toggleShowFiat: () => void;
  fiatCurrency: FiatCurrency;
  setFiatCurrency: (code: FiatCurrency) => void;
  unit: BitcoinUnit;
  setUnit: (unit: BitcoinUnit) => void;
  btcPrice: number | null;
  priceChange24h: number | null;
  currencySymbol: string;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  formatFiat: (sats: number) => string | null;
  getFiatValue: (sats: number) => number | null;
  formatFiatPrice: (price: number | null) => string;
  priceLoading: boolean;
  priceError: string | null;
  lastPriceUpdate: Date | null;
  refreshPrice: () => Promise<void>;
  priceProvider: string;
  setPriceProvider: (provider: string) => void;
  availableProviders: string[];
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥'
};

export const CurrencyProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const { user, updatePreferences } = useUser();

  // Local state fallbacks for when user is not logged in yet (or if preferences are missing)
  const [localShowFiat, setLocalShowFiat] = useState(false);
  const [localFiatCurrency, setLocalFiatCurrency] = useState<FiatCurrency>('USD');
  const [localUnit, setLocalUnit] = useState<BitcoinUnit>('sats');
  const [localPriceProvider, setLocalPriceProvider] = useState<string>('auto');

  // Price fetching state - start with null until first real price is fetched
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>(['auto']);

  // Derive values from user prefs if available, else local
  const showFiat = user?.preferences?.showFiat ?? localShowFiat;
  const fiatCurrency = (user?.preferences?.fiatCurrency as FiatCurrency) ?? localFiatCurrency;
  const unit = (user?.preferences?.unit as BitcoinUnit) ?? localUnit;
  const priceProvider = (user?.preferences?.priceProvider as string) ?? localPriceProvider;

  const setFiatCurrency = (code: FiatCurrency) => {
    if (user) updatePreferences({ fiatCurrency: code });
    else setLocalFiatCurrency(code);
  };

  const setUnit = (u: BitcoinUnit) => {
    if (user) updatePreferences({ unit: u });
    else setLocalUnit(u);
  };

  const setPriceProvider = (provider: string) => {
    if (user) updatePreferences({ priceProvider: provider });
    else setLocalPriceProvider(provider);
  };

  const toggleShowFiat = () => {
    if (user) updatePreferences({ showFiat: !showFiat });
    else setLocalShowFiat(!localShowFiat);
  };

  const currencySymbol = SYMBOLS[fiatCurrency];

  // Fetch live price from API
  const refreshPrice = async () => {
    try {
      setPriceLoading(true);
      setPriceError(null);

      const priceData = await priceApi.getPrice(fiatCurrency, true);
      setBtcPrice(priceData.price);
      setPriceChange24h(priceData.change24h ?? null);
      setLastPriceUpdate(new Date(priceData.timestamp));
    } catch (error) {
      log.error('Failed to fetch BTC price', { error });
      setPriceError('Failed to fetch price');
      // Keep btcPrice as null to show "-----" instead of stale fallback
    } finally {
      setPriceLoading(false);
    }
  };

  // Set available providers (hardcoded since API requires auth)
  useEffect(() => {
    setAvailableProviders(['auto', 'coingecko', 'mempool', 'kraken', 'coinbase', 'binance']);
  }, []);

  // Fetch price on mount and when currency changes
  useEffect(() => {
    refreshPrice();

    // Refresh price every 60 seconds
    const interval = setInterval(refreshPrice, 60000);
    return () => clearInterval(interval);
  }, [fiatCurrency]);

  const getFiatValue = (sats: number): number | null => {
    if (btcPrice === null) return null;
    return (sats / 100000000) * btcPrice;
  };

  // Format fiat price - returns "-----" if price not yet loaded
  const formatFiatPrice = (price: number | null): string => {
    if (price === null) return '-----';
    return `${currencySymbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format BTC/sats value only (no fiat)
  const format = (sats: number, options?: { forceSats?: boolean }) => {
    const useSats = options?.forceSats || unit === 'sats';

    if (useSats) {
      return `${sats.toLocaleString()} sats`;
    } else {
      // Trim trailing zeros from BTC display
      const btcValue = (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, '');
      return `${btcValue} BTC`;
    }
  };

  // Format fiat value only (returns null if fiat is disabled or price unavailable)
  const formatFiat = (sats: number): string | null => {
    if (!showFiat) return null;
    const fiatVal = getFiatValue(sats);
    if (fiatVal === null) return '-----';
    return `${currencySymbol}${fiatVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <CurrencyContext.Provider value={{
      showFiat,
      toggleShowFiat,
      fiatCurrency,
      setFiatCurrency,
      unit,
      setUnit,
      btcPrice,
      priceChange24h,
      currencySymbol,
      format,
      formatFiat,
      getFiatValue,
      formatFiatPrice,
      priceLoading,
      priceError,
      lastPriceUpdate,
      refreshPrice,
      priceProvider,
      setPriceProvider,
      availableProviders
    }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) throw new Error('useCurrency must be used within CurrencyProvider');
  return context;
};