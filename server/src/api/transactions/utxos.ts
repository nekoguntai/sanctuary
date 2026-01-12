/**
 * Transactions - UTXO Router
 *
 * Endpoints for listing and managing UTXOs
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { checkWalletEditAccess } from '../../services/wallet';
import { safeJsonParse, SystemSettingSchemas } from '../../utils/safeJson';

const router = Router();
const log = createLogger('TX:UTXOS');

/**
 * GET /api/v1/wallets/:walletId/utxos
 * Get all UTXOs for a wallet
 */
router.get('/wallets/:walletId/utxos', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get confirmation threshold setting
    const thresholdSetting = await prisma.systemSetting.findUnique({
      where: { key: 'confirmationThreshold' },
    });
    const confirmationThreshold = safeJsonParse(
      thresholdSetting?.value,
      SystemSettingSchemas.number,
      3, // Default to 3
      'confirmationThreshold'
    );

    const utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
      },
      orderBy: { amount: 'desc' },
      include: {
        draftLock: {
          include: {
            draft: {
              select: { id: true, label: true },
            },
          },
        },
      },
    });

    // Get associated transactions to find blockTime for each UTXO
    const txids = [...new Set(utxos.map(u => u.txid))];
    const transactions = await prisma.transaction.findMany({
      where: {
        txid: { in: txids },
        walletId,
      },
      select: {
        txid: true,
        blockTime: true,
      },
    });
    const txBlockTimes = new Map(transactions.map(t => [t.txid, t.blockTime]));

    // Convert BigInt amounts to numbers for JSON serialization
    // Use transaction blockTime for the UTXO date (when it was created on blockchain)
    const serializedUtxos = utxos.map(utxo => {
      const blockTime = txBlockTimes.get(utxo.txid);
      const isLockedByDraft = !!utxo.draftLock;
      return {
        ...utxo,
        amount: Number(utxo.amount),
        blockHeight: utxo.blockHeight ? Number(utxo.blockHeight) : null,
        // Spendable if not frozen, not locked by draft, and has enough confirmations
        spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
        // Use blockTime from transaction if available, otherwise fall back to createdAt
        createdAt: blockTime ? blockTime.toISOString() : utxo.createdAt.toISOString(),
        // Draft lock info (if locked)
        lockedByDraftId: utxo.draftLock?.draftId,
        lockedByDraftLabel: utxo.draftLock?.draft?.label,
        draftLock: undefined, // Remove the raw relation data
      };
    });

    // Calculate total balance
    const totalBalance = serializedUtxos.reduce((sum, utxo) => sum + utxo.amount, 0);

    res.json({
      utxos: serializedUtxos,
      count: serializedUtxos.length,
      totalBalance,
    });
  } catch (error) {
    log.error('Get UTXOs error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch UTXOs',
    });
  }
});

/**
 * PATCH /api/v1/utxos/:utxoId/freeze
 * Toggle the frozen status of a UTXO (requires edit access: owner or signer)
 */
router.patch('/utxos/:utxoId/freeze', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { utxoId } = req.params;
    const { frozen } = req.body;

    // Validate frozen parameter
    if (typeof frozen !== 'boolean') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'frozen must be a boolean',
      });
    }

    // Find the UTXO and verify user has access to the wallet
    const utxo = await prisma.uTXO.findFirst({
      where: {
        id: utxoId,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
      include: {
        wallet: {
          include: {
            users: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!utxo) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'UTXO not found',
      });
    }

    // Check if user has edit access (owner or signer)
    const canEdit = await checkWalletEditAccess(utxo.walletId, userId);
    if (!canEdit) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to modify UTXOs in this wallet',
      });
    }

    // Update the frozen status
    const updatedUtxo = await prisma.uTXO.update({
      where: { id: utxoId },
      data: { frozen },
    });

    res.json({
      id: updatedUtxo.id,
      txid: updatedUtxo.txid,
      vout: updatedUtxo.vout,
      frozen: updatedUtxo.frozen,
      message: frozen ? 'UTXO frozen successfully' : 'UTXO unfrozen successfully',
    });
  } catch (error) {
    log.error('Freeze UTXO error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update UTXO frozen status',
    });
  }
});

export default router;
