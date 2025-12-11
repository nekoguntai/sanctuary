/**
 * Wallet API Routes
 *
 * API endpoints for wallet management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import * as walletService from '../services/wallet';
import * as walletImport from '../services/walletImport';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/wallets
 * Get all wallets for authenticated user
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const wallets = await walletService.getUserWallets(userId);

    res.json(wallets);
  } catch (error) {
    console.error('[WALLETS] Get wallets error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallets',
    });
  }
});

/**
 * POST /api/v1/wallets
 * Create a new wallet
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      name,
      type,
      scriptType,
      network,
      quorum,
      totalSigners,
      descriptor,
      fingerprint,
      groupId,
      deviceIds,
    } = req.body;

    // Validation
    if (!name || !type || !scriptType) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, type, and scriptType are required',
      });
    }

    if (!['single_sig', 'multi_sig'].includes(type)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'type must be single_sig or multi_sig',
      });
    }

    if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(scriptType)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid scriptType',
      });
    }

    const wallet = await walletService.createWallet(userId, {
      name,
      type,
      scriptType,
      network,
      quorum,
      totalSigners,
      descriptor,
      fingerprint,
      groupId,
      deviceIds,
    });

    res.status(201).json(wallet);
  } catch (error: any) {
    console.error('[WALLETS] Create wallet error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const wallet = await walletService.getWalletById(id, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json(wallet);
  } catch (error) {
    console.error('[WALLETS] Get wallet error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { name, descriptor } = req.body;

    const wallet = await walletService.updateWallet(id, userId, {
      name,
      descriptor,
    });

    res.json(wallet);
  } catch (error: any) {
    console.error('[WALLETS] Update wallet error:', error);

    if (error.message.includes('owner')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update wallet',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    await walletService.deleteWallet(id, userId);

    res.status(204).send();
  } catch (error: any) {
    console.error('[WALLETS] Delete wallet error:', error);

    if (error.message.includes('owner')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/stats
 * Get wallet statistics
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const stats = await walletService.getWalletStats(id, userId);

    res.json(stats);
  } catch (error: any) {
    console.error('[WALLETS] Get wallet stats error:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet stats',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/addresses
 * Generate a new receiving address
 */
router.post('/:id/addresses', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const address = await walletService.generateAddress(id, userId);

    res.status(201).json({ address });
  } catch (error: any) {
    console.error('[WALLETS] Generate address error:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate address',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/devices
 * Add a device to wallet
 */
router.post('/:id/devices', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { deviceId, signerIndex } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'deviceId is required',
      });
    }

    await walletService.addDeviceToWallet(id, deviceId, userId, signerIndex);

    res.status(201).json({ message: 'Device added to wallet' });
  } catch (error: any) {
    console.error('[WALLETS] Add device error:', error);

    if (error.message.includes('not found') || error.message.includes('denied')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add device to wallet',
    });
  }
});

/**
 * POST /api/v1/wallets/validate-xpub
 * Validate an xpub and generate descriptor
 */
router.post('/validate-xpub', async (req: Request, res: Response) => {
  try {
    const { xpub, scriptType, network = 'mainnet', fingerprint, accountPath } = req.body;

    if (!xpub) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'xpub is required',
      });
    }

    // Validate xpub
    const addressDerivation = await import('../services/bitcoin/addressDerivation');
    const validation = addressDerivation.validateXpub(xpub, network);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: validation.error || 'Invalid xpub',
      });
    }

    // Determine script type
    const detectedScriptType = scriptType || validation.scriptType || 'native_segwit';

    // Generate descriptor
    let descriptor: string;
    const fingerprintStr = fingerprint || '00000000';
    const accountPathStr = accountPath || getDefaultAccountPath(detectedScriptType, network);

    switch (detectedScriptType) {
      case 'native_segwit':
        descriptor = `wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      case 'nested_segwit':
        descriptor = `sh(wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*))`;
        break;
      case 'taproot':
        descriptor = `tr([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      case 'legacy':
        descriptor = `pkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      default:
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid script type',
        });
    }

    // Derive first address as example
    const { address } = addressDerivation.deriveAddress(xpub, 0, {
      scriptType: detectedScriptType,
      network,
      change: false,
    });

    res.json({
      valid: true,
      descriptor,
      scriptType: detectedScriptType,
      firstAddress: address,
      xpub,
      fingerprint: fingerprintStr,
      accountPath: accountPathStr,
    });
  } catch (error: any) {
    console.error('[WALLETS] Validate xpub error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to validate xpub',
    });
  }
});

/**
 * Helper to get default account path
 */
function getDefaultAccountPath(scriptType: string, network: string): string {
  const coinType = network === 'mainnet' ? "0'" : "1'";

  switch (scriptType) {
    case 'legacy':
      return `44'/${coinType}/0'`;
    case 'nested_segwit':
      return `49'/${coinType}/0'`;
    case 'native_segwit':
      return `84'/${coinType}/0'`;
    case 'taproot':
      return `86'/${coinType}/0'`;
    default:
      return `84'/${coinType}/0'`;
  }
}

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
  } catch (error: any) {
    console.error('[WALLETS] Import validate error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to validate import data',
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
  } catch (error: any) {
    console.error('[WALLETS] Import wallet error:', error);

    // Check for unique constraint violation (duplicate fingerprint)
    if (error.code === 'P2002' && error.meta?.target?.includes('fingerprint')) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A device with this fingerprint already exists for another user',
      });
    }

    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to import wallet',
    });
  }
});

export default router;
