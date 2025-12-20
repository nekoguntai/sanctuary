/**
 * Privacy Scoring Service
 *
 * Analyzes UTXOs and transactions to calculate privacy scores based on:
 * - Address reuse: Using same address multiple times links transactions
 * - Cluster linkage: UTXOs from same transaction are known to be same owner
 * - Round amounts: Round amounts suggest exchange withdrawals
 * - Timing correlation: Same-block receives suggest coordinated activity
 * - Change output identification: Obvious change outputs reduce privacy
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('PRIVACY');

// Privacy scoring weights (negative values reduce privacy)
const WEIGHTS = {
  ADDRESS_REUSE: -20,       // Address used multiple times
  CLUSTER_LINKAGE: -5,      // Per additional UTXO in same cluster
  ROUND_AMOUNT: -10,        // Amount is a round number
  TIMING_CORRELATION: -10,  // Same-block with another receive
  SMALL_UTXO: -5,           // Very small relative to total
  LARGE_UTXO: -5,           // Very large relative to total
};

export interface PrivacyFactor {
  factor: string;
  impact: number;
  description: string;
}

export interface PrivacyScore {
  score: number;           // 0-100 (higher = better privacy)
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  factors: PrivacyFactor[];
  warnings: string[];
}

export interface UtxoPrivacyInfo {
  utxoId: string;
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  score: PrivacyScore;
}

export interface WalletPrivacySummary {
  averageScore: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  utxoCount: number;
  addressReuseCount: number;
  roundAmountCount: number;
  clusterCount: number;
  recommendations: string[];
}

/**
 * Check if an amount is a round number (likely exchange withdrawal)
 */
function isRoundAmount(satoshis: bigint): boolean {
  const amount = Number(satoshis);

  // Check for round BTC amounts (0.1, 0.25, 0.5, 1.0, etc.)
  const btc = amount / 100_000_000;
  const roundBtcAmounts = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  if (roundBtcAmounts.includes(btc)) return true;

  // Check for round sat amounts ending in multiple zeros
  const str = amount.toString();
  const trailingZeros = str.length - str.replace(/0+$/, '').length;
  return trailingZeros >= 4; // 10000+ sats with trailing zeros
}

/**
 * Get a grade from a numeric score
 */
