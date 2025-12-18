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
import prisma from '../models/prisma';
import { checkWalletAccess, checkWalletEditAccess, checkWalletAccessWithRole } from '../services/wallet';
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

    const hasAccess = await checkWalletAccess(walletId, userId);
    if (!hasAccess) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const labels = await prisma.label.findMany({
      where: { walletId },
      include: {
        _count: {
          select: {
            transactionLabels: true,
            addressLabels: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Transform to include usage counts
    const labelsWithCounts = labels.map(label => ({
      id: label.id,
      walletId: label.walletId,
      name: label.name,
      color: label.color,
      description: label.description,
      createdAt: label.createdAt,
      updatedAt: label.updatedAt,
      transactionCount: label._count.transactionLabels,
      addressCount: label._count.addressLabels,
    }));

    res.json(labelsWithCounts);
  } catch (error) {
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

    const hasAccess = await checkWalletAccess(walletId, userId);
    if (!hasAccess) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const label = await prisma.label.findFirst({
      where: {
        id: labelId,
        walletId,
      },
      include: {
        transactionLabels: {
          include: {
            transaction: {
              select: {
                id: true,
                txid: true,
                type: true,
                amount: true,
                confirmations: true,
                blockTime: true,
              },
            },
          },
        },
        addressLabels: {
          include: {
            address: {
              select: {
                id: true,
                address: true,
                derivationPath: true,
                index: true,
                used: true,
              },
            },
          },
        },
      },
    });

    if (!label) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Label not found',
      });
    }

    // Transform response
    const response = {
      id: label.id,
      walletId: label.walletId,
      name: label.name,
      color: label.color,
      description: label.description,
      createdAt: label.createdAt,
      updatedAt: label.updatedAt,
      transactions: label.transactionLabels.map(tl => ({
        ...tl.transaction,
        amount: Number(tl.transaction.amount),
      })),
      addresses: label.addressLabels.map(al => al.address),
    };

    res.json(response);
  } catch (error) {
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

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Label name is required',
      });
    }

    // Check access and edit permission in a single query
    const { hasAccess, canEdit } = await checkWalletAccessWithRole(walletId, userId);
    if (!hasAccess) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }
    if (!canEdit) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Check for duplicate label name
    const existing = await prisma.label.findFirst({
      where: {
        walletId,
        name: name.trim(),
      },
    });

    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A label with this name already exists',
      });
    }

    const label = await prisma.label.create({
      data: {
        walletId,
        name: name.trim(),
        color: color || '#6366f1',
        description: description || null,
      },
    });

    res.status(201).json(label);
  } catch (error) {
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

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Check label exists
    const existingLabel = await prisma.label.findFirst({
      where: {
        id: labelId,
        walletId,
      },
    });

    if (!existingLabel) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Label not found',
      });
    }

    // If name is being changed, check for duplicates
    if (name && name.trim() !== existingLabel.name) {
      const duplicate = await prisma.label.findFirst({
        where: {
          walletId,
          name: name.trim(),
          id: { not: labelId },
        },
      });

      if (duplicate) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'A label with this name already exists',
        });
      }
    }

    const label = await prisma.label.update({
      where: { id: labelId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(description !== undefined && { description }),
      },
    });

    res.json(label);
  } catch (error) {
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

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Check label exists
    const label = await prisma.label.findFirst({
      where: {
        id: labelId,
        walletId,
      },
    });

    if (!label) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Label not found',
      });
    }

    // Delete label (cascade will handle associations)
    await prisma.label.delete({
      where: { id: labelId },
    });

    res.status(204).send();
  } catch (error) {
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

    // Find transaction and check access
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
      include: {
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Transaction not found',
      });
    }

    const labels = transaction.transactionLabels.map(tl => tl.label);
    res.json(labels);
  } catch (error) {
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

    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'labelIds array is required',
      });
    }

    // Find transaction first
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, walletId: true },
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Transaction not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(transaction.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(transaction.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Transaction not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Verify all labels belong to the same wallet
    const labels = await prisma.label.findMany({
      where: {
        id: { in: labelIds },
        walletId: transaction.walletId,
      },
    });

    if (labels.length !== labelIds.length) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'One or more labels not found or belong to a different wallet',
      });
    }

    // Create associations (skipDuplicates handles existing ones)
    await prisma.transactionLabel.createMany({
      data: labelIds.map(labelId => ({
        transactionId,
        labelId,
      })),
      skipDuplicates: true,
    });

    // Return updated labels
    const updatedLabels = await prisma.transactionLabel.findMany({
      where: { transactionId },
      include: { label: true },
    });

    res.json(updatedLabels.map(tl => tl.label));
  } catch (error) {
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

    if (!Array.isArray(labelIds)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'labelIds array is required',
      });
    }

    // Find transaction first
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, walletId: true },
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Transaction not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(transaction.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(transaction.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Transaction not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Verify all labels belong to the same wallet
    if (labelIds.length > 0) {
      const labels = await prisma.label.findMany({
        where: {
          id: { in: labelIds },
          walletId: transaction.walletId,
        },
      });

      if (labels.length !== labelIds.length) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'One or more labels not found or belong to a different wallet',
        });
      }
    }

    // Replace all labels in a transaction
    await prisma.$transaction([
      prisma.transactionLabel.deleteMany({
        where: { transactionId },
      }),
      prisma.transactionLabel.createMany({
        data: labelIds.map(labelId => ({
          transactionId,
          labelId,
        })),
      }),
    ]);

    // Return updated labels
    const updatedLabels = await prisma.transactionLabel.findMany({
      where: { transactionId },
      include: { label: true },
    });

    res.json(updatedLabels.map(tl => tl.label));
  } catch (error) {
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

    // Find transaction first
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, walletId: true },
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Transaction not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(transaction.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(transaction.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Transaction not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Delete the association
    await prisma.transactionLabel.deleteMany({
      where: {
        transactionId,
        labelId,
      },
    });

    res.status(204).send();
  } catch (error) {
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

    // Find address and check access
    const address = await prisma.address.findFirst({
      where: {
        id: addressId,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
      include: {
        addressLabels: {
          include: {
            label: true,
          },
        },
      },
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    const labels = address.addressLabels.map(al => al.label);
    res.json(labels);
  } catch (error) {
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

    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'labelIds array is required',
      });
    }

    // Find address first
    const address = await prisma.address.findUnique({
      where: { id: addressId },
      select: { id: true, walletId: true },
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(address.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(address.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Address not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Verify all labels belong to the same wallet
    const labels = await prisma.label.findMany({
      where: {
        id: { in: labelIds },
        walletId: address.walletId,
      },
    });

    if (labels.length !== labelIds.length) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'One or more labels not found or belong to a different wallet',
      });
    }

    // Create associations (skipDuplicates handles existing ones)
    await prisma.addressLabel.createMany({
      data: labelIds.map(labelId => ({
        addressId,
        labelId,
      })),
      skipDuplicates: true,
    });

    // Return updated labels
    const updatedLabels = await prisma.addressLabel.findMany({
      where: { addressId },
      include: { label: true },
    });

    res.json(updatedLabels.map(al => al.label));
  } catch (error) {
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

    if (!Array.isArray(labelIds)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'labelIds array is required',
      });
    }

    // Find address first
    const address = await prisma.address.findUnique({
      where: { id: addressId },
      select: { id: true, walletId: true },
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(address.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(address.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Address not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Verify all labels belong to the same wallet
    if (labelIds.length > 0) {
      const labels = await prisma.label.findMany({
        where: {
          id: { in: labelIds },
          walletId: address.walletId,
        },
      });

      if (labels.length !== labelIds.length) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'One or more labels not found or belong to a different wallet',
        });
      }
    }

    // Replace all labels in a transaction
    await prisma.$transaction([
      prisma.addressLabel.deleteMany({
        where: { addressId },
      }),
      prisma.addressLabel.createMany({
        data: labelIds.map(labelId => ({
          addressId,
          labelId,
        })),
      }),
    ]);

    // Return updated labels
    const updatedLabels = await prisma.addressLabel.findMany({
      where: { addressId },
      include: { label: true },
    });

    res.json(updatedLabels.map(al => al.label));
  } catch (error) {
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

    // Find address first
    const address = await prisma.address.findUnique({
      where: { id: addressId },
      select: { id: true, walletId: true },
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    // Check edit access (owner or signer only)
    const canEdit = await checkWalletEditAccess(address.walletId, userId);
    if (!canEdit) {
      const hasAccess = await checkWalletAccess(address.walletId, userId);
      if (!hasAccess) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Address not found',
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this wallet',
      });
    }

    // Delete the association
    await prisma.addressLabel.deleteMany({
      where: {
        addressId,
        labelId,
      },
    });

    res.status(204).send();
  } catch (error) {
    log.error('Remove address label error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove label from address',
    });
  }
});

export default router;
