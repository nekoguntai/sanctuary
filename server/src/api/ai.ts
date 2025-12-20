/**
 * AI API Routes
 *
 * Endpoints for AI-powered features (transaction labeling, natural language queries).
 * All routes require authentication. AI must be enabled in admin settings.
 *
 * SECURITY: Backend forwards requests to isolated AI container.
 * The backend NEVER makes external AI calls directly.
 *
 * Rate limited to prevent abuse of AI endpoints.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { aiService } from '../services/aiService';
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
      containerAvailable: health.containerAvailable,
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
 *   - transactionId: string - Transaction ID to suggest label for
 *
 * The AI container fetches sanitized transaction data internally.
 * This ensures no sensitive data (addresses, txids) is exposed.
 */
router.post('/suggest-label', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.body;

    // Validation
    if (!transactionId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'transactionId is required',
      });
    }

    const enabled = await aiService.isEnabled();
    if (!enabled) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'AI is not enabled or configured',
      });
    }

    // Get auth token to pass to AI container
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

    const suggestion = await aiService.suggestTransactionLabel(transactionId, authToken);

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
 *
 * Returns a structured query that the frontend can execute.
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

    // Get auth token to pass to AI container
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

    const result = await aiService.executeNaturalQuery(query, walletId, authToken);

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
