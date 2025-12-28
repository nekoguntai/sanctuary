/**
 * Shared Bitcoin Utility Functions
 *
 * These functions are used across frontend, backend, and gateway
 * for Bitcoin value conversion and formatting.
 */

import { SATS_PER_BTC, ADDRESS_PATTERNS } from '../constants/bitcoin';
import type { AddressType } from '../constants/bitcoin';

// Re-export types and constants for convenience
export { SATS_PER_BTC };
export type { AddressType };

/**
 * Convert satoshis to BTC
 */
export function satsToBTC(sats: number): number {
  return sats / SATS_PER_BTC;
}

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

/**
 * Format satoshis for display with locale-specific formatting
 */
export function formatSats(sats: number, decimals: number = 0): string {
  return sats.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format BTC for display
 * Trims trailing zeros by default for cleaner display
 */
export function formatBTC(btc: number, decimals: number = 8, trimZeros: boolean = true): string {
  const formatted = btc.toFixed(decimals);
  if (trimZeros) {
    return formatted.replace(/\.?0+$/, '');
  }
  return formatted;
}

/**
 * Format satoshis as BTC string
 * Convenience function combining satsToBTC and formatBTC
 */
export function formatBTCFromSats(sats: number, decimals: number = 8): string {
  return satsToBTC(sats).toFixed(decimals);
}

/**
 * Quick address format validation using regex patterns
 * Note: This validates format only. Use bitcoinjs-lib on backend for
 * cryptographic validation.
 */
export function isValidAddressFormat(address: string): boolean {
  if (!address || address.length < 26) return false;
  const trimmed = address.trim();
  return Object.values(ADDRESS_PATTERNS).some((pattern) => pattern.test(trimmed));
}

/**
 * Detect address type from format
 * Returns null if address format is not recognized
 */
export function detectAddressType(address: string): AddressType | null {
  if (!address) return null;
  const trimmed = address.trim();

  if (ADDRESS_PATTERNS.legacy.test(trimmed)) return 'legacy';
  if (ADDRESS_PATTERNS.p2sh.test(trimmed)) return 'p2sh';
  if (ADDRESS_PATTERNS.nativeSegwit.test(trimmed)) return 'native_segwit';
  if (ADDRESS_PATTERNS.taproot.test(trimmed)) return 'taproot';
  if (ADDRESS_PATTERNS.testnetLegacy.test(trimmed)) return 'testnet_legacy';
  if (ADDRESS_PATTERNS.testnetP2sh.test(trimmed)) return 'testnet_p2sh';
  if (ADDRESS_PATTERNS.testnetSegwit.test(trimmed)) return 'testnet_segwit';

  return null;
}

/**
 * Check if address is on mainnet
 */
export function isMainnetAddress(address: string): boolean {
  const type = detectAddressType(address);
  return type !== null && !type.startsWith('testnet');
}

/**
 * Check if address is on testnet
 */
export function isTestnetAddress(address: string): boolean {
  const type = detectAddressType(address);
  return type !== null && type.startsWith('testnet');
}
