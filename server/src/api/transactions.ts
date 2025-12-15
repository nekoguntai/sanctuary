/**
 * Transaction API Routes
 *
 * API endpoints for transaction and UTXO management
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, signer, viewer)
 * - WRITE (POST): Only owner or signer roles can create/broadcast transactions
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import prisma from '../models/prisma';
import * as addressDerivation from '../services/bitcoin/addressDerivation';
import { auditService, AuditCategory, AuditAction } from '../services/auditService';
import { validateAddress } from '../services/bitcoin/utils';
import { checkWalletAccess, checkWalletEditAccess } from '../services/wallet';
import { createLogger } from '../utils/logger';

const log = createLogger('TRANSACTIONS');

const INITIAL_ADDRESS_COUNT = 20;

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/wallets/:walletId/transactions
 * Get all transactions for a wallet
 */
router.get('/wallets/:walletId/transactions', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { limit = '50', offset = '0' } = req.query;

    const transactions = await prisma.transaction.findMany({
      where: { walletId },
      include: {
        address: {
          select: {
            address: true,
            derivationPath: true,
          },
        },
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { blockTime: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    // Convert BigInt amounts to numbers for JSON serialization
    const serializedTransactions = transactions.map(tx => ({
      ...tx,
      amount: Number(tx.amount),
      fee: tx.fee ? Number(tx.fee) : null,
      blockHeight: tx.blockHeight ? Number(tx.blockHeight) : null,
      labels: tx.transactionLabels.map(tl => tl.label),
      transactionLabels: undefined, // Remove the raw join data
    }));

    res.json(serializedTransactions);
  } catch (error) {
    log.error('Get transactions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch transactions',
    });
  }
});

/**
 * GET /api/v1/transactions/:txid
 * Get a specific transaction by txid
 */
router.get('/transactions/:txid', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { txid } = req.params;

    const transaction = await prisma.transaction.findFirst({
      where: {
        txid,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
      include: {
        wallet: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        address: true,
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

    // Convert BigInt amounts to numbers for JSON serialization
    const serializedTransaction = {
      ...transaction,
      amount: Number(transaction.amount),
      fee: transaction.fee ? Number(transaction.fee) : null,
      blockHeight: transaction.blockHeight ? Number(transaction.blockHeight) : null,
      labels: transaction.transactionLabels.map(tl => tl.label),
      transactionLabels: undefined, // Remove the raw join data
    };

    res.json(serializedTransaction);
  } catch (error) {
    log.error('Get transaction error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch transaction',
    });
  }
});

/**
 * GET /api/v1/wallets/:walletId/utxos
 * Get all unspent UTXOs for a wallet
 */
router.get('/wallets/:walletId/utxos', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    const utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
      },
      orderBy: { amount: 'desc' },
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
      return {
        ...utxo,
        amount: Number(utxo.amount),
        blockHeight: utxo.blockHeight ? Number(utxo.blockHeight) : null,
        // Use blockTime from transaction if available, otherwise fall back to createdAt
        createdAt: blockTime ? blockTime.toISOString() : utxo.createdAt.toISOString(),
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
 * GET /api/v1/wallets/:walletId/addresses
 * Get all addresses for a wallet
 * Auto-generates addresses if wallet has descriptor but no addresses
 */
router.get('/wallets/:walletId/addresses', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { used } = req.query;

    // Get wallet for descriptor
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { descriptor: true, network: true },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Check if addresses exist
    let addresses = await prisma.address.findMany({
      where: {
        walletId,
        ...(used !== undefined && { used: used === 'true' }),
      },
      include: {
        addressLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { index: 'asc' },
    });

    // Auto-generate addresses if none exist and wallet has a descriptor
    if (addresses.length === 0 && wallet.descriptor && used === undefined) {
      try {
        const addressesToCreate = [];

        // Generate receive addresses (change = 0)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
            wallet.descriptor,
            i,
            {
              network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
              change: false, // External/receive addresses
            }
          );
          addressesToCreate.push({
            walletId,
            address,
            derivationPath,
            index: i,
            used: false,
          });
        }

        // Generate change addresses (change = 1)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
            wallet.descriptor,
            i,
            {
              network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
              change: true, // Internal/change addresses
            }
          );
          addressesToCreate.push({
            walletId,
            address,
            derivationPath,
            index: i,
            used: false,
          });
        }

        // Bulk insert addresses
        await prisma.address.createMany({
          data: addressesToCreate,
        });

        // Re-fetch the created addresses
        addresses = await prisma.address.findMany({
          where: { walletId },
          include: {
            addressLabels: {
              include: {
                label: true,
              },
            },
          },
          orderBy: { index: 'asc' },
        });
      } catch (err) {
        log.error('Failed to auto-generate addresses', { error: err });
        // Return empty array if generation fails
      }
    }

    // Get balances for each address from UTXOs
    const utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
      },
      select: {
        address: true,
        amount: true,
      },
    });

    // Sum balances by address
    const addressBalances = new Map<string, number>();
    for (const utxo of utxos) {
      const current = addressBalances.get(utxo.address) || 0;
      addressBalances.set(utxo.address, current + Number(utxo.amount));
    }

    // Add balance and labels to each address
    const addressesWithBalance = addresses.map(addr => ({
      ...addr,
      balance: addressBalances.get(addr.address) || 0,
      labels: addr.addressLabels.map(al => al.label),
      addressLabels: undefined, // Remove the raw join data
    }));

    res.json(addressesWithBalance);
  } catch (error) {
    log.error('Get addresses error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch addresses',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/addresses/generate
 * Generate more addresses for a wallet (requires edit access: owner or signer)
 */
router.post('/wallets/:walletId/addresses/generate', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { count = 10 } = req.body;

    // Fetch wallet data
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    if (!wallet.descriptor) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Wallet does not have a descriptor',
      });
    }

    // Get current max index for receive and change addresses
    const existingAddresses = await prisma.address.findMany({
      where: { walletId },
      select: { derivationPath: true, index: true },
    });

    // Parse existing addresses to find max indices
    let maxReceiveIndex = -1;
    let maxChangeIndex = -1;

    for (const addr of existingAddresses) {
      const parts = addr.derivationPath.split('/');
      if (parts.length >= 2) {
        const changeIndicator = parts[parts.length - 2];
        const index = parseInt(parts[parts.length - 1], 10);
        if (changeIndicator === '0' && index > maxReceiveIndex) {
          maxReceiveIndex = index;
        } else if (changeIndicator === '1' && index > maxChangeIndex) {
          maxChangeIndex = index;
        }
      }
    }

    const addressesToCreate = [];

    // Generate more receive addresses
    for (let i = maxReceiveIndex + 1; i < maxReceiveIndex + 1 + count; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: false,
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, { error: err });
      }
    }

    // Generate more change addresses
    for (let i = maxChangeIndex + 1; i < maxChangeIndex + 1 + count; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: true,
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, { error: err });
      }
    }

    // Bulk insert addresses (skip duplicates)
    if (addressesToCreate.length > 0) {
      await prisma.address.createMany({
        data: addressesToCreate,
        skipDuplicates: true,
      });
    }

    res.json({
      generated: addressesToCreate.length,
      receiveAddresses: count,
      changeAddresses: count,
    });
  } catch (error) {
    log.error('Generate addresses error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate addresses',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/transactions/create
 * Create a new transaction PSBT (returns PSBT for hardware wallet signing)
 */
router.post('/wallets/:walletId/transactions/create', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      recipient,
      amount,
      feeRate,
      selectedUtxoIds,
      enableRBF = true,
      label,
      memo,
      sendMax = false,
      subtractFees = false,
    } = req.body;

    // Basic validation
    if (!recipient || !amount) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipient and amount are required',
      });
    }

    if (!feeRate || feeRate < 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'feeRate must be at least 1 sat/vB',
      });
    }

    // Fetch wallet data
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Validate Bitcoin address for the wallet's network
    const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';
    const addressValidation = validateAddress(recipient, network);
    if (!addressValidation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid Bitcoin address: ${addressValidation.error}`,
      });
    }

    // Create transaction
    const txService = await import('../services/bitcoin/transactionService');
    const txData = await txService.createTransaction(
      walletId,
      recipient,
      amount,
      feeRate,
      {
        selectedUtxoIds,
        enableRBF,
        label,
        memo,
        sendMax,
        subtractFees,
      }
    );

    res.json({
      psbtBase64: txData.psbtBase64,
      fee: txData.fee,
      totalInput: txData.totalInput,
      totalOutput: txData.totalOutput,
      changeAmount: txData.changeAmount,
      changeAddress: txData.changeAddress,
      utxos: txData.utxos,
      inputPaths: txData.inputPaths, // Derivation paths for hardware wallet signing
      effectiveAmount: txData.effectiveAmount, // The actual amount being sent
    });
  } catch (error: any) {
    log.error('Create transaction error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create transaction',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/transactions/broadcast
 * Broadcast a signed PSBT
 */
router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      signedPsbtBase64,
      recipient,
      amount,
      fee,
      label,
      memo,
      utxos,
    } = req.body;

    // Validation
    if (!signedPsbtBase64) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'signedPsbtBase64 is required',
      });
    }

    // Broadcast transaction
    const txService = await import('../services/bitcoin/transactionService');
    const result = await txService.broadcastAndSave(walletId, signedPsbtBase64, {
      recipient,
      amount,
      fee,
      label,
      memo,
      utxos,
    });

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
  } catch (error: any) {
    log.error('Broadcast transaction error', { error });

    // Audit log failed broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: error.message,
      details: {
        walletId: req.walletId,
        recipient: req.body?.recipient,
        amount: req.body?.amount,
      },
    });

    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to broadcast transaction',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/psbt/create
 * Create a PSBT for hardware wallet signing
 * This is the preferred endpoint for hardware wallet integrations
 */
router.post('/wallets/:walletId/psbt/create', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      recipients, // Array of { address, amount }
      feeRate,
      utxoIds, // Optional: specific UTXOs to use
      changeAddress, // Optional: custom change address
    } = req.body;

    // Validation
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipients array is required',
      });
    }

    if (!feeRate || feeRate < 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'feeRate must be at least 1 sat/vB',
      });
    }

    // Validate recipients
    for (const recipient of recipients) {
      if (!recipient.address || !recipient.amount) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Each recipient must have address and amount',
        });
      }
    }

    // For now, only support single recipient (can be extended later)
    const { address, amount } = recipients[0];

    // Create PSBT
    const txService = await import('../services/bitcoin/transactionService');
    const txData = await txService.createTransaction(
      walletId,
      address,
      amount,
      feeRate,
      {
        selectedUtxoIds: utxoIds,
        enableRBF: true,
      }
    );

    res.json({
      psbt: txData.psbtBase64,
      fee: txData.fee,
      inputPaths: txData.inputPaths,
      totalInput: txData.totalInput,
      totalOutput: txData.totalOutput,
      changeAmount: txData.changeAmount,
      changeAddress: txData.changeAddress,
      utxos: txData.utxos,
    });
  } catch (error: any) {
    log.error('Create PSBT error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create PSBT',
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
    const txService = await import('../services/bitcoin/transactionService');
    const psbtInfo = txService.getPSBTInfo(signedPsbt);

    // Calculate amount from outputs (exclude change)
    // For simplicity, assume last output is change if there are 2+ outputs
    const outputs = psbtInfo.outputs;
    const recipientOutput = outputs[0];
    const amount = recipientOutput?.value || 0;

    // Broadcast transaction
    const result = await txService.broadcastAndSave(walletId, signedPsbt, {
      recipient: recipientOutput?.address || '',
      amount,
      fee: psbtInfo.fee,
      label,
      memo,
      utxos: psbtInfo.inputs.map(i => ({ txid: i.txid, vout: i.vout })),
    });

    // Audit log successful broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: {
        walletId,
        txid: result.txid,
        recipient: recipientOutput?.address,
        amount,
        fee: psbtInfo.fee,
      },
    });

    res.json({
      txid: result.txid,
      broadcasted: result.broadcasted,
    });
  } catch (error: any) {
    log.error('PSBT broadcast error', { error });

    // Audit log failed broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: error.message,
      details: {
        walletId: req.walletId,
      },
    });

    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to broadcast transaction',
    });
  }
});

/**
 * PATCH /api/v1/utxos/:utxoId/freeze
 * Toggle the frozen status of a UTXO
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

/**
 * POST /api/v1/wallets/:walletId/transactions/estimate
 * Estimate transaction cost before creating
 */
router.post('/wallets/:walletId/transactions/estimate', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { recipient, amount, feeRate, selectedUtxoIds } = req.body;

    // Validation
    if (!recipient || !amount || !feeRate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipient, amount, and feeRate are required',
      });
    }

    // Estimate transaction
    const txService = await import('../services/bitcoin/transactionService');
    const estimate = await txService.estimateTransaction(
      walletId,
      recipient,
      amount,
      feeRate,
      selectedUtxoIds
    );

    res.json(estimate);
  } catch (error: any) {
    log.error('Estimate transaction error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to estimate transaction',
    });
  }
});

export default router;
