/**
 * Ollama Container Management Routes
 *
 * GET /ai/ollama-container/status - Get container status
 * POST /ai/ollama-container/start - Start container
 * POST /ai/ollama-container/stop - Stop container
 *
 * Uses Docker socket proxy for security (only allows container start/stop).
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import * as docker from '../../utils/docker';

export function createContainerRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/ai/ollama-container/status
   * Get the status of the bundled Ollama container
   */
  router.get('/ollama-container/status', authenticate, asyncHandler(async (_req, res) => {
    const proxyAvailable = await docker.isDockerProxyAvailable();

    if (!proxyAvailable) {
      return res.json({
        available: false,
        exists: false,
        running: false,
        message: 'Docker management not available',
      });
    }

    const status = await docker.getOllamaStatus();

    res.json({
      available: true,
      ...status,
    });
  }));

  /**
   * POST /api/v1/ai/ollama-container/start
   * Start the bundled Ollama container
   */
  router.post('/ollama-container/start', authenticate, asyncHandler(async (_req, res) => {
    const result = await docker.startOllama();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to start',
        message: result.message,
      });
    }

    res.json(result);
  }));

  /**
   * POST /api/v1/ai/ollama-container/stop
   * Stop the bundled Ollama container
   */
  router.post('/ollama-container/stop', authenticate, asyncHandler(async (_req, res) => {
    const result = await docker.stopOllama();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to stop',
        message: result.message,
      });
    }

    res.json(result);
  }));

  return router;
}
