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
    console.warn('[MEMPOOL] Could not fetch node config, using default:', error);
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
    console.error('[MEMPOOL] Failed to fetch recent blocks:', error.message);
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
    console.error('[MEMPOOL] Failed to fetch mempool info:', error.message);
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
    console.error('[MEMPOOL] Failed to fetch fee estimates:', error.message);
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
    console.error('[MEMPOOL] Failed to fetch block:', error.message);
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
    console.error('[MEMPOOL] Failed to fetch block at height:', error.message);
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
    console.error('[MEMPOOL] Failed to fetch tip height:', error.message);
    throw new Error('Failed to fetch tip height from mempool.space');
  }
}

/**
 * Get blocks and mempool data for dashboard visualization
 * Returns recent confirmed blocks + projected mempool blocks
 */
export async function getBlocksAndMempool() {
  try {
    const [blocks, mempoolInfo, fees] = await Promise.all([
      getRecentBlocks(7),
      getMempoolInfo(),
      getRecommendedFees(),
    ]);

    // Calculate mempool blocks (projected based on fee levels)
    const mempoolBlocks = [];
    const avgBlockSize = 1.5; // MB estimate
    const avgTxCount = 3000; // Average transactions per block estimate

    // Mempool size in MB
    const mempoolSizeMB = mempoolInfo.vsize / 1000000;
    const blocksInMempool = Math.ceil(mempoolSizeMB / avgBlockSize);

    // Estimate transaction count based on mempool
    const estimateTxCount = (sizeMB: number) => {
      return Math.round((sizeMB / avgBlockSize) * avgTxCount);
    };

    // Helper to estimate total fees for a projected block
    // Formula: medianFee (sat/vB) * avgTxSize (vB) * txCount / 100000000 (to BTC)
    const avgTxSize = 250; // Average transaction size in vBytes
    const estimateTotalFees = (medianFee: number, txCount: number) => {
      return (medianFee * avgTxSize * txCount) / 100000000;
    };

    // Create projected mempool blocks
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

    // Format confirmed blocks
    const confirmedBlocks = blocks.slice(0, 4).map((block, idx) => {
      const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
      return {
        height: block.height,
        medianFee: block.extras?.medianFee ?? block.medianFee ?? 50,
        feeRange: block.extras?.feeRange
          ? `${block.extras.feeRange[0]}-${block.extras.feeRange[block.extras.feeRange.length - 1]}`
          : '40-200',
        size: block.size / 1000000, // Convert to MB
        time: age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`,
        status: 'confirmed' as const,
        txCount: block.tx_count,
        totalFees: block.extras?.totalFees ? block.extras.totalFees / 100000000 : undefined, // Convert satoshis to BTC
      };
    });

    // Calculate summary for additional queued blocks beyond the 3 displayed
    const displayedMempoolBlocks = Math.min(blocksInMempool, 3);
    const additionalBlocks = Math.max(blocksInMempool - displayedMempoolBlocks, 0);

    // If there are additional blocks, calculate their summary
    let queuedBlocksSummary = null;
    if (additionalBlocks > 0) {
      // Estimate total transactions in additional blocks
      const additionalBlockSize = Math.max(mempoolSizeMB - (avgBlockSize * displayedMempoolBlocks), 0);
      const totalTxCount = estimateTxCount(additionalBlockSize);

      // Calculate average fee for remaining mempool (use economy fee as estimate)
      const avgFee = fees.economyFee;

      // Estimate total fees for additional blocks (rough approximation)
      // Average fee * average tx size (250 vB) * tx count / 100000000 to convert to BTC
      const estimatedTotalFees = (avgFee * 250 * totalTxCount) / 100000000;

      queuedBlocksSummary = {
        blockCount: additionalBlocks,
        totalTransactions: totalTxCount,
        averageFee: avgFee,
        totalFees: estimatedTotalFees,
      };
    }

    return {
      mempool: mempoolBlocks.reverse(), // Reverse so furthest is first
      blocks: confirmedBlocks,
      mempoolInfo: {
        count: mempoolInfo.count,
        size: mempoolSizeMB,
        totalFees: mempoolInfo.total_fee,
      },
      queuedBlocksSummary,
    };
  } catch (error: any) {
    console.error('[MEMPOOL] Failed to fetch blocks and mempool:', error.message);
    throw error;
  }
}
