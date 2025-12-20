/**
 * AI API Routes
 *
 * Endpoints for AI-powered features (transaction labeling, natural language queries).
 * All routes require authentication. AI must be enabled in admin settings.
 *
 * Rate limited to prevent abuse of AI endpoints.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { aiService, TransactionContext } from '../services/aiService';
import { createLogger } from '../utils/logger';
import rateLimit from 'express-rate-limit';

const router = Router();
const log = createLogger('AI-API');

// Rate limiting: 10 requests per minute per IP
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many AI requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/v1/ai/status
 * Check AI availability and get model information
 */
router.get('/status', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const enabled = await aiService.isEnabled();

    if (!enabled) {
      return res.json({
        available: false,
        message: 'AI is disabled or not configured',
      });
    }

    const health = await aiService.checkHealth();

    res.json({
      available: health.available,
      model: health.model,
      endpoint: health.endpoint,
      error: health.error,
    });
  } catch (error) {
    log.error('AI status check failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check AI status',
    });
  }
});

/**
 * POST /api/v1/ai/suggest-label
 * Get label suggestion for a transaction
 *
 * Request body:
 *   - amount: number (satoshis)
 *   - direction: 'send' | 'receive'
 *   - address?: string
 *   - date: string (ISO date)
 *   - existingLabels?: string[]
 */
router.post('/suggest-label', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { amount, direction, address, date, existingLabels } = req.body;

    // Validation
    if (!amount || !direction || !date) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Amount, direction, and date are required',
      });
    }

    if (direction !== 'send' && direction !== 'receive') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Direction must be "send" or "receive"',
      });
    }

    const enabled = await aiService.isEnabled();
    if (!enabled) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI is not enabled or configured',
      });
    }

    // Build transaction context
    const context: TransactionContext = {
      amount: Number(amount),
      direction,
      address: address || undefined,
      date: new Date(date),
      existingLabels: existingLabels || [],
    };

    const suggestion = await aiService.suggestTransactionLabel(context);

    if (!suggestion) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI endpoint is not available or returned no suggestion',
      });
    }

    res.json({
      suggestion,
    });
  } catch (error) {
    log.error('AI label suggestion failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate label suggestion',
    });
  }
});

/**
 * POST /api/v1/ai/query
 * Execute a natural language query
 *
 * Request body:
 *   - query: string - Natural language query
 *   - walletId: string - Wallet ID for context
 */
router.post('/query', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { query, walletId } = req.body;

    // Validation
    if (!query || !walletId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Query and walletId are required',
      });
    }

    const enabled = await aiService.isEnabled();
    if (!enabled) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI is not enabled or configured',
      });
    }

    const result = await aiService.executeNaturalQuery(query, walletId);

    if (!result) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI endpoint is not available or could not process query',
      });
    }

    res.json(result);
  } catch (error) {
    log.error('AI natural query failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to execute natural language query',
    });
  }
});

export default router;
