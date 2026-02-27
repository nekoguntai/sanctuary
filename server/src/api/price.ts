/**
 * Price API Routes
 *
 * API endpoints for Bitcoin price data
 */

import { Router, Request, Response } from 'express';
import { getPriceService } from '../services/price';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();
const log = createLogger('PRICE');
const priceService = getPriceService();

/**
 * GET /api/v1/price
 * Get current Bitcoin price
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { currency = 'USD', useCache = 'true' } = req.query;

    const price = await priceService.getPrice(
      currency as string,
      useCache === 'true'
    );

    res.json(price);
  } catch (error) {
    log.error('[PRICE] Get price error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to fetch price'),
    });
  }
});

/**
 * GET /api/v1/price/multiple
 * Get prices for multiple currencies
 */
router.get('/multiple', async (req: Request, res: Response) => {
  try {
    const { currencies } = req.query;

    if (!currencies) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'currencies parameter is required (comma-separated)',
      });
    }

    const currencyList = (currencies as string).split(',').map((c) => c.trim());
    const prices = await priceService.getPrices(currencyList);

    res.json(prices);
  } catch (error) {
    log.error('[PRICE] Get multiple prices error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch prices',
    });
  }
});

/**
 * GET /api/v1/price/from/:provider
 * Get price from specific provider
 */
router.get('/from/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { currency = 'USD' } = req.query;

    const price = await priceService.getPriceFrom(provider, currency as string);

    res.json(price);
  } catch (error) {
    log.error('[PRICE] Get price from provider error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to fetch price from provider'),
    });
  }
});

/**
 * POST /api/v1/price/convert/to-fiat
 * Convert satoshis to fiat
 */
router.post('/convert/to-fiat', async (req: Request, res: Response) => {
  try {
    const { sats, currency = 'USD' } = req.body;

    if (typeof sats !== 'number') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'sats must be a number',
      });
    }

    const fiatAmount = await priceService.convertToFiat(sats, currency);

    res.json({
      sats,
      fiatAmount,
      currency,
    });
  } catch (error) {
    log.error('[PRICE] Convert to fiat error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to convert to fiat'),
    });
  }
});

/**
 * POST /api/v1/price/convert/to-sats
 * Convert fiat to satoshis
 */
router.post('/convert/to-sats', async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'USD' } = req.body;

    if (typeof amount !== 'number') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount must be a number',
      });
    }

    const sats = await priceService.convertToSats(amount, currency);

    res.json({
      amount,
      currency,
      sats,
    });
  } catch (error) {
    log.error('[PRICE] Convert to sats error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to convert to sats'),
    });
  }
});

/**
 * GET /api/v1/price/currencies
 * Get list of supported currencies
 */
router.get('/currencies', (req: Request, res: Response) => {
  const currencies = priceService.getSupportedCurrencies();
  res.json({
    currencies,
    count: currencies.length,
  });
});

/**
 * GET /api/v1/price/providers
 * Get list of available price providers
 */
router.get('/providers', (req: Request, res: Response) => {
  const providers = priceService.getProviders();
  res.json({
    providers,
    count: providers.length,
  });
});

/**
 * GET /api/v1/price/health
 * Health check for price providers
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await priceService.healthCheck();
    res.json(health);
  } catch (error) {
    log.error('[PRICE] Health check error', { error: String(error) });
    res.status(500).json({
      healthy: false,
      error: 'Failed to perform health check',
    });
  }
});

/**
 * GET /api/v1/price/cache/stats
 * Get cache statistics (admin only)
 */
router.get('/cache/stats', authenticate, requireAdmin, (req: Request, res: Response) => {
  const stats = priceService.getCacheStats();
  res.json(stats);
});

/**
 * POST /api/v1/price/cache/clear
 * Clear price cache (admin only)
 */
router.post('/cache/clear', authenticate, requireAdmin, async (req: Request, res: Response) => {
  log.info('Cache cleared by admin', { userId: (req as any).user?.id });
  await priceService.clearCache();
  res.json({
    message: 'Cache cleared successfully',
  });
});

/**
 * POST /api/v1/price/cache/duration
 * Set cache duration (admin only)
 */
router.post('/cache/duration', authenticate, requireAdmin, (req: Request, res: Response) => {
  const { duration } = req.body;

  if (typeof duration !== 'number' || duration < 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'duration must be a positive number (milliseconds)',
    });
  }

  log.info('Cache duration updated by admin', { userId: (req as any).user?.id, duration });
  priceService.setCacheDuration(duration);

  res.json({
    message: 'Cache duration updated',
    duration,
  });
});

/**
 * GET /api/v1/price/historical
 * Get historical Bitcoin price for a specific date
 */
router.get('/historical', async (req: Request, res: Response) => {
  try {
    const { date, currency = 'USD' } = req.query;

    if (!date) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'date parameter is required (YYYY-MM-DD or ISO format)',
      });
    }

    // Parse date
    const parsedDate = new Date(date as string);

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid date format. Use YYYY-MM-DD or ISO format',
      });
    }

    // Check if date is in the future
    if (parsedDate > new Date()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Date cannot be in the future',
      });
    }

    const price = await priceService.getHistoricalPrice(currency as string, parsedDate);

    res.json({
      date: parsedDate.toISOString(),
      currency: currency,
      price,
      provider: 'coingecko',
    });
  } catch (error) {
    log.error('[PRICE] Get historical price error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to fetch historical price'),
    });
  }
});

/**
 * GET /api/v1/price/history
 * Get price history over a date range
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { days = '30', currency = 'USD' } = req.query;

    const daysNum = parseInt(days as string, 10);

    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'days must be a number between 1 and 365',
      });
    }

    const history = await priceService.getPriceHistory(currency as string, daysNum);

    res.json({
      currency,
      days: daysNum,
      dataPoints: history.length,
      history: history.map(({ timestamp, price }) => ({
        timestamp: timestamp.toISOString(),
        price,
      })),
      provider: 'coingecko',
    });
  } catch (error) {
    log.error('[PRICE] Get price history error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to fetch price history'),
    });
  }
});

export default router;
