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
import { AI_RATE_LIMIT_WINDOW_MS, AI_RATE_LIMIT_MAX_REQUESTS } from '../constants';
import * as os from 'os';
import { execSync } from 'child_process';

const router = Router();
const log = createLogger('AI-API');

// Rate limiting: prevent abuse of AI endpoints
const aiRateLimiter = rateLimit({
  windowMs: AI_RATE_LIMIT_WINDOW_MS,
  max: AI_RATE_LIMIT_MAX_REQUESTS,
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

/**
 * POST /api/v1/ai/detect-ollama
 * Auto-detect Ollama at common endpoints
 */
router.post('/detect-ollama', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await aiService.detectOllama();
    res.json(result);
  } catch (error) {
    log.error('Ollama detection failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to detect Ollama',
    });
  }
});

/**
 * GET /api/v1/ai/models
 * List available models from configured endpoint
 */
router.get('/models', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await aiService.listModels();

    if (result.error) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: result.error,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('List models failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list models',
    });
  }
});

/**
 * POST /api/v1/ai/pull-model
 * Pull (download) a model from Ollama
 */
router.post('/pull-model', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Model name is required',
      });
    }

    const result = await aiService.pullModel(model);

    if (!result.success) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: result.error || 'Pull failed',
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Pull model failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to pull model',
    });
  }
});

/**
 * DELETE /api/v1/ai/delete-model
 * Delete a model from Ollama
 */
router.delete('/delete-model', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Model name is required',
      });
    }

    const result = await aiService.deleteModel(model);

    if (!result.success) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: result.error || 'Delete failed',
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Delete model failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete model',
    });
  }
});

// ============================================
// Ollama Container Management
// ============================================
// These endpoints allow the UI to start/stop the bundled Ollama container.
// Uses Docker socket proxy for security (only allows container start/stop).

import * as docker from '../utils/docker';

/**
 * GET /api/v1/ai/ollama-container/status
 * Get the status of the bundled Ollama container
 */
router.get('/ollama-container/status', authenticate, async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get Ollama container status failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Ollama container status',
    });
  }
});

/**
 * POST /api/v1/ai/ollama-container/start
 * Start the bundled Ollama container
 */
router.post('/ollama-container/start', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await docker.startOllama();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to start',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Start Ollama container failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to start Ollama container',
    });
  }
});

/**
 * POST /api/v1/ai/ollama-container/stop
 * Stop the bundled Ollama container
 */
router.post('/ollama-container/stop', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await docker.stopOllama();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to stop',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Stop Ollama container failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to stop Ollama container',
    });
  }
});

// ============================================
// System Resources Check
// ============================================

// Minimum requirements for AI features
const MIN_RAM_MB = 4096; // 4GB RAM
const MIN_DISK_MB = 8192; // 8GB disk space

interface DiskInfo {
  total: number;
  available: number;
}

/**
 * Get disk space info for the root filesystem (or relevant mount)
 */
function getDiskInfo(): DiskInfo {
  try {
    // Try to get disk space using df command
    const output = execSync('df -m / 2>/dev/null || df -m . 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      // Parse df output: Filesystem, 1M-blocks, Used, Available, Use%, Mounted on
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        return {
          total: parseInt(parts[1], 10) || 0,
          available: parseInt(parts[3], 10) || 0,
        };
      }
    }
  } catch (error) {
    log.warn('Failed to get disk info', { error: String(error) });
  }

  return { total: 0, available: 0 };
}

/**
 * Check for NVIDIA GPU availability
 */
function getGpuInfo(): { available: boolean; name: string | null } {
  try {
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const gpuName = output.trim().split('\n')[0];
    if (gpuName) {
      return { available: true, name: gpuName };
    }
  } catch {
    // nvidia-smi not available or no GPU
  }

  return { available: false, name: null };
}

/**
 * GET /api/v1/ai/system-resources
 * Check system resources before enabling AI
 *
 * Returns RAM, disk space, and GPU availability with sufficiency indicators.
 * Used by the frontend to show a confirmation dialog before enabling AI.
 */
router.get('/system-resources', authenticate, async (req: Request, res: Response) => {
  try {
    // Get RAM info
    const totalRamMB = Math.round(os.totalmem() / (1024 * 1024));
    const freeRamMB = Math.round(os.freemem() / (1024 * 1024));

    // Get disk info
    const diskInfo = getDiskInfo();

    // Get GPU info
    const gpuInfo = getGpuInfo();

    // Check sufficiency
    const ramSufficient = freeRamMB >= MIN_RAM_MB;
    const diskSufficient = diskInfo.available >= MIN_DISK_MB;

    res.json({
      ram: {
        total: totalRamMB,
        available: freeRamMB,
        required: MIN_RAM_MB,
        sufficient: ramSufficient,
      },
      disk: {
        total: diskInfo.total,
        available: diskInfo.available,
        required: MIN_DISK_MB,
        sufficient: diskSufficient,
      },
      gpu: gpuInfo,
      overall: {
        sufficient: ramSufficient && diskSufficient,
        warnings: [
          ...(!ramSufficient ? [`Low RAM: ${freeRamMB}MB available, ${MIN_RAM_MB}MB recommended`] : []),
          ...(!diskSufficient ? [`Low disk space: ${diskInfo.available}MB available, ${MIN_DISK_MB}MB recommended`] : []),
        ],
      },
    });
  } catch (error) {
    log.error('System resources check failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check system resources',
    });
  }
});

export default router;
