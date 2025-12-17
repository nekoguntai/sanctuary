/**
 * Bitcoin API Routes
 *
 * API endpoints for Bitcoin network operations
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import * as blockchain from '../services/bitcoin/blockchain';
import * as utils from '../services/bitcoin/utils';
import { getElectrumClient } from '../services/bitcoin/electrum';
import * as mempool from '../services/bitcoin/mempool';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const router = Router();
const log = createLogger('BITCOIN');

/**
 * GET /api/v1/bitcoin/status
 * Get Bitcoin network status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const client = getElectrumClient();

    if (!client.isConnected()) {
      await client.connect();
    }

    const [version, blockHeight] = await Promise.all([
      client.getServerVersion(),
      blockchain.getBlockHeight(),
    ]);

    // Get the node config to include host info
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    // Get confirmation threshold setting
    const thresholdSetting = await prisma.systemSetting.findUnique({
      where: { key: 'confirmationThreshold' },
    });
    const confirmationThreshold = thresholdSetting
      ? JSON.parse(thresholdSetting.value)
      : 3; // Default to 3

    res.json({
      connected: true,
      server: version.server,
      protocol: version.protocol,
      blockHeight,
      network: 'mainnet',
      host: nodeConfig ? `${nodeConfig.host}:${nodeConfig.port}` : undefined,
      useSsl: nodeConfig?.useSsl,
      explorerUrl: nodeConfig?.explorerUrl || 'https://mempool.space',
      confirmationThreshold,
    });
  } catch (error: any) {
    res.json({
      connected: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/bitcoin/fees
 * Get current fee estimates (uses mempool.space for accuracy, falls back to Electrum)
 */
router.get('/fees', async (req: Request, res: Response) => {
  try {
    // Try mempool.space first for more accurate fee estimates
    try {
      const mempoolFees = await mempool.getRecommendedFees();
      res.json({
        fastest: mempoolFees.fastestFee,
        halfHour: mempoolFees.halfHourFee,
        hour: mempoolFees.hourFee,
        economy: mempoolFees.economyFee,
        minimum: mempoolFees.minimumFee,
      });
      return;
    } catch (mempoolError) {
      log.warn('[BITCOIN] Mempool.space fee fetch failed, falling back to Electrum', { error: String(mempoolError) });
    }

    // Fallback to Electrum estimates
    const fees = await blockchain.getFeeEstimates();
    res.json({
      ...fees,
      minimum: 1,
    });
  } catch (error) {
    log.error('[BITCOIN] Get fees error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch fee estimates',
    });
  }
});

/**
 * GET /api/v1/bitcoin/mempool
 * Get mempool and recent blocks data for visualization
 */
router.get('/mempool', async (req: Request, res: Response) => {
  try {
    const data = await mempool.getBlocksAndMempool();

    res.json(data);
  } catch (error) {
    log.error('[BITCOIN] Get mempool error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch mempool data',
    });
  }
});

/**
 * GET /api/v1/bitcoin/blocks/recent
 * Get recent confirmed blocks
 */
router.get('/blocks/recent', async (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 10;
    const blocks = await mempool.getRecentBlocks(count);

    res.json(blocks);
  } catch (error) {
    log.error('[BITCOIN] Get recent blocks error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch recent blocks',
    });
  }
});

/**
 * POST /api/v1/bitcoin/address/validate
 * Validate a Bitcoin address
 */
router.post('/address/validate', async (req: Request, res: Response) => {
  try {
    const { address, network = 'mainnet' } = req.body;

    if (!address) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'address is required',
      });
    }

    const result = await blockchain.checkAddress(address, network);

    res.json(result);
  } catch (error) {
    log.error('[BITCOIN] Validate address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate address',
    });
  }
});

/**
 * GET /api/v1/bitcoin/address/:address
 * Get address information from blockchain
 */
router.get('/address/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { network = 'mainnet' } = req.query;

    const result = await blockchain.checkAddress(address, network as any);

    if (!result.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.error || 'Invalid address',
      });
    }

    res.json({
      address,
      balance: result.balance || 0,
      transactionCount: result.transactionCount || 0,
      type: utils.getAddressType(address),
    });
  } catch (error) {
    log.error('[BITCOIN] Get address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch address info',
    });
  }
});

/**
 * POST /api/v1/bitcoin/wallet/:walletId/sync
 * Sync wallet with blockchain
 */
router.post('/wallet/:walletId/sync', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const result = await blockchain.syncWallet(walletId);

    res.json({
      message: 'Wallet synced successfully',
      ...result,
    });
  } catch (error) {
    log.error('[BITCOIN] Sync wallet error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync wallet',
    });
  }
});

