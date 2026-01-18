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

// ============================================================================
// DERIVATION PATH UTILITIES
// ============================================================================

/**
 * Normalize derivation path to use apostrophe notation (')
 * This is the standard notation used by most Bitcoin tools and required by
 * bitcoinjs-lib for proper PSBT bip32Derivation encoding.
 *
 * @example
 * normalizeDerivationPath("m/48h/0h/0h/2h") // => "m/48'/0'/0'/2'"
 * normalizeDerivationPath("48H/0H/0H") // => "m/48'/0'/0'"
 * normalizeDerivationPath("m/84'/0'/0'") // => "m/84'/0'/0'" (unchanged)
 */
export function normalizeDerivationPath(path: string): string {
  // Add m/ prefix if missing
  let normalized = path.startsWith('m/') ? path : `m/${path}`;
  // Convert h or H to ' (both uppercase and lowercase hardening notation)
  normalized = normalized.replace(/[hH]/g, "'");
  return normalized;
}

/**
 * Format derivation path for use in Bitcoin output descriptors.
 * Descriptors use 'h' notation without the 'm/' prefix.
 *
 * @example
 * formatPathForDescriptor("m/48'/0'/0'/2'") // => "48h/0h/0h/2h"
 * formatPathForDescriptor("84'/0'/0'") // => "84h/0h/0h"
 */
export function formatPathForDescriptor(path: string): string {
  // Remove m/ prefix and replace ' with h
  return path.replace(/^m\//, '').replace(/'/g, 'h');
}

/**
 * Extract the change index and address index from a derivation path.
 * For BIP-48 multisig: purpose'/coin'/account'/script'/change/index
 * The last two non-hardened parts are change and index.
 *
 * @example
 * extractChangeAndAddressIndex("m/48'/0'/0'/2'/0/5") // => { changeIdx: 0, addressIdx: 5 }
 * extractChangeAndAddressIndex("m/84'/0'/0'/1/10") // => { changeIdx: 1, addressIdx: 10 }
 */
export function extractChangeAndAddressIndex(derivationPath: string): {
  changeIdx: number;
  addressIdx: number;
} {
  const pathParts = derivationPath
    .replace(/^m\/?/, '')
    .split('/')
    .filter((p) => p);
  // The last two parts are change and index (non-hardened)
  const changeIdx =
    pathParts.length >= 2
      ? parseInt(pathParts[pathParts.length - 2].replace(/['h]/g, ''), 10)
      : 0;
  const addressIdx =
    pathParts.length >= 1
      ? parseInt(pathParts[pathParts.length - 1].replace(/['h]/g, ''), 10)
      : 0;
  return { changeIdx, addressIdx };
}
