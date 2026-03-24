/**
 * Serialization Utilities
 *
 * Helper functions for serializing database models to JSON-safe formats.
 * The generic `serializeForJson` handles BigInt→number conversion recursively,
 * while type-specific helpers remain for backward compatibility.
 */

import { DraftTransaction } from '@prisma/client';

/**
 * Recursively convert BigInt values to numbers in any object/array.
 * Safe for values within Number.MAX_SAFE_INTEGER (which covers satoshi amounts up to ~90M BTC).
 *
 * @param data - Any value that may contain BigInt fields
 * @returns A new object/array with BigInt values converted to numbers
 */
export function serializeForJson<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return Number(data) as unknown as T;
  }

  if (data instanceof Date) {
    return data as T;
  }

  if (Array.isArray(data)) {
    return data.map(serializeForJson) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = serializeForJson(value);
    }
    return result as T;
  }

  return data;
}

/**
 * Serialize a draft transaction for JSON response
 * Converts BigInt fields to numbers for JSON compatibility
 */
export function serializeDraftTransaction(draft: DraftTransaction) {
  return serializeForJson(draft);
}

/**
 * Serialize an array of draft transactions for JSON response
 */
export function serializeDraftTransactions(drafts: DraftTransaction[]) {
  return drafts.map(serializeDraftTransaction);
}
