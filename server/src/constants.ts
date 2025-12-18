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
 * Number of confirmations considered "confirmed"
 */
export const CONFIRMATION_THRESHOLD = 1;

/**
 * Number of confirmations considered "deeply confirmed"
 */
export const DEEP_CONFIRMATION_THRESHOLD = 6;

// ============================================================================
// BITCOIN CONSTANTS
// ============================================================================

/**
 * Satoshis per Bitcoin
 */
export const SATOSHIS_PER_BTC = 100_000_000;

/**
 * Minimum fee rate in sat/vB
 */
export const MIN_FEE_RATE = 1;

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
