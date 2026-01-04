/**
 * UTXO Selection Strategy Registry
 *
 * Central registry for UTXO selection strategies.
 *
 * Usage:
 *   import { selectionStrategyRegistry } from './utxoSelection';
 *
 *   // Select UTXOs using a specific strategy
 *   const result = selectionStrategyRegistry.select('privacy', context);
 *
 *   // Get available strategies
 *   const strategies = selectionStrategyRegistry.getStrategyInfo();
 *
 * Adding new strategies:
 *   1. Create handler in strategies/ directory implementing SelectionStrategyHandler
 *   2. Import and register below
 */

import { selectionStrategyRegistry } from './registry';

// Import strategies
import { privacyStrategy } from './strategies/privacy';
import { efficiencyStrategy } from './strategies/efficiency';
import { oldestFirstStrategy } from './strategies/oldestFirst';
import { largestFirstStrategy } from './strategies/largestFirst';
import { smallestFirstStrategy } from './strategies/smallestFirst';

// Register strategies
selectionStrategyRegistry.register(privacyStrategy);
selectionStrategyRegistry.register(efficiencyStrategy);
selectionStrategyRegistry.register(oldestFirstStrategy);
selectionStrategyRegistry.register(largestFirstStrategy);
selectionStrategyRegistry.register(smallestFirstStrategy);

// Export the registry and types
export { selectionStrategyRegistry } from './registry';
export type {
  SelectionStrategyHandler,
  SelectionContext,
  SelectionResult,
  SelectedUtxo,
  BuiltInStrategyId,
} from './types';
export { calculateFee, calculatePrivacyImpact } from './utils';

// Export individual strategies for direct use if needed
export { privacyStrategy } from './strategies/privacy';
export { efficiencyStrategy } from './strategies/efficiency';
export { oldestFirstStrategy } from './strategies/oldestFirst';
export { largestFirstStrategy } from './strategies/largestFirst';
export { smallestFirstStrategy } from './strategies/smallestFirst';
