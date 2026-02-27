/**
 * Labels API Routes
 *
 * API endpoints for managing labels on transactions and addresses.
 * Labels can be attached to multiple transactions/addresses and vice versa.
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, signer, viewer)
 * - WRITE (POST, PUT, DELETE): Only owner or signer roles
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { labelService } from '../services/labelService';
import { ApiError } from '../errors';
import { createLogger } from '../utils/logger';

const log = createLogger('LABELS');

const router = Router();

// All routes require authentication
router.use(authenticate);

// ========================================
// LABEL CRUD OPERATIONS
// ========================================

/**
 * GET /api/v1/wallets/:walletId/labels
 * Get all labels for a wallet
 */
router.get('/wallets/:walletId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    const labels = await labelService.getLabelsForWallet(walletId, userId);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Get labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch labels',
    });
  }
});

/**
 * GET /api/v1/wallets/:walletId/labels/:labelId
 * Get a specific label with all associated transactions and addresses
 */
router.get('/wallets/:walletId/labels/:labelId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, labelId } = req.params;

    const label = await labelService.getLabel(walletId, labelId, userId);

    // Transform response for API (convert BigInt to Number)
    const response = {
      ...label,
      transactions: label.transactions.map(tx => ({
        ...tx,
        amount: Number(tx.amount),
      })),
    };

    res.json(response);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Get label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch label',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/labels
 * Create a new label (requires edit access: owner or signer)
 */
router.post('/wallets/:walletId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;
    const { name, color, description } = req.body;

    const label = await labelService.createLabel(walletId, userId, {
      name,
      color,
      description,
    });

    res.status(201).json(label);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Create label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create label',
    });
  }
});

/**
 * PUT /api/v1/wallets/:walletId/labels/:labelId
 * Update a label (requires edit access: owner or signer)
 */
router.put('/wallets/:walletId/labels/:labelId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, labelId } = req.params;
    const { name, color, description } = req.body;

    const label = await labelService.updateLabel(walletId, labelId, userId, {
      name,
      color,
      description,
    });

    res.json(label);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Update label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update label',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:walletId/labels/:labelId
 * Delete a label (requires edit access: owner or signer)
 */
router.delete('/wallets/:walletId/labels/:labelId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId, labelId } = req.params;

    await labelService.deleteLabel(walletId, labelId, userId);
    res.status(204).send();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Delete label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete label',
    });
  }
});

// ========================================
// TRANSACTION LABEL OPERATIONS
// ========================================

/**
 * GET /api/v1/transactions/:transactionId/labels
 * Get all labels for a transaction
 */
router.get('/transactions/:transactionId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { transactionId } = req.params;

    const labels = await labelService.getTransactionLabels(transactionId, userId);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Get transaction labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch transaction labels',
    });
  }
});

/**
 * POST /api/v1/transactions/:transactionId/labels
 * Add labels to a transaction (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.post('/transactions/:transactionId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { transactionId } = req.params;
    const { labelIds } = req.body;

    const labels = await labelService.addTransactionLabels(transactionId, userId, labelIds);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Add transaction labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add labels to transaction',
    });
  }
});

/**
 * PUT /api/v1/transactions/:transactionId/labels
 * Replace all labels on a transaction (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.put('/transactions/:transactionId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { transactionId } = req.params;
    const { labelIds } = req.body;

    const labels = await labelService.replaceTransactionLabels(transactionId, userId, labelIds);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Replace transaction labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to replace transaction labels',
    });
  }
});

/**
 * DELETE /api/v1/transactions/:transactionId/labels/:labelId
 * Remove a label from a transaction (requires edit access: owner or signer)
 */
router.delete('/transactions/:transactionId/labels/:labelId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { transactionId, labelId } = req.params;

    await labelService.removeTransactionLabel(transactionId, labelId, userId);
    res.status(204).send();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Remove transaction label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove label from transaction',
    });
  }
});

// ========================================
// ADDRESS LABEL OPERATIONS
// ========================================

/**
 * GET /api/v1/addresses/:addressId/labels
 * Get all labels for an address
 */
router.get('/addresses/:addressId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId } = req.params;

    const labels = await labelService.getAddressLabels(addressId, userId);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Get address labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch address labels',
    });
  }
});

/**
 * POST /api/v1/addresses/:addressId/labels
 * Add labels to an address (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.post('/addresses/:addressId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId } = req.params;
    const { labelIds } = req.body;

    const labels = await labelService.addAddressLabels(addressId, userId, labelIds);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Add address labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add labels to address',
    });
  }
});

/**
 * PUT /api/v1/addresses/:addressId/labels
 * Replace all labels on an address (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.put('/addresses/:addressId/labels', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId } = req.params;
    const { labelIds } = req.body;

    const labels = await labelService.replaceAddressLabels(addressId, userId, labelIds);
    res.json(labels);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Replace address labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to replace address labels',
    });
  }
});

/**
 * DELETE /api/v1/addresses/:addressId/labels/:labelId
 * Remove a label from an address (requires edit access: owner or signer)
 */
router.delete('/addresses/:addressId/labels/:labelId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId, labelId } = req.params;

    await labelService.removeAddressLabel(addressId, labelId, userId);
    res.status(204).send();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ error: error.code, message: error.message });
    }
    log.error('Remove address label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove label from address',
    });
  }
});

export default router;
