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
import { getBlockHeight, recalculateWalletBalances } from '../services/bitcoin/blockchain';
import { createLogger } from '../utils/logger';
import { handleApiError, validatePagination, bigIntToNumber, bigIntToNumberOrZero } from '../utils/errors';
import { INITIAL_ADDRESS_COUNT, MIN_FEE_RATE } from '../constants';

const log = createLogger('TRANSACTIONS');

/**
 * Calculate confirmations dynamically from block height
 */
function calculateConfirmations(txBlockHeight: number | null, currentBlockHeight: number): number {
  if (!txBlockHeight || txBlockHeight <= 0) return 0;
  return Math.max(0, currentBlockHeight - txBlockHeight + 1);
}

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
    const { limit, offset } = validatePagination(
      req.query.limit as string,
      req.query.offset as string
    );

    // Get current block height for confirmation calculation
    const currentBlockHeight = await getBlockHeight();

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
      take: limit,
      skip: offset,
    });

    // Convert BigInt amounts to numbers and calculate confirmations dynamically
    // The amounts in the database are already correctly signed:
    // - sent: negative (amount + fee already deducted during sync)
    // - consolidation: negative fee only (only fee lost)
    // - received: positive (what you received)
    const serializedTransactions = transactions.map(tx => {
      const blockHeight = bigIntToNumber(tx.blockHeight);
      const rawAmount = bigIntToNumberOrZero(tx.amount);

      // The amount is already correctly signed in the database
      // Don't re-apply signing logic to avoid double-counting fees

      return {
        ...tx,
        amount: rawAmount,
        fee: bigIntToNumber(tx.fee),
        balanceAfter: bigIntToNumber(tx.balanceAfter),
        blockHeight,
        confirmations: calculateConfirmations(blockHeight, currentBlockHeight),
        labels: tx.transactionLabels.map(tl => tl.label),
        transactionLabels: undefined, // Remove the raw join data
      };
    });

    res.json(serializedTransactions);
  } catch (error: unknown) {
    handleApiError(error, res, 'Get transactions');
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/stats
 * Get transaction summary statistics for a wallet
 * Returns counts and totals independent of pagination
 */
router.get('/wallets/:walletId/transactions/stats', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get all transactions for this wallet
    const transactions = await prisma.transaction.findMany({
      where: { walletId },
      select: {
        type: true,
        amount: true,
        fee: true,
      },
    });

    // Calculate stats
    let totalCount = 0;
    let receivedCount = 0;
    let sentCount = 0;
    let consolidationCount = 0;
    let totalReceived = BigInt(0);
    let totalSent = BigInt(0);
    let totalFees = BigInt(0);

    for (const tx of transactions) {
      totalCount++;
      const amount = tx.amount || BigInt(0);
      const fee = tx.fee || BigInt(0);

      if (tx.type === 'received') {
        receivedCount++;
        totalReceived += amount > 0 ? amount : -amount;
      } else if (tx.type === 'sent') {
        sentCount++;
        // Amount is already negative in DB, so negate to get positive value
        totalSent += amount < 0 ? -amount : amount;
      } else if (tx.type === 'consolidation') {
        consolidationCount++;
        // Consolidation fee is the cost
        totalFees += fee;
      }

      // Add fees from sent transactions
      if (tx.type === 'sent' && fee > 0) {
        totalFees += fee;
      }
    }

    // Get wallet balance from most recent transaction's balanceAfter
    const lastTx = await prisma.transaction.findFirst({
      where: { walletId },
      orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });
    const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

    res.json({
      totalCount,
      receivedCount,
      sentCount,
      consolidationCount,
      totalReceived: Number(totalReceived),
      totalSent: Number(totalSent),
      totalFees: Number(totalFees),
      walletBalance: Number(walletBalance),
    });
  } catch (error: unknown) {
    handleApiError(error, res, 'Get transaction stats');
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/pending
 * Get pending (unconfirmed) transactions for a wallet
 * Returns data formatted for block queue visualization
 */
router.get('/wallets/:walletId/transactions/pending', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get wallet name for display
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true, network: true },
    });

    // Query unconfirmed transactions (confirmations === 0)
    const pendingTxs = await prisma.transaction.findMany({
      where: {
        walletId,
        confirmations: 0,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingTxs.length === 0) {
      return res.json([]);
    }

    // Fetch vsize from mempool.space for accurate fee rate calculation
    const mempoolBaseUrl = wallet?.network === 'testnet'
      ? 'https://mempool.space/testnet/api'
      : 'https://mempool.space/api';

    const pendingTransactions = await Promise.all(
      pendingTxs.map(async (tx) => {
        let fee = tx.fee ? Number(tx.fee) : 0;
        let vsize: number | undefined;
        let feeRate = 0;

        // Try to fetch vsize and fee from mempool.space
        try {
          const response = await fetch(`${mempoolBaseUrl}/tx/${tx.txid}`);
          if (response.ok) {
            const txData = await response.json() as { weight?: number; fee?: number };
            vsize = txData.weight ? Math.ceil(txData.weight / 4) : undefined;
            // Use fee from mempool.space if not in database
            if (fee === 0 && txData.fee) {
              fee = txData.fee;
            }
            if (vsize && fee > 0) {
              feeRate = Math.round((fee / vsize) * 10) / 10; // Round to 1 decimal
            }
          }
        } catch (err) {
          // Mempool fetch failed, use estimate if possible
          log.warn('Failed to fetch tx from mempool.space', { txid: tx.txid, error: err });
        }

        // Calculate time in queue
        const createdAt = tx.createdAt;
        const timeInQueue = Math.floor((Date.now() - createdAt.getTime()) / 1000);

        // Map 'consolidation' to 'sent' for display (consolidation is sending to yourself)
        const displayType: 'sent' | 'received' =
          tx.type === 'received' || tx.type === 'receive' ? 'received' : 'sent';

        // Sign amount based on type: negative for sent, positive for received
        const rawAmount = Math.abs(Number(tx.amount));
        const signedAmount = displayType === 'sent' ? -rawAmount : rawAmount;

        return {
          txid: tx.txid,
          walletId: tx.walletId,
          walletName: wallet?.name,
          type: displayType,
          amount: signedAmount,
          fee,
          feeRate,
          vsize,
          recipient: tx.counterpartyAddress || undefined,
          timeInQueue,
          createdAt: createdAt.toISOString(),
        };
      })
    );

    res.json(pendingTransactions);
  } catch (error) {
    log.error('Get pending transactions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch pending transactions',
    });
  }
});