function getGrade(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/**
 * Calculate privacy score for a single UTXO
 */
export async function calculateUtxoPrivacy(
  utxoId: string
): Promise<PrivacyScore> {
  const utxo = await prisma.uTXO.findUnique({
    where: { id: utxoId },
    include: {
      wallet: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!utxo) {
    throw new Error('UTXO not found');
  }

  const factors: PrivacyFactor[] = [];
  const warnings: string[] = [];
  let score = 100; // Start with perfect score

  // Check address reuse
  const addressCount = await prisma.uTXO.count({
    where: {
      walletId: utxo.walletId,
      address: utxo.address,
      spent: false,
    },
  });

  if (addressCount > 1) {
    const impact = WEIGHTS.ADDRESS_REUSE;
    score += impact;
    factors.push({
      factor: 'Address Reuse',
      impact,
      description: `This address has ${addressCount} UTXOs, linking them together`,
    });
    warnings.push(`Address reuse detected: ${addressCount} UTXOs share this address`);
  }

  // Check cluster linkage (same transaction outputs)
  const sameTransactionUtxos = await prisma.uTXO.count({
    where: {
      walletId: utxo.walletId,
      txid: utxo.txid,
      spent: false,
      id: { not: utxo.id },
    },
  });

  if (sameTransactionUtxos > 0) {
    const impact = WEIGHTS.CLUSTER_LINKAGE * sameTransactionUtxos;
    score += impact;
    factors.push({
      factor: 'Transaction Clustering',
      impact,
      description: `${sameTransactionUtxos} other UTXOs from same transaction`,
    });
  }

  // Check round amount
  if (isRoundAmount(utxo.amount)) {
    const impact = WEIGHTS.ROUND_AMOUNT;
    score += impact;
    factors.push({
      factor: 'Round Amount',
      impact,
      description: 'Round amounts suggest exchange or service withdrawal',
    });
  }

  // Check timing correlation (same block height)
  if (utxo.blockHeight) {
    const sameBlockUtxos = await prisma.uTXO.count({
      where: {
        walletId: utxo.walletId,
        blockHeight: utxo.blockHeight,
        spent: false,
        id: { not: utxo.id },
        txid: { not: utxo.txid }, // Different transaction
      },
    });

    if (sameBlockUtxos > 0) {
      const impact = WEIGHTS.TIMING_CORRELATION;
      score += impact;
      factors.push({
        factor: 'Timing Correlation',
        impact,
        description: `Received in same block as ${sameBlockUtxos} other UTXOs`,
      });
    }
  }

  // Check relative size (very small or very large)
  const walletUtxos = await prisma.uTXO.findMany({
    where: {
      walletId: utxo.walletId,
      spent: false,
    },
    select: { amount: true },
  });

  const totalAmount = walletUtxos.reduce((sum, u) => sum + u.amount, BigInt(0));
  const avgAmount = totalAmount / BigInt(Math.max(walletUtxos.length, 1));
  const utxoAmount = utxo.amount;

  if (utxoAmount < avgAmount / BigInt(10)) {
    const impact = WEIGHTS.SMALL_UTXO;
    score += impact;
    factors.push({
      factor: 'Small UTXO',
      impact,
      description: 'Very small relative to wallet average',
    });
  } else if (utxoAmount > avgAmount * BigInt(10)) {
    const impact = WEIGHTS.LARGE_UTXO;
    score += impact;
    factors.push({
      factor: 'Large UTXO',
      impact,
      description: 'Very large relative to wallet average - dominant in selections',
    });
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: getGrade(score),
    factors,
    warnings,
  };
}

/**
 * Calculate privacy scores for all UTXOs in a wallet
 */
export async function calculateWalletPrivacy(
  walletId: string
): Promise<{ utxos: UtxoPrivacyInfo[]; summary: WalletPrivacySummary }> {
  const utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
    select: {
      id: true,
      txid: true,
      vout: true,
      amount: true,
      address: true,
      blockHeight: true,
    },
    orderBy: { amount: 'desc' },
  });

  if (utxos.length === 0) {
    return {
      utxos: [],
      summary: {
        averageScore: 100,
        grade: 'excellent',
        utxoCount: 0,
        addressReuseCount: 0,
        roundAmountCount: 0,
        clusterCount: 0,
        recommendations: [],
      },
    };
  }

  // Group by address to find reuse
  const addressCounts = new Map<string, number>();
  for (const utxo of utxos) {
    addressCounts.set(utxo.address, (addressCounts.get(utxo.address) || 0) + 1);
  }
  const addressReuseCount = [...addressCounts.values()].filter(c => c > 1).length;

  // Group by txid to find clusters
  const txidCounts = new Map<string, number>();
  for (const utxo of utxos) {
    txidCounts.set(utxo.txid, (txidCounts.get(utxo.txid) || 0) + 1);
  }
  const clusterCount = [...txidCounts.values()].filter(c => c > 1).length;

  // Count round amounts
  const roundAmountCount = utxos.filter(u => isRoundAmount(u.amount)).length;

  // Calculate individual scores
  const utxoInfos: UtxoPrivacyInfo[] = [];
  let totalScore = 0;

  for (const utxo of utxos) {
    const score = await calculateUtxoPrivacy(utxo.id);
    totalScore += score.score;
    utxoInfos.push({
      utxoId: utxo.id,
      txid: utxo.txid,
      vout: utxo.vout,
      amount: utxo.amount,
      address: utxo.address,
      score,
    });
  }

  const averageScore = totalScore / utxos.length;

  // Generate recommendations
  const recommendations: string[] = [];

  if (addressReuseCount > 0) {
    recommendations.push(
      `Avoid address reuse: ${addressReuseCount} addresses have multiple UTXOs`
    );
  }

  if (roundAmountCount > 3) {
    recommendations.push(
      `Consider using non-round amounts when withdrawing from exchanges`
    );
  }

  if (clusterCount > 0) {
    recommendations.push(
      `${clusterCount} transactions created multiple UTXOs to your wallet - these are linked`
    );
  }

  if (averageScore < 60) {
    recommendations.push(
      `Consider using coin control to select UTXOs carefully when spending`
    );
  }

  return {
    utxos: utxoInfos,
    summary: {
      averageScore: Math.round(averageScore),
      grade: getGrade(averageScore),
      utxoCount: utxos.length,
      addressReuseCount,
      roundAmountCount,
      clusterCount,
      recommendations,
    },
  };
}

/**
 * Calculate privacy impact of spending selected UTXOs together
 * This helps users understand the privacy implications of their selection
 */
export async function calculateSpendPrivacy(
  utxoIds: string[]
): Promise<{
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  linkedAddresses: number;
  warnings: string[];
}> {
  if (utxoIds.length === 0) {
    return {
      score: 100,
      grade: 'excellent',
      linkedAddresses: 0,
      warnings: [],
    };
  }

  const utxos = await prisma.uTXO.findMany({
    where: { id: { in: utxoIds } },
    select: {
      address: true,
      txid: true,
      amount: true,
    },
  });

  const warnings: string[] = [];
  let score = 100;

  // All inputs in a transaction are linked to same owner
  const uniqueAddresses = new Set(utxos.map(u => u.address));
  const linkedAddresses = uniqueAddresses.size;

  if (linkedAddresses > 1) {
    // Multiple addresses being spent together reveals common ownership
    const penalty = Math.min(30, (linkedAddresses - 1) * 10);
    score -= penalty;
    warnings.push(
      `Spending ${linkedAddresses} different addresses together links them as same owner`
    );
  }

  // Check if any UTXOs are from the same transaction (already linked)
  const uniqueTxids = new Set(utxos.map(u => u.txid));
  if (uniqueTxids.size < utxos.length) {
    // Some UTXOs from same transaction - less privacy loss since already linked
    score += 5; // Small bonus for using already-linked UTXOs
  }

  // Check for dust outputs being spent
  const dustUtxos = utxos.filter(u => u.amount < BigInt(1000));
  if (dustUtxos.length > 0) {
    score -= 5;
    warnings.push(
      `Including ${dustUtxos.length} dust UTXOs may not be economical`
    );
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: getGrade(score),
    linkedAddresses,
    warnings,
  };
}
