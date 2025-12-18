/**
 * Mempool.space Service
 *
 * Service for fetching Bitcoin network data from mempool.space API
 * Provides mempool stats, recent blocks, and enhanced fee estimates
 * Supports custom mempool.space instances via node configuration
 */

import axios from 'axios';
import config from '../../config';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const log = createLogger('MEMPOOL');

// Default mempool.space API (public instance)
const DEFAULT_MEMPOOL_API = 'https://mempool.space/api';

/**
 * Get the mempool API base URL from node config or use default
 * Priority: feeEstimatorUrl > explorerUrl > default mempool.space
 */
async function getMempoolApiBase(): Promise<string> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    // Use dedicated fee estimator URL if configured
    if (nodeConfig?.feeEstimatorUrl) {
      const feeUrl = nodeConfig.feeEstimatorUrl.replace(/\/$/, ''); // Remove trailing slash
      // If it already ends with /api, use as-is, otherwise append /api
      return feeUrl.endsWith('/api') ? feeUrl : `${feeUrl}/api`;
    }

    // Fall back to explorer URL if configured
    if (nodeConfig?.explorerUrl) {
      const explorerUrl = nodeConfig.explorerUrl.replace(/\/$/, ''); // Remove trailing slash
      return `${explorerUrl}/api`;
    }
  } catch (error) {
    log.warn('Could not fetch node config, using default', { error });
  }

  return DEFAULT_MEMPOOL_API;
}

interface MempoolBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string;
  medianFee: number;
  feeRange: number[];
  extras: {
    medianFee: number;
    feeRange: number[];
    reward: number;
    totalFees: number;
  };
}

interface MempoolInfo {
  count: number;
  vsize: number;
  total_fee: number;
  fee_histogram: number[][];
}

interface FeeEstimates {
  fastestFee: number;    // Next block
  halfHourFee: number;   // ~3 blocks
  hourFee: number;       // ~6 blocks
  economyFee: number;    // ~24 blocks
  minimumFee: number;    // Low priority
}

/**
 * Get recent blocks from mempool.space
 */
export async function getRecentBlocks(count: number = 10): Promise<MempoolBlock[]> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/v1/blocks`, {
      timeout: 10000,
    });

    // Return only the requested number of blocks
    return response.data.slice(0, count);
  } catch (error: any) {
    log.error('Failed to fetch recent blocks', { error: error.message });
    throw new Error('Failed to fetch recent blocks from mempool.space');
  }
}

/**
 * Get mempool information
 */
export async function getMempoolInfo(): Promise<MempoolInfo> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/mempool`, {
      timeout: 10000,
    });

    return response.data;
  } catch (error: any) {
    log.error('Failed to fetch mempool info', { error: error.message });
    throw new Error('Failed to fetch mempool info from mempool.space');
  }
}

/**
 * Get recommended fee estimates from mempool.space
 */
export async function getRecommendedFees(): Promise<FeeEstimates> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/v1/fees/recommended`, {
      timeout: 10000,
    });

    return {
      fastestFee: response.data.fastestFee,
      halfHourFee: response.data.halfHourFee,
      hourFee: response.data.hourFee,
      economyFee: response.data.economyFee,
      minimumFee: response.data.minimumFee,
    };
  } catch (error: any) {
    log.error('Failed to fetch fee estimates', { error: error.message });
    throw new Error('Failed to fetch fee estimates from mempool.space');
  }
}

/**
 * Get block by hash
 */
export async function getBlock(hash: string): Promise<MempoolBlock> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/block/${hash}`, {
      timeout: 10000,
    });

    return response.data;
  } catch (error: any) {
    log.error('Failed to fetch block', { error: error.message });
    throw new Error('Failed to fetch block from mempool.space');
  }
}

/**
 * Get block at specific height
 */
export async function getBlockAtHeight(height: number): Promise<string> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/block-height/${height}`, {
      timeout: 10000,
    });

    // Returns block hash
    return response.data;
  } catch (error: any) {
    log.error('Failed to fetch block at height', { error: error.message });
    throw new Error('Failed to fetch block at height from mempool.space');
  }
}

/**
 * Get current block height (tip)
 */
export async function getTipHeight(): Promise<number> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/blocks/tip/height`, {
      timeout: 10000,
    });

    return response.data;
  } catch (error: any) {
    log.error('Failed to fetch tip height', { error: error.message });
    throw new Error('Failed to fetch tip height from mempool.space');
  }
}

/**
 * Projected mempool block from mempool.space API
 */
interface ProjectedMempoolBlock {
  blockSize: number;
  blockVSize: number;
  nTx: number;
  totalFees: number;
  medianFee: number;
  feeRange: number[];
}

/**
 * Get projected mempool blocks from mempool.space API
 * This uses actual mempool sorting to show which transactions will be in each block
 */
