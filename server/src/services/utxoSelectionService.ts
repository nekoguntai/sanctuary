/**
 * UTXO Selection Service
 *
 * Provides different strategies for selecting UTXOs for transactions:
 * - Privacy: Minimize address linkage, prefer already-linked UTXOs
 * - Efficiency: Minimize transaction fees (fewest inputs)
 * - Oldest First: Use oldest UTXOs first (reduce UTXO set age)
 * - Largest First: Use largest UTXOs (minimize input count)
 * - Smallest First: Use smallest UTXOs (consolidation mode)
 */

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('UTXO-SELECTION');

// Input virtual bytes by script type
const INPUT_VBYTES: Record<string, number> = {
  legacy: 148,
  nested_segwit: 91,
  native_segwit: 68,
  taproot: 57.5,
};

// Default to native_segwit for unknown script types
const DEFAULT_INPUT_VBYTES = 68;

export type SelectionStrategy =
  | 'privacy'
  | 'efficiency'
  | 'oldest_first'
  | 'largest_first'
  | 'smallest_first';

export interface SelectedUtxo {
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight?: number;
}

export interface SelectionResult {
  selected: SelectedUtxo[];
  totalAmount: bigint;
  estimatedFee: bigint;
  changeAmount: bigint;
  inputCount: number;
  strategy: SelectionStrategy;
  warnings: string[];
  privacyImpact?: {
    linkedAddresses: number;
    score: number;
  };
}

export interface SelectionOptions {
  walletId: string;
  targetAmount: bigint;
  feeRate: number;
  strategy: SelectionStrategy;
  excludeFrozen?: boolean;
  excludeUnconfirmed?: boolean;
  excludeUtxoIds?: string[];
  scriptType?: string;
}

/**
 * Get available UTXOs for selection
 */
async function getAvailableUtxos(
  walletId: string,
  options: {
    excludeFrozen?: boolean;
    excludeUnconfirmed?: boolean;
    excludeUtxoIds?: string[];
  }
): Promise<SelectedUtxo[]> {
  const where: Record<string, unknown> = {
    walletId,
    spent: false,
  };

  if (options.excludeFrozen !== false) {
    where.frozen = false;
  }

  if (options.excludeUnconfirmed) {
    where.confirmations = { gt: 0 };
  }

  if (options.excludeUtxoIds?.length) {
    where.id = { notIn: options.excludeUtxoIds };
  }

  // Also exclude UTXOs locked by drafts
  where.draftLock = null;

  const utxos = await prisma.uTXO.findMany({
    where,
    select: {
      id: true,
      txid: true,
      vout: true,
      address: true,
      amount: true,
      confirmations: true,
      blockHeight: true,
    },
    orderBy: { amount: 'desc' },
  });

  return utxos.map(u => ({
    id: u.id,
    txid: u.txid,
    vout: u.vout,
    address: u.address,
    amount: u.amount,
    confirmations: u.confirmations,
    blockHeight: u.blockHeight ?? undefined,
  }));
}

/**
 * Calculate transaction fee based on inputs and outputs
 */
function calculateFee(
  inputCount: number,
  outputCount: number,
  feeRate: number,
  scriptType: string = 'native_segwit'
): bigint {
  const inputVBytes = INPUT_VBYTES[scriptType] || DEFAULT_INPUT_VBYTES;
  const outputVBytes = 34; // P2WPKH output
  const overheadVBytes = 10.5; // Transaction overhead

  const vSize = overheadVBytes + inputCount * inputVBytes + outputCount * outputVBytes;
  return BigInt(Math.ceil(vSize * feeRate));
}

/**
 * Privacy-focused selection
 * Prefers UTXOs that are already linked (same txid) to minimize new linkages
 */
