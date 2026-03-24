/**
 * AI Feature Routes
 *
 * POST /ai/suggest-label - Get label suggestion for a transaction
 * POST /ai/query - Execute a natural language query
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { aiService } from '../../services/aiService';
import type { RequestHandler } from 'express';

export function createFeaturesRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

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
  router.post('/suggest-label', authenticate, aiRateLimiter, asyncHandler(async (req, res) => {
    const { transactionId } = req.body;

    // Validation
    if (!transactionId) {
      throw new InvalidInputError('transactionId is required');
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
  }));

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
  router.post('/query', authenticate, aiRateLimiter, asyncHandler(async (req, res) => {
    const { query, walletId } = req.body;

    // Validation
    if (!query || !walletId) {
      throw new InvalidInputError('Query and walletId are required');
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
  }));

  return router;
}