export async function getProjectedMempoolBlocks(): Promise<ProjectedMempoolBlock[]> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/v1/fees/mempool-blocks`, {
      timeout: 10000,
    });

    return response.data;
  } catch (error: any) {
    log.error('Failed to fetch projected mempool blocks', { error: error.message });
    throw new Error('Failed to fetch projected mempool blocks from mempool.space');
  }
}

/**
 * Get the mempool estimator type from node config
 */
async function getMempoolEstimatorType(): Promise<'simple' | 'mempool_space'> {
  try {
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });
    return (nodeConfig?.mempoolEstimator as 'simple' | 'mempool_space') || 'mempool_space';
  } catch (error) {
    log.warn('Could not fetch mempool estimator config, using mempool_space', { error });
    return 'mempool_space';
  }
}

/**
 * Get blocks and mempool data for dashboard visualization
 * Returns recent confirmed blocks + projected mempool blocks
 *
 * Uses one of two algorithms based on mempoolEstimator config:
 * - 'simple': Fee bucket thresholds (faster, less accurate)
 * - 'mempool_space': Actual mempool sorting via API (more accurate)
 */
export async function getBlocksAndMempool() {
  try {
    const estimatorType = await getMempoolEstimatorType();

    const [blocks, mempoolInfo, fees] = await Promise.all([
      getRecentBlocks(7),
      getMempoolInfo(),
      getRecommendedFees(),
    ]);

    // Mempool size in MB
    const mempoolSizeMB = mempoolInfo.vsize / 1000000;

    let mempoolBlocks: Array<{
      height: string;
      medianFee: number;
      feeRange: string;
      size: number;
      time: string;
      status: 'pending';
      txCount: number;
      totalFees: number;
    }> = [];

    let queuedBlocksSummary: {
      blockCount: number;
      totalTransactions: number;
      averageFee: number;
      totalFees: number;
    } | null = null;

    if (estimatorType === 'mempool_space') {
      // Use mempool.space projected blocks API for accurate sorting
      try {
        const projectedBlocks = await getProjectedMempoolBlocks();

        // Convert projected blocks to our format (show up to 3)
        const blockLabels = ['Next', '+2', '+3'];
        const blockTimes = ['~10m', '~20m', '~30m'];

        // Helper to format fee rate - preserve decimals for low fees
        const formatFeeRate = (rate: number): string => {
          if (rate >= 1) return Math.round(rate).toString();
          if (rate >= 0.1) return rate.toFixed(1);
          return rate.toFixed(2);
        };

        mempoolBlocks = projectedBlocks.slice(0, 3).map((block, idx) => ({
          height: blockLabels[idx] || `+${idx + 1}`,
          medianFee: block.medianFee < 1 ? parseFloat(block.medianFee.toFixed(2)) : Math.round(block.medianFee),
          feeRange: block.feeRange.length >= 2
            ? `${formatFeeRate(block.feeRange[0])}-${formatFeeRate(block.feeRange[block.feeRange.length - 1])}`
            : formatFeeRate(block.medianFee),
          size: block.blockVSize / 1000000, // Convert to MB
          time: blockTimes[idx] || `~${(idx + 1) * 10}m`,
          status: 'pending' as const,
          txCount: block.nTx,
          totalFees: block.totalFees / 100000000, // Convert satoshis to BTC
        }));

        // Calculate summary for additional blocks beyond the 3 displayed
        if (projectedBlocks.length > 3) {
          const additionalBlocks = projectedBlocks.slice(3);
          const totalTxCount = additionalBlocks.reduce((sum, b) => sum + b.nTx, 0);
          const totalFees = additionalBlocks.reduce((sum, b) => sum + b.totalFees, 0);
          const avgFee = additionalBlocks.length > 0
            ? additionalBlocks.reduce((sum, b) => sum + b.medianFee, 0) / additionalBlocks.length
            : fees.economyFee;

          queuedBlocksSummary = {
            blockCount: additionalBlocks.length,
            totalTransactions: totalTxCount,
            averageFee: avgFee < 1 ? parseFloat(avgFee.toFixed(2)) : Math.round(avgFee),
            totalFees: totalFees / 100000000,
          };
        }

        log.debug('Using mempool.space projected blocks', {
          blocksCount: mempoolBlocks.length,
          additionalBlocks: queuedBlocksSummary?.blockCount || 0,
        });
      } catch (projectedError: any) {
        // Fall back to simple algorithm if projected blocks API fails
        log.warn('Projected blocks API failed, falling back to simple algorithm', {
          error: projectedError.message,
        });
        return getBlocksAndMempoolSimple(blocks, mempoolInfo, fees, mempoolSizeMB);
      }
    } else {
      // Use simple fee bucket algorithm
      return getBlocksAndMempoolSimple(blocks, mempoolInfo, fees, mempoolSizeMB);
    }

    // Format confirmed blocks
    const confirmedBlocks = blocks.slice(0, 4).map((block) => {
      const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
      return {
        height: block.height,
        medianFee: block.extras?.medianFee ?? block.medianFee ?? 50,
        feeRange: block.extras?.feeRange
          ? `${block.extras.feeRange[0]}-${block.extras.feeRange[block.extras.feeRange.length - 1]}`
          : '40-200',
        size: block.size / 1000000,
        time: age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`,
        status: 'confirmed' as const,
        txCount: block.tx_count,
        totalFees: block.extras?.totalFees ? block.extras.totalFees / 100000000 : undefined,
      };
    });

    return {
      mempool: mempoolBlocks.reverse(),
      blocks: confirmedBlocks,
      mempoolInfo: {
        count: mempoolInfo.count,
        size: mempoolSizeMB,
        totalFees: mempoolInfo.total_fee,
      },
      queuedBlocksSummary,
    };
  } catch (error: any) {
    log.error('Failed to fetch blocks and mempool', { error: error.message });
    throw error;
  }
}