/**
 * POST /api/v1/bitcoin/address/:addressId/sync
 * Sync single address with blockchain
 */
router.post('/address/:addressId/sync', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId } = req.params;

    // Check user has access to address's wallet
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
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    const result = await blockchain.syncAddress(addressId);

    res.json({
      message: 'Address synced successfully',
      ...result,
    });
  } catch (error) {
    log.error('[BITCOIN] Sync address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync address',
    });
  }
});

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
    log.error('[BITCOIN] Get transaction error', { error: String(error) });
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
  } catch (error: any) {
    log.error('[BITCOIN] Broadcast error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to broadcast transaction',
    });
  }
});

/**
 * POST /api/v1/bitcoin/wallet/:walletId/update-confirmations
 * Update transaction confirmations for a wallet
 */
router.post('/wallet/:walletId/update-confirmations', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { walletId } = req.params;

    // Check user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const updated = await blockchain.updateTransactionConfirmations(walletId);

    res.json({
      message: 'Confirmations updated',
      updated,
    });
  } catch (error) {
    log.error('[BITCOIN] Update confirmations error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update confirmations',
    });
  }
});

/**
 * GET /api/v1/bitcoin/block/:height
 * Get block information
 */
router.get('/block/:height', async (req: Request, res: Response) => {
  try {
    const height = parseInt(req.params.height);

    if (isNaN(height) || height < 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid block height',
      });
    }

    const client = getElectrumClient();

    if (!client.isConnected()) {
      await client.connect();
    }

    const header = await client.getBlockHeader(height);

    res.json(header);
  } catch (error) {
    log.error('[BITCOIN] Get block error', { error: String(error) });
    res.status(404).json({
      error: 'Not Found',
      message: 'Block not found',
    });
  }
});

/**
 * POST /api/v1/bitcoin/utils/estimate-fee
 * Estimate transaction fee
 */
router.post('/utils/estimate-fee', async (req: Request, res: Response) => {
  try {
    const {
      inputCount,
      outputCount,
      scriptType = 'native_segwit',
      feeRate,
    } = req.body;

    if (!inputCount || !outputCount || !feeRate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'inputCount, outputCount, and feeRate are required',
      });
    }

    const size = utils.estimateTransactionSize(inputCount, outputCount, scriptType);
    const fee = utils.calculateFee(size, feeRate);

    res.json({
      size,
      fee,
      feeRate,
    });
  } catch (error) {
    log.error('[BITCOIN] Estimate fee error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to estimate fee',
    });
  }
});

/**
 * GET /api/v1/bitcoin/fees/advanced
 * Get advanced fee estimates with time predictions
 */
router.get('/fees/advanced', async (req: Request, res: Response) => {
  try {
    const advancedTx = await import('../services/bitcoin/advancedTx');
    const fees = await advancedTx.getAdvancedFeeEstimates();

    res.json(fees);
  } catch (error) {
    log.error('[BITCOIN] Get advanced fees error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch advanced fee estimates',
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
    const advancedTx = await import('../services/bitcoin/advancedTx');

    const result = await advancedTx.canReplaceTransaction(txid);

    res.json(result);
  } catch (error) {
    log.error('[BITCOIN] RBF check error', { error: String(error) });
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

    const advancedTx = await import('../services/bitcoin/advancedTx');
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
    });
  } catch (error: any) {
    log.error('[BITCOIN] RBF creation error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create RBF transaction',
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

    const advancedTx = await import('../services/bitcoin/advancedTx');
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
  } catch (error: any) {
    log.error('[BITCOIN] CPFP creation error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create CPFP transaction',
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

    const advancedTx = await import('../services/bitcoin/advancedTx');
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
  } catch (error: any) {
    log.error('[BITCOIN] Batch transaction error', { error: String(error) });
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create batch transaction',
    });
  }
});

/**
 * POST /api/v1/bitcoin/utils/estimate-optimal-fee
 * Estimate optimal fee for a transaction based on priority
 */
router.post('/utils/estimate-optimal-fee', async (req: Request, res: Response) => {
  try {
    const {
      inputCount,
      outputCount,
      priority = 'medium',
      scriptType = 'native_segwit',
    } = req.body;

    if (!inputCount || !outputCount) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'inputCount and outputCount are required',
      });
    }

    const advancedTx = await import('../services/bitcoin/advancedTx');
    const result = await advancedTx.estimateOptimalFee(
      inputCount,
      outputCount,
      priority,
      scriptType
    );

    res.json(result);
  } catch (error) {
    log.error('[BITCOIN] Optimal fee estimation error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to estimate optimal fee',
    });
  }
});

export default router;