function selectForPrivacy(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Group UTXOs by txid (already linked)
  const byTxid = new Map<string, SelectedUtxo[]>();
  for (const utxo of utxos) {
    const group = byTxid.get(utxo.txid) || [];
    group.push(utxo);
    byTxid.set(utxo.txid, group);
  }

  // Sort groups by total amount descending
  const groups = [...byTxid.values()].sort((a, b) => {
    const totalA = a.reduce((sum, u) => sum + u.amount, BigInt(0));
    const totalB = b.reduce((sum, u) => sum + u.amount, BigInt(0));
    return totalB > totalA ? 1 : -1;
  });

  let totalSelected = BigInt(0);
  let addressesSeen = new Set<string>();

  // First, try to satisfy with UTXOs from a single transaction (already linked)
  for (const group of groups) {
    if (selected.length === 0) {
      const groupTotal = group.reduce((sum, u) => sum + u.amount, BigInt(0));
      const fee = calculateFee(group.length, 2, feeRate, scriptType);

      if (groupTotal >= targetAmount + fee) {
        selected.push(...group);
        totalSelected = groupTotal;
        group.forEach(u => addressesSeen.add(u.address));
        break;
      }
    }
  }

  // If not satisfied, add more UTXOs preferring same addresses
  if (totalSelected < targetAmount + calculateFee(selected.length || 1, 2, feeRate, scriptType)) {
    // Sort remaining by whether address is already used
    const remaining = utxos.filter(u => !selected.includes(u));
    remaining.sort((a, b) => {
      const aInSet = addressesSeen.has(a.address) ? 0 : 1;
      const bInSet = addressesSeen.has(b.address) ? 0 : 1;
      if (aInSet !== bInSet) return aInSet - bInSet;
      return b.amount > a.amount ? 1 : -1;
    });

    for (const utxo of remaining) {
      const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
      if (totalSelected >= targetAmount + currentFee) break;

      selected.push(utxo);
      totalSelected += utxo.amount;
      addressesSeen.add(utxo.address);
    }
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  if (addressesSeen.size > 1) {
    warnings.push(`Spending from ${addressesSeen.size} different addresses links them together`);
  }

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'privacy',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Efficiency-focused selection (minimize fees)
 * Uses largest UTXOs first to minimize input count
 */
function selectForEfficiency(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Already sorted by amount descending
  let totalSelected = BigInt(0);

  for (const utxo of utxos) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'efficiency',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Oldest First selection
 * Uses oldest UTXOs first to reduce UTXO set age
 */
function selectOldestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Sort by confirmations descending (oldest first)
  const sorted = [...utxos].sort((a, b) => b.confirmations - a.confirmations);

  let totalSelected = BigInt(0);

  for (const utxo of sorted) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'oldest_first',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Largest First selection
 * Uses largest UTXOs first (same as efficiency)
 */
function selectLargestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const result = selectForEfficiency(utxos, targetAmount, feeRate, scriptType);
  return { ...result, strategy: 'largest_first' };
}

/**
 * Smallest First selection (consolidation mode)
 * Uses smallest UTXOs first to consolidate dust
 */
function selectSmallestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Sort by amount ascending (smallest first)
  const sorted = [...utxos].sort((a, b) => (a.amount < b.amount ? -1 : 1));

  let totalSelected = BigInt(0);

  for (const utxo of sorted) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  if (selected.length > 5) {
    warnings.push(`Using ${selected.length} small UTXOs increases transaction size and fee`);
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'smallest_first',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Select UTXOs using the specified strategy
 */
export async function selectUtxos(options: SelectionOptions): Promise<SelectionResult> {
  const {
    walletId,
    targetAmount,
    feeRate,
    strategy,
    excludeFrozen = true,
    excludeUnconfirmed = false,
    excludeUtxoIds = [],
    scriptType = 'native_segwit',
  } = options;

  log.debug(`Selecting UTXOs for wallet ${walletId}`, {
    targetAmount: targetAmount.toString(),
    feeRate,
    strategy,
  });

  const utxos = await getAvailableUtxos(walletId, {
    excludeFrozen,
    excludeUnconfirmed,
    excludeUtxoIds,
  });

  if (utxos.length === 0) {
    return {
      selected: [],
      totalAmount: BigInt(0),
      estimatedFee: BigInt(0),
      changeAmount: BigInt(0),
      inputCount: 0,
      strategy,
      warnings: ['No available UTXOs'],
    };
  }

  switch (strategy) {
    case 'privacy':
      return selectForPrivacy(utxos, targetAmount, feeRate, scriptType);
    case 'efficiency':
      return selectForEfficiency(utxos, targetAmount, feeRate, scriptType);
    case 'oldest_first':
      return selectOldestFirst(utxos, targetAmount, feeRate, scriptType);
    case 'largest_first':
      return selectLargestFirst(utxos, targetAmount, feeRate, scriptType);
    case 'smallest_first':
      return selectSmallestFirst(utxos, targetAmount, feeRate, scriptType);
    default:
      return selectForEfficiency(utxos, targetAmount, feeRate, scriptType);
  }
}

/**
 * Compare different selection strategies for a given amount
 */
export async function compareStrategies(
  walletId: string,
  targetAmount: bigint,
  feeRate: number,
  scriptType: string = 'native_segwit'
): Promise<Record<SelectionStrategy, SelectionResult>> {
  const strategies: SelectionStrategy[] = [
    'privacy',
    'efficiency',
    'oldest_first',
    'largest_first',
    'smallest_first',
  ];

  const results: Record<string, SelectionResult> = {};

  for (const strategy of strategies) {
    results[strategy] = await selectUtxos({
      walletId,
      targetAmount,
      feeRate,
      strategy,
      scriptType,
    });
  }

  return results as Record<SelectionStrategy, SelectionResult>;
}

/**
 * Get recommended strategy based on context
 */
export function getRecommendedStrategy(
  utxoCount: number,
  feeRate: number,
  prioritizePrivacy: boolean = false
): { strategy: SelectionStrategy; reason: string } {
  if (prioritizePrivacy) {
    return {
      strategy: 'privacy',
      reason: 'Minimizes address linkage for better privacy',
    };
  }

  if (feeRate > 50) {
    return {
      strategy: 'efficiency',
      reason: 'High fee environment - minimizing input count saves fees',
    };
  }

  if (feeRate < 5 && utxoCount > 20) {
    return {
      strategy: 'smallest_first',
      reason: 'Low fee environment - good time to consolidate small UTXOs',
    };
  }

  return {
    strategy: 'efficiency',
    reason: 'Default: minimizes transaction fees',
  };
}