/**
 * Simple fee bucket algorithm for mempool block estimation
 * Used as fallback or when 'simple' estimator is configured
 */
function getBlocksAndMempoolSimple(
  blocks: MempoolBlock[],
  mempoolInfo: MempoolInfo,
  fees: FeeEstimates,
  mempoolSizeMB: number
) {
  const avgBlockSize = 1.5; // MB estimate
  const avgTxCount = 3000; // Average transactions per block estimate
  const blocksInMempool = Math.ceil(mempoolSizeMB / avgBlockSize);

  const estimateTxCount = (sizeMB: number) => {
    return Math.round((sizeMB / avgBlockSize) * avgTxCount);
  };

  const avgTxSize = 250;
  const estimateTotalFees = (medianFee: number, txCount: number) => {
    return (medianFee * avgTxSize * txCount) / 100000000;
  };

  const mempoolBlocks: Array<{
    height: string;
    medianFee: number;
    feeRange: string;
    size: number;
    time: string;
    status: 'pending';
    txCount: number;
    totalFees: number;
  }> = [];

  if (blocksInMempool >= 1) {
    const blockSize = Math.min(mempoolSizeMB, avgBlockSize);
    const txCount = estimateTxCount(blockSize);
    mempoolBlocks.push({
      height: 'Next',
      medianFee: fees.fastestFee,
      feeRange: `${Math.max(fees.fastestFee - 5, 1)}-${fees.fastestFee + 50}`,
      size: blockSize,
      time: '~10m',
      status: 'pending' as const,
      txCount,
      totalFees: estimateTotalFees(fees.fastestFee, txCount),
    });
  }

  if (blocksInMempool >= 2) {
    const blockSize = Math.min(mempoolSizeMB - avgBlockSize, avgBlockSize);
    const txCount = estimateTxCount(blockSize);
    mempoolBlocks.push({
      height: '+2',
      medianFee: fees.halfHourFee,
      feeRange: `${Math.max(fees.halfHourFee - 5, 1)}-${fees.halfHourFee + 20}`,
      size: blockSize,
      time: '~20m',
      status: 'pending' as const,
      txCount,
      totalFees: estimateTotalFees(fees.halfHourFee, txCount),
    });
  }

  if (blocksInMempool >= 3) {
    const blockSize = Math.min(mempoolSizeMB - (avgBlockSize * 2), avgBlockSize);
    const txCount = estimateTxCount(blockSize);
    mempoolBlocks.push({
      height: '+3',
      medianFee: fees.hourFee,
      feeRange: `${Math.max(fees.hourFee - 3, 1)}-${fees.hourFee + 10}`,
      size: blockSize,
      time: '~30m',
      status: 'pending' as const,
      txCount,
      totalFees: estimateTotalFees(fees.hourFee, txCount),
    });
  }

  const confirmedBlocks = blocks.slice(0, 4).map((block) => {
    const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
    return {
      height: block.height,
      medianFee: block.extras?.medianFee ?? block.medianFee ?? 50,
      feeRange: block.extras?.feeRange
        ? `${block.extras.feeRange[0]}-${block.extras.feeRange[block.extras.feeRange.length - 1]}`
        : '40-200',
      size: block.size / 1000000,
      time: age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`,
      status: 'confirmed' as const,
      txCount: block.tx_count,
      totalFees: block.extras?.totalFees ? block.extras.totalFees / 100000000 : undefined,
    };
  });

  const displayedMempoolBlocks = Math.min(blocksInMempool, 3);
  const additionalBlocks = Math.max(blocksInMempool - displayedMempoolBlocks, 0);

  let queuedBlocksSummary = null;
  if (additionalBlocks > 0) {
    const additionalBlockSize = Math.max(mempoolSizeMB - (avgBlockSize * displayedMempoolBlocks), 0);
    const totalTxCount = estimateTxCount(additionalBlockSize);
    const avgFee = fees.economyFee;
    const estimatedTotalFees = (avgFee * 250 * totalTxCount) / 100000000;

    queuedBlocksSummary = {
      blockCount: additionalBlocks,
      totalTransactions: totalTxCount,
      averageFee: avgFee,
      totalFees: estimatedTotalFees,
    };
  }

  return {
    mempool: mempoolBlocks.reverse(),
    blocks: confirmedBlocks,
    mempoolInfo: {
      count: mempoolInfo.count,
      size: mempoolSizeMB,
      totalFees: mempoolInfo.total_fee,
    },
    queuedBlocksSummary,
  };
}