/**
 * GET /api/v1/wallets/:walletId/transactions/export
 * Export transactions for a wallet in CSV or JSON format
 */
router.get('/wallets/:walletId/transactions/export', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { format = 'csv', startDate, endDate } = req.query;

    // Build date filter
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      // Set to end of day
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Get wallet name for filename
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true },
    });

    // Query all transactions (no pagination for export)
    const transactions = await prisma.transaction.findMany({
      where: {
        walletId,
        ...(Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
      },
      include: {
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { blockTime: 'asc' },  // Oldest first to match Sparrow format
    });

    // Convert to export format
    // The amount in DB is already correctly signed:
    // - sent: negative (includes fee)
    // - consolidation: negative (just the fee)
    // - received: positive
    const exportData = transactions.map(tx => {
      // Use the stored amount directly - it's already correctly signed
      const signedAmount = Number(tx.amount);

      return {
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: signedAmount / 100000000,
        amountSats: signedAmount,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        feeSats: tx.fee ? Number(tx.fee) : null,
        confirmations: tx.confirmations,
        label: tx.label || '',
        memo: tx.memo || '',
        counterpartyAddress: tx.counterpartyAddress || '',
        blockHeight: tx.blockHeight ? Number(tx.blockHeight) : null,
      };
    });

    const walletName = wallet?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.json"`);
      return res.json(exportData);
    }

    // Generate CSV
    const csvHeaders = [
      'Date',
      'Transaction ID',
      'Type',
      'Amount (BTC)',
      'Amount (sats)',
      'Balance After (BTC)',
      'Balance After (sats)',
      'Fee (sats)',
      'Confirmations',
      'Label',
      'Memo',
      'Counterparty Address',
      'Block Height',
    ];

    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = exportData.map(tx => [
      escapeCSV(tx.date),
      escapeCSV(tx.txid),
      escapeCSV(tx.type),
      escapeCSV(tx.amountBtc),
      escapeCSV(tx.amountSats),
      escapeCSV(tx.balanceAfterBtc),
      escapeCSV(tx.balanceAfterSats),
      escapeCSV(tx.feeSats),
      escapeCSV(tx.confirmations),
      escapeCSV(tx.label),
      escapeCSV(tx.memo),
      escapeCSV(tx.counterpartyAddress),
      escapeCSV(tx.blockHeight),
    ].join(','));

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.csv"`);
    res.send(csv);
  } catch (error) {
    log.error('Export transactions error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export transactions',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/transactions/recalculate
 * Recalculate running balances (balanceAfter) for all transactions in a wallet
 */
router.post('/wallets/:walletId/transactions/recalculate', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    await recalculateWalletBalances(walletId);

    // Get the final balance after recalculation
    const lastTx = await prisma.transaction.findFirst({
      where: { walletId },
      orderBy: [{ blockTime: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });

    res.json({
      success: true,
      message: 'Balances recalculated',
      finalBalance: lastTx?.balanceAfter ? Number(lastTx.balanceAfter) : 0,
      finalBalanceBtc: lastTx?.balanceAfter ? Number(lastTx.balanceAfter) / 100000000 : 0,
    });
  } catch (error) {
    log.error('Failed to recalculate balances', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to recalculate balances',
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

    // Get confirmation threshold setting
    const thresholdSetting = await prisma.systemSetting.findUnique({
      where: { key: 'confirmationThreshold' },
    });
    const confirmationThreshold = thresholdSetting
      ? JSON.parse(thresholdSetting.value)
      : 3; // Default to 3

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
        // Spendable if not frozen and has enough confirmations
        spendable: !utxo.frozen && utxo.confirmations >= confirmationThreshold,
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

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
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
 * POST /api/v1/wallets/:walletId/transactions/batch
 * Create a batch transaction with multiple outputs
 */
router.post('/wallets/:walletId/transactions/batch', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      outputs, // Array of { address, amount, sendMax? }
      feeRate,
      selectedUtxoIds,
      enableRBF = true,
      label,
      memo,
    } = req.body;

    // Validate outputs array
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'outputs array is required with at least one output',
      });
    }

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
      });
    }

    // Fetch wallet for network validation
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';

    // Validate each output
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (!output.address) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: address is required`,
        });
      }

      // Amount is required unless sendMax is true
      if (!output.sendMax && (!output.amount || output.amount <= 0)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: amount is required (or set sendMax: true)`,
        });
      }

      // Validate address
      const addressValidation = validateAddress(output.address, network);
      if (!addressValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: Invalid Bitcoin address: ${addressValidation.error}`,
        });
      }
    }

    // Only one output can have sendMax
    const sendMaxCount = outputs.filter((o: any) => o.sendMax).length;
    if (sendMaxCount > 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Only one output can have sendMax enabled',
      });
    }

    // Create batch transaction
    const txService = await import('../services/bitcoin/transactionService');
    const txData = await txService.createBatchTransaction(
      walletId,
      outputs,
      feeRate,
      {
        selectedUtxoIds,
        enableRBF,
        label,
        memo,
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
      inputPaths: txData.inputPaths,
      outputs: txData.outputs, // Final outputs with resolved amounts
    });
  } catch (error: any) {
    log.error('Create batch transaction error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create batch transaction',
    });
  }
});

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

    // Broadcast transaction
    const txService = await import('../services/bitcoin/transactionService');
    const result = await txService.broadcastAndSave(walletId, signedPsbtBase64, {
      recipient,
      amount,
      fee,
      label,
      memo,
      utxos,
      rawTxHex, // Pass raw tx for Trezor
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

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
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
