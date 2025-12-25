/**
 * Serialization Utilities
 *
 * Helper functions for serializing database models to JSON-safe formats
 */

import { DraftTransaction } from '@prisma/client';

/**
 * Serialize a draft transaction for JSON response
 * Converts BigInt fields to numbers for JSON compatibility
 *
 * @param draft - The draft transaction from Prisma
 * @returns Serialized draft with number fields instead of BigInt
 */
export function serializeDraftTransaction(draft: DraftTransaction) {
  return {
    ...draft,
    amount: Number(draft.amount),
    fee: Number(draft.fee),
    totalInput: Number(draft.totalInput),
    totalOutput: Number(draft.totalOutput),
    changeAmount: Number(draft.changeAmount),
    effectiveAmount: Number(draft.effectiveAmount),
  };
}

/**
 * Serialize an array of draft transactions for JSON response
 * Converts BigInt fields to numbers for JSON compatibility
 *
 * @param drafts - Array of draft transactions from Prisma
 * @returns Array of serialized drafts with number fields
 */
export function serializeDraftTransactions(drafts: DraftTransaction[]) {
  return drafts.map(serializeDraftTransaction);
}
