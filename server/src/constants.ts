/**
 * Shared Constants
 *
 * Central location for constants used across the server.
 * Avoids magic numbers and ensures consistency.
 */

// ============================================================================
// WALLET CONSTANTS
// ============================================================================

/**
 * Number of addresses to generate when creating a new wallet
 */
export const INITIAL_ADDRESS_COUNT = 20;

/**
 * Maximum addresses that can be generated in a single request
 */
export const MAX_ADDRESSES_PER_GENERATION = 100;

/**
 * Gap limit for address scanning (BIP-44 standard is 20)
 */
export const ADDRESS_GAP_LIMIT = 20;

// ============================================================================
// PAGINATION CONSTANTS
// ============================================================================

/**
 * Default number of items per page
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum items per page to prevent abuse
 */
export const MAX_PAGE_SIZE = 1000;

// ============================================================================
// TRANSACTION CONSTANTS
// ============================================================================

/**
 * Default number of confirmations required before UTXOs can be spent
 * This is the default value - actual value is stored in system settings
 */
export const DEFAULT_CONFIRMATION_THRESHOLD = 1;

/**
 * Default number of confirmations considered "deeply confirmed"
 * This is the default value - actual value is stored in system settings
 */
export const DEFAULT_DEEP_CONFIRMATION_THRESHOLD = 3;

// ============================================================================
// BITCOIN CONSTANTS
// ============================================================================

/**
 * Satoshis per Bitcoin
 */
export const SATOSHIS_PER_BTC = 100_000_000;

/**
 * Default dust threshold in satoshis
 * Outputs below this value are considered "dust" and won't be relayed by nodes.
 * Based on 3 × minimum relay fee × output size for P2PKH outputs.
 * SegWit outputs have a lower threshold (~294 sats) but 546 is used as a safe universal minimum.
 * This is the default value - actual value is stored in system settings.
 */
export const DEFAULT_DUST_THRESHOLD = 546;

/**
 * Minimum fee rate in sat/vB
 * Can be as low as 0.1 for low-fee environments
 */
export const MIN_FEE_RATE = 0.1;

/**
 * Maximum reasonable fee rate in sat/vB (to prevent accidents)
 */
export const MAX_FEE_RATE = 1000;

// ============================================================================
// SYNC CONSTANTS
// ============================================================================

/**
 * Interval between sync retries in milliseconds
 */
export const SYNC_RETRY_INTERVAL_MS = 30000; // 30 seconds

/**
 * Maximum number of sync retries before giving up
 */
export const MAX_SYNC_RETRIES = 3;

// ============================================================================
// CACHE CONSTANTS
// ============================================================================

/**
 * Price cache TTL in milliseconds
 */
export const PRICE_CACHE_TTL_MS = 60000; // 1 minute

/**
 * Fee estimate cache TTL in milliseconds
 */
export const FEE_CACHE_TTL_MS = 30000; // 30 seconds
