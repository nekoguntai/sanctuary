/**
 * Bitcoin - Fees Router
 *
 * Fee estimation endpoints
 */

import { Router, Request, Response } from 'express';
import * as blockchain from '../../services/bitcoin/blockchain';
import * as utils from '../../services/bitcoin/utils';
import * as mempool from '../../services/bitcoin/mempool';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('BITCOIN:FEES');

/**
 * GET /api/v1/bitcoin/fees
 * Get current fee estimates from configured source (mempool.space API or Electrum)
 */
router.get('/fees', async (req: Request, res: Response) => {
  try {
    // Check configured fee estimator source
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    const useMempoolApi = nodeConfig?.feeEstimatorUrl !== '' && nodeConfig?.feeEstimatorUrl !== undefined;

    if (useMempoolApi) {
      // Use mempool.space API (or configured URL)
      try {
        const mempoolFees = await mempool.getRecommendedFees();
        res.json({
          fastest: mempoolFees.fastestFee,
          halfHour: mempoolFees.halfHourFee,
          hour: mempoolFees.hourFee,
          economy: mempoolFees.economyFee,
          minimum: mempoolFees.minimumFee,
          source: 'mempool',
        });
        return;
      } catch (mempoolError) {
        log.warn('Mempool API fee fetch failed, falling back to Electrum', { error: String(mempoolError) });
      }
    }

    // Use Electrum server estimates
    const fees = await blockchain.getFeeEstimates();
    res.json({
      ...fees,
      minimum: fees.economy || 1,
      source: 'electrum',
    });
  } catch (error) {
    log.error('Get fees error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch fee estimates',
    });
  }
});

/**
 * GET /api/v1/bitcoin/fees/advanced
 * Get advanced fee estimates with time predictions
 */
router.get('/fees/advanced', async (req: Request, res: Response) => {
  try {
    const advancedTx = await import('../../services/bitcoin/advancedTx');
    const fees = await advancedTx.getAdvancedFeeEstimates();

    res.json(fees);
  } catch (error) {
    log.error('Get advanced fees error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch advanced fee estimates',
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
    log.error('Estimate fee error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to estimate fee',
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

    const advancedTx = await import('../../services/bitcoin/advancedTx');
    const result = await advancedTx.estimateOptimalFee(
      inputCount,
      outputCount,
      priority,
      scriptType
    );

    res.json(result);
  } catch (error) {
    log.error('Optimal fee estimation error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to estimate optimal fee',
    });
  }
});

export default router;
