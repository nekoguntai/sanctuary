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
 * Uses projected blocks API for decimal precision, falls back to recommended endpoint
 */
export async function getRecommendedFees(): Promise<FeeEstimates> {
  try {
    const apiBase = await getMempoolApiBase();

    // Try projected blocks first for decimal precision
    try {
      const projectedResponse = await axios.get(`${apiBase}/v1/fees/mempool-blocks`, {
        timeout: 10000,
      });

      const blocks: ProjectedMempoolBlock[] = projectedResponse.data;

      if (blocks.length > 0) {
        // Derive fee estimates from projected blocks with decimal precision
        // Block 0 = next block (highest priority), Block 1 = +1 block, etc.
        const nextBlock = blocks[0];
        const secondBlock = blocks[1] || nextBlock;
        const thirdBlock = blocks[2] || secondBlock;
        const lastBlock = blocks[blocks.length - 1];

        // Get minimum fee from the fee range of the last projected block
        const minimumFee = lastBlock?.feeRange?.[0] ?? 1;

        // Format fee with decimal precision
        const formatFee = (fee: number): number => {
          if (fee >= 10) return Math.round(fee);
          return parseFloat(fee.toFixed(1));
        };

        return {
          fastestFee: formatFee(nextBlock.medianFee),
          halfHourFee: formatFee(secondBlock.medianFee),
          hourFee: formatFee(thirdBlock.medianFee),
          economyFee: formatFee(lastBlock.medianFee),
          minimumFee: formatFee(minimumFee),
        };
      }
    } catch (projectedError: any) {
      log.debug('Projected blocks failed, trying recommended endpoint', { error: projectedError.message });
    }

    // Fallback to recommended endpoint (returns integers)
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

        // IMPORTANT: Block ordering documentation
        // =========================================
        // mempool.space API returns blocks in order of confirmation priority:
        //   - projectedBlocks[0] = Next block (highest fee, confirms first)
        //   - projectedBlocks[1] = +2 blocks out
        //   - projectedBlocks[2] = +3 blocks out
        //
        // We convert them with labels and then REVERSE at the end (line ~350),
        // so the final 'mempool' array returned to frontend is:
        //   - mempool[0] = +3 block (furthest from confirmation, leftmost in UI)
        //   - mempool[1] = +2 block
        //   - mempool[2] = Next block (closest to confirmation, rightmost pending)
        //
        // The frontend displays blocks left-to-right in array order:
        //   [+3] [+2] [Next] | [Confirmed blocks...]
        //
        // When matching pending transactions to blocks, use:
        //   - Index 0 = +3 (lowest priority, lowest fees)
        //   - Index (length-1) = Next block (highest priority, highest fees)

        // Convert projected blocks to our format (show up to 3)
        const blockLabels = ['Next', '+2', '+3'];
        const blockTimes = ['~10m', '~20m', '~30m'];

        // Helper to format fee rate - always 2 decimal places
        const formatFeeRate = (rate: number): string => {
          return rate.toFixed(2);
        };

        mempoolBlocks = projectedBlocks.slice(0, 3).map((block, idx) => {
          // Calculate average fee rate: totalFees (sats) / blockVSize (vbytes)
          const avgFeeRate = block.blockVSize > 0 ? block.totalFees / block.blockVSize : 0;
          return {
            height: blockLabels[idx] || `+${idx + 1}`,
            medianFee: block.medianFee < 1 ? parseFloat(block.medianFee.toFixed(2)) : Math.round(block.medianFee),
            avgFeeRate: avgFeeRate < 1 ? parseFloat(avgFeeRate.toFixed(2)) : Math.round(avgFeeRate),
            feeRange: block.feeRange.length >= 2
              ? `${formatFeeRate(block.feeRange[0])}-${formatFeeRate(block.feeRange[block.feeRange.length - 1])} sat/vB`
              : `${formatFeeRate(block.medianFee)} sat/vB`,
            size: block.blockVSize / 1000000, // Convert to MB
            time: blockTimes[idx] || `~${(idx + 1) * 10}m`,
            status: 'pending' as const,
            txCount: block.nTx,
            totalFees: block.totalFees / 100000000, // Convert satoshis to BTC
          };
        });

        // Calculate summary for additional blocks beyond the 3 displayed
        if (projectedBlocks.length > 3) {
          const additionalBlocks = projectedBlocks.slice(3);
          const totalTxCount = additionalBlocks.reduce((sum, b) => sum + b.nTx, 0);
          const totalFees = additionalBlocks.reduce((sum, b) => sum + b.totalFees, 0);
          const totalVsize = additionalBlocks.reduce((sum, b) => sum + b.blockVSize, 0);
          const avgFee = additionalBlocks.length > 0
            ? additionalBlocks.reduce((sum, b) => sum + b.medianFee, 0) / additionalBlocks.length
            : fees.economyFee;

          // Calculate actual block count based on vsize
          // A typical block is ~1MB (1,000,000 vbytes)
          // The last API block often contains many blocks worth of transactions
          const BLOCK_VSIZE = 1000000; // 1 MB
          const estimatedBlockCount = Math.ceil(totalVsize / BLOCK_VSIZE);

          queuedBlocksSummary = {
            blockCount: estimatedBlockCount,
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

    // Helper to format fee rate - always 2 decimal places
    const formatFeeRateConfirmed = (rate: number): string => {
      return rate.toFixed(2);
    };

    // Format confirmed blocks
    const confirmedBlocks = blocks.slice(0, 4).map((block) => {
      const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
      // Calculate average fee rate from totalFees and block weight
      // block.weight is in weight units, vsize = weight / 4
      const vsize = (block.weight || block.size) / 4;
      const totalFeesSats = block.extras?.totalFees || 0;
      const avgFeeRate = vsize > 0 ? totalFeesSats / vsize : 0;
      const feeRangeArr = block.extras?.feeRange;
      return {
        height: block.height,
        medianFee: block.extras?.medianFee ?? block.medianFee ?? 50,
        avgFeeRate: avgFeeRate < 1 ? parseFloat(avgFeeRate.toFixed(2)) : Math.round(avgFeeRate),
        feeRange: feeRangeArr && feeRangeArr.length >= 2
          ? `${formatFeeRateConfirmed(feeRangeArr[0])}-${formatFeeRateConfirmed(feeRangeArr[feeRangeArr.length - 1])} sat/vB`
          : '40.00-200.00 sat/vB',
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

  // Helper to format fee rate - always 2 decimal places
  const formatFeeRate = (rate: number): string => {
    return rate.toFixed(2);
  };

  const mempoolBlocks: Array<{
    height: string;
    medianFee: number;
    avgFeeRate: number;
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
    const totalFees = estimateTotalFees(fees.fastestFee, txCount);
    const minFee = Math.max(fees.fastestFee - 5, 0.1);
    const maxFee = fees.fastestFee + 50;
    mempoolBlocks.push({
      height: 'Next',
      medianFee: fees.fastestFee,
      avgFeeRate: fees.fastestFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~10m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  if (blocksInMempool >= 2) {
    const blockSize = Math.min(mempoolSizeMB - avgBlockSize, avgBlockSize);
    const txCount = estimateTxCount(blockSize);
    const totalFees = estimateTotalFees(fees.halfHourFee, txCount);
    const minFee = Math.max(fees.halfHourFee - 5, 0.1);
    const maxFee = fees.halfHourFee + 20;
    mempoolBlocks.push({
      height: '+2',
      medianFee: fees.halfHourFee,
      avgFeeRate: fees.halfHourFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~20m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  if (blocksInMempool >= 3) {
    const blockSize = Math.min(mempoolSizeMB - (avgBlockSize * 2), avgBlockSize);
    const txCount = estimateTxCount(blockSize);
    const totalFees = estimateTotalFees(fees.hourFee, txCount);
    const minFee = Math.max(fees.hourFee - 3, 0.1);
    const maxFee = fees.hourFee + 10;
    mempoolBlocks.push({
      height: '+3',
      medianFee: fees.hourFee,
      avgFeeRate: fees.hourFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~30m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  const confirmedBlocks = blocks.slice(0, 4).map((block) => {
    const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
    // Calculate average fee rate from totalFees and block weight
    const vsize = (block.weight || block.size) / 4;
    const totalFeesSats = block.extras?.totalFees || 0;
    const avgFeeRate = vsize > 0 ? totalFeesSats / vsize : 0;
    const feeRangeArr = block.extras?.feeRange;
    return {
      height: block.height,
      medianFee: block.extras?.medianFee ?? block.medianFee ?? 50,
      avgFeeRate: avgFeeRate < 1 ? parseFloat(avgFeeRate.toFixed(2)) : Math.round(avgFeeRate),
      feeRange: feeRangeArr && feeRangeArr.length >= 2
        ? `${formatFeeRate(feeRangeArr[0])}-${formatFeeRate(feeRangeArr[feeRangeArr.length - 1])} sat/vB`
        : '40.00-200.00 sat/vB',
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
