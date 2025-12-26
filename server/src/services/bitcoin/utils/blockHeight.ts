/**
 * Block Height Utilities
 *
 * Handles block height caching and fetching for fast confirmation calculations.
 */

import { getNodeClient } from '../nodeClient';
import { createLogger } from '../../../utils/logger';

const log = createLogger('BLOCK_HEIGHT');

// Cached block height for fast confirmation calculations
// Updated whenever getBlockHeight() is called or via setCachedBlockHeight()
let cachedBlockHeight = 0;
let cachedBlockHeightTime = 0;

/**
 * Get the cached block height (for fast confirmation calculations)
 * Returns 0 if not yet cached
 */
export function getCachedBlockHeight(): number {
  return cachedBlockHeight;
}

/**
 * Set the cached block height (called from sync service when block headers are received)
 */
export function setCachedBlockHeight(height: number): void {
  if (height > cachedBlockHeight) {
    cachedBlockHeight = height;
    cachedBlockHeightTime = Date.now();
    log.debug(`Cached block height updated to ${height}`);
  }
}

/**
 * Get current block height from node
 */
export async function getBlockHeight(network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): Promise<number> {
  try {
    const client = await getNodeClient(network);
    const height = await client.getBlockHeight();
    setCachedBlockHeight(height);
    return height;
  } catch (error) {
    log.error('Failed to get block height', { error: String(error) });
    // Return cached height if available, otherwise throw
    if (cachedBlockHeight > 0) {
      return cachedBlockHeight;
    }
    throw error;
  }
}

/**
 * Simple LRU cache using Map's insertion order
 * When max size reached, evicts oldest entries
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Cache for block timestamps to avoid repeated lookups (max 1000 blocks)
const blockTimestampCache = new LRUCache<number, Date>(1000);

/**
 * Get block timestamp from block height
 * Block header is 80 bytes hex; timestamp is at bytes 68-72 (little-endian uint32)
 */
export async function getBlockTimestamp(height: number, network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): Promise<Date | null> {
  if (height <= 0) return null;

  // Check cache first
  const cached = blockTimestampCache.get(height);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const client = await getNodeClient(network);
    const headerHex = await client.getBlockHeader(height);

    // Block header structure (80 bytes):
    // - version: 4 bytes (0-3)
    // - prev_block_hash: 32 bytes (4-35)
    // - merkle_root: 32 bytes (36-67)
    // - timestamp: 4 bytes (68-71) - little-endian uint32
    // - bits: 4 bytes (72-75)
    // - nonce: 4 bytes (76-79)

    // Extract timestamp bytes (68-71, each byte is 2 hex chars)
    const timestampHex = headerHex.slice(136, 144); // bytes 68-71 = chars 136-143

    // Convert from little-endian hex to number
    const timestampBuffer = Buffer.from(timestampHex, 'hex');
    const timestamp = timestampBuffer.readUInt32LE(0);

    const date = new Date(timestamp * 1000);

    // Cache the result
    blockTimestampCache.set(height, date);

    return date;
  } catch (error) {
    log.warn(`Failed to get block timestamp for height ${height}`, { error: String(error) });
    return null;
  }
}
