/**
 * AI Status Route
 *
 * GET /ai/status - Check AI availability and model information
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { aiService } from '../../services/aiService';
import type { RequestHandler } from 'express';

export function createStatusRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

  router.get('/status', authenticate, aiRateLimiter, asyncHandler(async (_req, res) => {
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
  }));

  return router;
}
