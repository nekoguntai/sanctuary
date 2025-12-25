/**
 * Bitcoin Address Validation Utilities
 *
 * Quick regex-based validation for immediate UI feedback.
 * For full validation, use the API.
 */

// Bitcoin address patterns
const PATTERNS = {
  // Legacy (P2PKH) - starts with 1
  legacy: /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  // P2SH (including nested SegWit) - starts with 3
  p2sh: /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  // Native SegWit (P2WPKH/P2WSH) - starts with bc1q
  nativeSegwit: /^bc1q[a-z0-9]{38,58}$/i,
  // Taproot (P2TR) - starts with bc1p
  taproot: /^bc1p[a-z0-9]{58}$/i,
  // Testnet addresses
  testnetLegacy: /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  testnetP2sh: /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  testnetSegwit: /^tb1[a-z0-9]{39,59}$/i,
};

/**
 * Quick format check for Bitcoin address.
 * Returns true if the address appears valid, false if obviously invalid.
 * For definitive validation, use the API.
 */
export function validateAddress(address: string): boolean {
  if (!address || address.length < 26) return false;

  const trimmed = address.trim();

  // Check against all patterns
  return (
    PATTERNS.legacy.test(trimmed) ||
    PATTERNS.p2sh.test(trimmed) ||
    PATTERNS.nativeSegwit.test(trimmed) ||
    PATTERNS.taproot.test(trimmed) ||
    PATTERNS.testnetLegacy.test(trimmed) ||
    PATTERNS.testnetP2sh.test(trimmed) ||
    PATTERNS.testnetSegwit.test(trimmed)
  );
}

/**
 * Detect the type of Bitcoin address
 */
export function getAddressType(address: string): string | null {
  if (!address) return null;

  const trimmed = address.trim();

  if (PATTERNS.legacy.test(trimmed)) return 'legacy';
  if (PATTERNS.p2sh.test(trimmed)) return 'p2sh';
  if (PATTERNS.nativeSegwit.test(trimmed)) return 'native_segwit';
  if (PATTERNS.taproot.test(trimmed)) return 'taproot';
  if (PATTERNS.testnetLegacy.test(trimmed)) return 'testnet_legacy';
  if (PATTERNS.testnetP2sh.test(trimmed)) return 'testnet_p2sh';
  if (PATTERNS.testnetSegwit.test(trimmed)) return 'testnet_segwit';

  return null;
}

/**
 * Check if address is a mainnet address
 */
export function isMainnetAddress(address: string): boolean {
  if (!address) return false;

  const trimmed = address.trim();

  return (
    PATTERNS.legacy.test(trimmed) ||
    PATTERNS.p2sh.test(trimmed) ||
    PATTERNS.nativeSegwit.test(trimmed) ||
    PATTERNS.taproot.test(trimmed)
  );
}

/**
 * Check if address is a testnet address
 */
export function isTestnetAddress(address: string): boolean {
  if (!address) return false;

  const trimmed = address.trim();

  return (
    PATTERNS.testnetLegacy.test(trimmed) ||
    PATTERNS.testnetP2sh.test(trimmed) ||
    PATTERNS.testnetSegwit.test(trimmed)
  );
}

/**
 * Get the network for an address
 */
export function getAddressNetwork(address: string): 'mainnet' | 'testnet' | 'regtest' | null {
  if (!address) return null;

  const trimmed = address.trim();

  if (isMainnetAddress(trimmed)) return 'mainnet';
  if (isTestnetAddress(trimmed)) return 'testnet';
  // Note: regtest addresses look the same as testnet addresses
  // They can only be distinguished by context (i.e., which network the wallet is on)
  return null;
}

/**
 * Check if an address matches a specific network
 */
export function addressMatchesNetwork(
  address: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): boolean {
  const addressNetwork = getAddressNetwork(address);
  if (!addressNetwork) return false;

  // Regtest uses testnet address format
  if (network === 'regtest') {
    return addressNetwork === 'testnet';
  }

  return addressNetwork === network;
}
