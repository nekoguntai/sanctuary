/**
 * Wallets - Import Router
 *
 * Wallet import from descriptors or JSON files
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../../utils/logger';
import { getErrorMessage, isPrismaError } from '../../utils/errors';
import * as walletImport from '../../services/walletImport';

const router = Router();
const log = createLogger('WALLETS:IMPORT');

/**
 * GET /api/v1/wallets/import/formats
 * Get available import formats
 */
router.get('/import/formats', async (_req: Request, res: Response) => {
  try {
    const { importFormatRegistry } = await import('../../services/import');
    const handlers = importFormatRegistry.getAll();

    const formats = handlers.map((handler) => ({
      id: handler.id,
      name: handler.name,
      description: handler.description,
      extensions: handler.fileExtensions || [],
      priority: handler.priority,
    }));

    res.json({ formats });
  } catch (error) {
    log.error('Get import formats error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get import formats',
    });
  }
});

/**
 * POST /api/v1/wallets/import/validate
 * Validate import data and preview what will happen
 */
router.post('/import/validate', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { descriptor, json } = req.body;

    if (!descriptor && !json) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Either descriptor or json is required',
      });
    }

    const result = await walletImport.validateImport(userId, {
      descriptor,
      json,
    });

    res.json(result);
  } catch (error) {
    log.error('Import validate error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to validate import data'),
    });
  }
});

/**
 * POST /api/v1/wallets/import
 * Import a wallet from descriptor or JSON
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { data, name, network, deviceLabels } = req.body;

    if (!data) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'data (descriptor or JSON) is required',
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name is required',
      });
    }

    const result = await walletImport.importWallet(userId, {
      data,
      name: name.trim(),
      network,
      deviceLabels,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error('Import wallet error', { error });

    // Check for unique constraint violation (duplicate fingerprint)
    if (isPrismaError(error) && error.code === 'P2002') {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes('fingerprint')) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'A device with this fingerprint already exists for another user',
        });
      }
    }

    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to import wallet'),
    });
  }
});

export default router;
