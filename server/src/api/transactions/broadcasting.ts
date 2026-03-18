/**
 * Transactions - Broadcasting Router
 *
 * Endpoints for broadcasting signed transactions and PSBTs.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditCategory, AuditAction } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';

const router = Router();
const log = createLogger('TX:BROADCAST');

/**
 * POST /api/v1/wallets/:walletId/transactions/broadcast
 * Broadcast a signed PSBT or raw transaction hex
 * Supports two signing workflows:
 * - signedPsbtBase64: Signed PSBT from Ledger or file upload
 * - rawTxHex: Raw transaction hex from Trezor (fully signed)
 */
router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      signedPsbtBase64,
      rawTxHex, // For Trezor: fully signed transaction hex
      recipient,
      amount,
      fee,
      label,
      memo,
      utxos,
    } = req.body;

    // Validation - require either signedPsbtBase64 or rawTxHex
    if (!signedPsbtBase64 && !rawTxHex) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Either signedPsbtBase64 or rawTxHex is required',
      });
    }

    // Re-evaluate policies before broadcast (guard against drift).
    // Extract from PSBT when available; fall back to client-supplied fields.
    const txService = await import('../../services/bitcoin/transactionService');
    let evalRecipient = recipient;
    let evalAmount = amount;

    if (signedPsbtBase64 && (!evalRecipient || !evalAmount)) {
      try {
        const psbtInfo = txService.getPSBTInfo(signedPsbtBase64);
        const firstOutput = psbtInfo.outputs[0];
        if (firstOutput) {
          evalRecipient = evalRecipient || firstOutput.address;
          evalAmount = evalAmount || firstOutput.value;
        }
      } catch (parseErr) {
        log.debug('Could not parse PSBT for policy eval', { error: getErrorMessage(parseErr) });
      }
    }

    if (evalRecipient && evalAmount) {
      const policyResult = await policyEvaluationEngine.evaluatePolicies({
        walletId,
        userId: req.user!.userId,
        recipient: evalRecipient,
        amount: BigInt(evalAmount),
      });

      if (!policyResult.allowed) {
        log.warn('Broadcast blocked by policy', {
          walletId,
          triggered: policyResult.triggered.map(t => t.policyName),
        });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Transaction blocked by vault policy',
          policyEvaluation: policyResult,
        });
      }
    }

    // Broadcast transaction
    const result = await txService.broadcastAndSave(walletId, signedPsbtBase64, {
      recipient,
      amount,
      fee,
      label,
      memo,
      utxos,
      rawTxHex, // Pass raw tx for Trezor
    });

    // Record policy usage after successful broadcast
    const recordAmount = evalAmount || amount;
    if (recordAmount) {
      policyEvaluationEngine.recordUsage(walletId, req.user!.userId, BigInt(recordAmount)).catch(err => {
        log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
      });
    }

    // Audit log successful broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: {
        walletId,
        txid: result.txid,
        recipient,
        amount,
        fee,
      },
    });

    res.json(result);
  } catch (error) {
    log.error('Broadcast transaction error', { error });

    // Audit log failed broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: getErrorMessage(error),
      details: {
        walletId: req.walletId,
        recipient: req.body?.recipient,
        amount: req.body?.amount,
      },
    });

    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to broadcast transaction'),
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/psbt/broadcast
 * Broadcast a signed PSBT
 */
router.post('/wallets/:walletId/psbt/broadcast', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { signedPsbt, label, memo } = req.body;

    // Validation
    if (!signedPsbt) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'signedPsbt is required',
      });
    }

    // Parse PSBT to get transaction details
    const txService = await import('../../services/bitcoin/transactionService');
    const psbtInfo = txService.getPSBTInfo(signedPsbt);

    // Calculate amount from outputs (exclude change)
    // For simplicity, assume last output is change if there are 2+ outputs
    const outputs = psbtInfo.outputs;
    const recipientOutput = outputs[0];
    const amount = recipientOutput?.value || 0;
    const recipientAddress = recipientOutput?.address || '';

    // Evaluate policies using data extracted from the PSBT itself (not client metadata)
    if (recipientAddress && amount > 0) {
      const policyResult = await policyEvaluationEngine.evaluatePolicies({
        walletId,
        userId: req.user!.userId,
        recipient: recipientAddress,
        amount: BigInt(amount),
      });

      if (!policyResult.allowed) {
        log.warn('PSBT broadcast blocked by policy', {
          walletId,
          triggered: policyResult.triggered.map(t => t.policyName),
        });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Transaction blocked by vault policy',
          policyEvaluation: policyResult,
        });
      }
    }

    // Broadcast transaction
    const result = await txService.broadcastAndSave(walletId, signedPsbt, {
      recipient: recipientAddress,
      amount,
      fee: psbtInfo.fee,
      label,
      memo,
      utxos: psbtInfo.inputs.map(i => ({ txid: i.txid, vout: i.vout })),
    });

    // Record policy usage after successful broadcast
    if (amount > 0) {
      policyEvaluationEngine.recordUsage(walletId, req.user!.userId, BigInt(amount)).catch(err => {
        log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
      });
    }

    // Audit log successful broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: {
        walletId,
        txid: result.txid,
        recipient: recipientAddress,
        amount,
        fee: psbtInfo.fee,
      },
    });

    res.json({
      txid: result.txid,
      broadcasted: result.broadcasted,
    });
  } catch (error) {
    log.error('PSBT broadcast error', { error });

    // Audit log failed broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: getErrorMessage(error),
      details: {
        walletId: req.walletId,
      },
    });

    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to broadcast transaction'),
    });
  }
});

export default router;
