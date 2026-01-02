/**
 * Sync Validation Schemas
 *
 * Zod schemas for wallet synchronization endpoints.
 */

import { z } from 'zod';
import { UuidSchema } from './common';

// =============================================================================
// Sync Priority
// =============================================================================

export const SyncPrioritySchema = z.enum(['low', 'normal', 'high']).default('normal');

// =============================================================================
// Sync Requests
// =============================================================================

export const SyncWalletSchema = z.object({
  priority: SyncPrioritySchema,
});

// WalletIdParamSchema is exported from common.ts

// =============================================================================
// Type Exports
// =============================================================================

export type SyncWalletInput = z.infer<typeof SyncWalletSchema>;
