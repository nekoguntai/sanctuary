/**
 * UTXO Selection Strategy Types
 *
 * Defines the interface for pluggable UTXO selection strategies.
 */

/**
 * Built-in strategy IDs for type safety
 */
export type BuiltInStrategyId =
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
  strategy: BuiltInStrategyId | string;
  warnings: string[];
  privacyImpact?: {
    linkedAddresses: number;
    score: number;
  };
}

export interface SelectionContext {
  utxos: SelectedUtxo[];
  targetAmount: bigint;
  feeRate: number;
  scriptType: string;
}

/**
 * UTXO Selection Strategy Handler Interface
 *
 * Implement this interface to add a new selection strategy.
 */
export interface SelectionStrategyHandler {
  /** Unique identifier for this strategy */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of the strategy's approach */
  description: string;

  /** Priority for strategy (higher = shown first in UI) */
  priority: number;

  /** Tags for categorization (e.g., 'privacy', 'efficiency', 'consolidation') */
  tags: string[];

  /**
   * Select UTXOs according to this strategy
   * @param context - The selection context (UTXOs, target, fee rate)
   * @returns The selection result
   */
  select(context: SelectionContext): SelectionResult;
}
