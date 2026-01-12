/**
 * Bitcoin - Transactions Router
 *
 * Transaction operations including broadcast, RBF, CPFP, and batch transactions
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('BITCOIN:TRANSACTIONS');

/**
 * GET /api/v1/bitcoin/transaction/:txid
 * Get transaction details from blockchain
 */
router.get('/transaction/:txid', async (req: Request, res: Response) => {
  try {
    const { txid } = req.params;

    const txDetails = await blockchain.getTransactionDetails(txid);

    res.json(txDetails);
  } catch (error) {
    log.error('Get transaction error', { error: String(error) });
    res.status(404).json({
      error: 'Not Found',
      message: 'Transaction not found',
    });
  }
});

/**
 * POST /api/v1/bitcoin/broadcast
 * Broadcast a raw transaction to the network
 */
router.post('/broadcast', authenticate, async (req: Request, res: Response) => {
  try {
    const { rawTx } = req.body;

    if (!rawTx) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'rawTx is required',
      });
    }

    const result = await blockchain.broadcastTransaction(rawTx);

    res.json(result);
  } catch (error) {
    log.error('Broadcast error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to broadcast transaction'),
    });
  }
});

/**
 * POST /api/v1/bitcoin/transaction/:txid/rbf-check
 * Check if a transaction can be replaced with RBF
 */
router.post('/transaction/:txid/rbf-check', authenticate, async (req: Request, res: Response) => {
  try {
    const { txid } = req.params;
    const advancedTx = await import('../../services/bitcoin/advancedTx');

    const result = await advancedTx.canReplaceTransaction(txid);

    res.json(result);
  } catch (error) {
    log.error('RBF check error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check RBF status',
    });
  }
});

/**
 * POST /api/v1/bitcoin/transaction/:txid/rbf
 * Create an RBF replacement transaction
 */
router.post('/transaction/:txid/rbf', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { txid } = req.params;
    const { newFeeRate, walletId } = req.body;

    if (!newFeeRate || !walletId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'newFeeRate and walletId are required',
      });
    }

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        users: {
          some: {
            userId,
            role: { in: ['owner', 'signer'] },
          },
        },
      },
    });

    if (!wallet) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions for this wallet',
      });
    }

    const advancedTx = await import('../../services/bitcoin/advancedTx');
    const result = await advancedTx.createRBFTransaction(
      txid,
      newFeeRate,
      walletId,
      'mainnet'
    );

    res.json({
      psbtBase64: result.psbt.toBase64(),
      fee: result.fee,
      feeRate: result.feeRate,
      feeDelta: result.feeDelta,
      inputs: result.inputs,
      outputs: result.outputs,
      inputPaths: result.inputPaths,
    });
  } catch (error) {
    log.error('RBF creation error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create RBF transaction'),
    });
  }
});

/**
 * POST /api/v1/bitcoin/transaction/cpfp
 * Create a CPFP transaction
 */
router.post('/transaction/cpfp', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      parentTxid,
      parentVout,
      targetFeeRate,
      recipientAddress,
      walletId,
    } = req.body;

    if (!parentTxid || parentVout === undefined || !targetFeeRate || !recipientAddress || !walletId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'parentTxid, parentVout, targetFeeRate, recipientAddress, and walletId are required',
      });
    }

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        users: {
          some: {
            userId,
            role: { in: ['owner', 'signer'] },
          },
        },
      },
    });

    if (!wallet) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions for this wallet',
      });
    }

    const advancedTx = await import('../../services/bitcoin/advancedTx');
    const result = await advancedTx.createCPFPTransaction(
      parentTxid,
      parentVout,
      targetFeeRate,
      recipientAddress,
      walletId,
      'mainnet'
    );

    res.json({
      psbtBase64: result.psbt.toBase64(),
      childFee: result.childFee,
      childFeeRate: result.childFeeRate,
      parentFeeRate: result.parentFeeRate,
      effectiveFeeRate: result.effectiveFeeRate,
    });
  } catch (error) {
    log.error('CPFP creation error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create CPFP transaction'),
    });
  }
});

/**
 * POST /api/v1/bitcoin/transaction/batch
 * Create a batch transaction
 */
router.post('/transaction/batch', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      recipients,
      feeRate,
      walletId,
      selectedUtxoIds,
    } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0 || !feeRate || !walletId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipients (array), feeRate, and walletId are required',
      });
    }

    // Validate recipients format
    for (const recipient of recipients) {
      if (!recipient.address || !recipient.amount) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Each recipient must have address and amount',
        });
      }
    }

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        users: {
          some: {
            userId,
            role: { in: ['owner', 'signer'] },
          },
        },
      },
    });

    if (!wallet) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions for this wallet',
      });
    }

    const advancedTx = await import('../../services/bitcoin/advancedTx');
    const result = await advancedTx.createBatchTransaction(
      recipients,
      feeRate,
      walletId,
      selectedUtxoIds,
      'mainnet'
    );

    res.json({
      psbtBase64: result.psbt.toBase64(),
      fee: result.fee,
      totalInput: result.totalInput,
      totalOutput: result.totalOutput,
      changeAmount: result.changeAmount,
      savedFees: result.savedFees,
      recipientCount: recipients.length,
    });
  } catch (error) {
    log.error('Batch transaction error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create batch transaction'),
    });
  }
});

export default router;
