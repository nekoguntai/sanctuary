/**
 * Wallet Transactions - Shared Utilities
 *
 * Helper functions shared across wallet transaction route handlers.
 */

/**
 * Calculate confirmations dynamically from block height using cached current height
 * This avoids network calls while providing accurate confirmation counts
 */
export function calculateConfirmations(txBlockHeight: number | null, cachedHeight: number): number {
  if (!txBlockHeight || txBlockHeight <= 0 || cachedHeight <= 0) return 0;
  return Math.max(0, cachedHeight - txBlockHeight + 1);
}
